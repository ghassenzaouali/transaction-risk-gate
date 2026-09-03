import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { toAuditRecord } from "./decisions.js";
import type { DecisionResponse } from "./decision.js";
import type { VelocityStore } from "./velocity-store.js";
import { postDecision, testDeps } from "./test-helpers.js";
import { StateStoreUnavailableError } from "./infrastructure/state-store-errors.js";

const validBody = {
  transactionId: "txn_1",
  cardId: "card_1",
  amount: 20,
  currency: "EUR",
  country: "FR",
  channel: "in_store" as const,
  merchantCategory: "grocery",
};

test("GET /metrics returns Prometheus text and counts decisions by verdict", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  await app.inject(postDecision(validBody));
  const response = await app.inject({ method: "GET", url: "/metrics" });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /text\/plain/);
  assert.match(response.body, /decisions_total\{[^}]*decision="APPROVED"[^}]*\}\s+1/);
  assert.match(response.body, /http_request_duration_seconds_bucket/);
});

test("toAuditRecord keeps decision evidence without transaction data", () => {
  const decision: DecisionResponse = {
    decisionId: "dec_abc123",
    decision: "REVIEW",
    score: 30,
    reasons: [
      {
        rule: "COUNTRY_RISK",
        weight: 25,
        detail: "transaction country is outside the configured allowlist",
      },
    ],
    evaluatedAt: "2026-08-29T12:00:00.000Z",
    degraded: false,
  };
  const record = toAuditRecord(decision);

  assert.equal(record.audit, "decision");
  assert.equal(record.decisionId, "dec_abc123");
  assert.equal(record.decision, "REVIEW");
  assert.deepEqual(record.reasons, ["COUNTRY_RISK"]);
  for (const field of [
    "transactionId",
    "cardId",
    "amount",
    "currency",
    "country",
    "channel",
    "merchantCategory",
  ]) {
    assert.equal(field in record, false, `${field} ne doit pas être journalisé`);
  }
});

test("degraded decisions and shared state failures have dedicated metrics", async (t) => {
  const unavailableStore: VelocityStore = {
    hit: () => Promise.reject(new StateStoreUnavailableError("Redis unavailable")),
  };
  const deps = testDeps({ velocityStore: unavailableStore });
  const app = buildApp(deps);
  t.after(() => app.close());

  await app.inject(postDecision(validBody));
  deps.metrics.recordCircuitTransition({ from: "CLOSED", to: "OPEN" });
  deps.metrics.recordAuthFailure();
  deps.metrics.recordRequestFailure("invalid_request_id");
  deps.metrics.recordRequestAborted("timeout");
  deps.metrics.recordRateLimitFallback();
  const body = await deps.metrics.registry.metrics();

  assert.match(body, /degraded_decisions_total 1/);
  assert.match(body, /shared_state_errors_total 1/);
  assert.match(body, /redis_circuit_transitions_total\{from="CLOSED",to="OPEN"\} 1/);
  assert.match(body, /authentication_failures_total 1/);
  assert.match(body, /request_failures_total\{code="invalid_request_id"\} 1/);
  assert.match(body, /http_requests_aborted_total\{reason="timeout"\} 1/);
  assert.match(body, /rate_limit_fallback_total 1/);
  assert.match(body, /http_requests_in_flight 0/);
});
