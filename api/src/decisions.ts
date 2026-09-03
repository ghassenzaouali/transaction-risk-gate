import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "./app.js";
import type { DecisionResponse } from "./decision.js";
import { TransactionSchema } from "./domain/transaction.js";
import { evaluateTransaction } from "./application/evaluate-transaction.js";
import { evaluateDegradedRisk, type Evaluation } from "./domain/risk-engine.js";
import {
  IdempotencyConflictError,
  StateStoreUnavailableError,
} from "./infrastructure/state-store-errors.js";

function newDecisionId(): string {
  return `dec_${randomUUID()}`;
}

const IdempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/** La ligne de journal qui sert de piste d'audit d'une décision. */
export function toAuditRecord(decision: DecisionResponse) {
  return {
    audit: "decision" as const,
    decisionId: decision.decisionId,
    decision: decision.decision,
    score: decision.score,
    reasons: decision.reasons.map((reason) => reason.rule),
    degraded: decision.degraded,
  };
}

function hashTransactionPayload(transaction: object): string {
  return createHash("sha256").update(JSON.stringify(transaction)).digest("hex");
}

function toDecisionResponse(evaluation: Evaluation): DecisionResponse {
  return {
    decisionId: newDecisionId(),
    decision: evaluation.decision,
    score: evaluation.score,
    reasons: evaluation.reasons,
    evaluatedAt: new Date().toISOString(),
    degraded: evaluation.degraded,
  };
}

export function registerDecisions(app: FastifyInstance, deps: AppDeps): void {
  app.post("/api/decisions", async (request, reply) => {
    const parsed = TransactionSchema.safeParse(request.body);
    if (!parsed.success) {
      deps.metrics.recordRequestFailure("invalid_transaction");
      request.log.warn(
        { event: "request_rejected", reason: "invalid_transaction" },
        "transaction validation failed",
      );
      return reply.code(400).send({
        error: "invalid_transaction",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const rawIdempotencyKey = request.headers["idempotency-key"];
    const parsedKey =
      rawIdempotencyKey === undefined
        ? { success: true as const, data: null }
        : IdempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!parsedKey.success) {
      deps.metrics.recordRequestFailure("invalid_idempotency_key");
      request.log.warn(
        { event: "request_rejected", reason: "invalid_idempotency_key" },
        "idempotency header validation failed",
      );
      return reply.code(400).send({
        error: "invalid_idempotency_key",
        message: "Idempotency-Key doit contenir 8 à 128 caractères sûrs",
      });
    }

    const renderDecision = async () =>
      toDecisionResponse(await evaluateTransaction(parsed.data, deps.config, deps.velocityStore));

    let decision: DecisionResponse;
    let replayed = false;
    try {
      if (parsedKey.data === null) {
        decision = await renderDecision();
      } else {
        const result = await deps.idempotencyStore.execute(
          parsedKey.data,
          hashTransactionPayload(parsed.data),
          renderDecision,
        );
        decision = result.decision;
        replayed = result.replayed;
      }
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        deps.metrics.recordRequestFailure("idempotency_conflict");
        request.log.warn(
          { event: "idempotency_conflict" },
          "idempotency key reused with another payload",
        );
        return reply.code(409).send({
          error: "idempotency_conflict",
          message: "Idempotency-Key est déjà associée à un autre payload",
        });
      }
      if (!(error instanceof StateStoreUnavailableError)) throw error;

      deps.metrics.recordSharedStateFailure();
      decision = toDecisionResponse(evaluateDegradedRisk(parsed.data, deps.config));
      reply.header("X-Degraded-Mode", "true");
      request.log.warn(
        { event: "shared_state_unavailable", degraded: true },
        "decision forced to manual review",
      );
    }

    if (replayed) {
      request.log.info(
        { audit: "decision", decisionId: decision.decisionId, replayed: true },
        "decision replayed from idempotency cache",
      );
      return reply.send(decision);
    }

    request.log.info(toAuditRecord(decision), "decision rendered");
    deps.metrics.recordDecision({ decision: decision.decision, degraded: decision.degraded });

    return reply.send(decision);
  });
}
