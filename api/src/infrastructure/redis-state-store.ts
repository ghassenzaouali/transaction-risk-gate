import { createHmac, randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import type { DecisionResponse } from "../decision.js";
import type { IdempotencyStore, IdempotentResult } from "../idempotency-store.js";
import type { VelocityStore } from "../velocity-store.js";
import type { RateLimitCount } from "../rate-limit-store.js";
import { CircuitBreaker, type CircuitState } from "./circuit-breaker.js";
import { IdempotencyConflictError, StateStoreUnavailableError } from "./state-store-errors.js";

const VELOCITY_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

const CLAIM_SCRIPT = `
local response = redis.call('GET', KEYS[1])
if response then
  return {1, response}
end
local lock = redis.call('GET', KEYS[2])
if lock then
  return {2, lock}
end
redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2], 'NX')
return {3, ''}
`;

const COMPLETE_SCRIPT = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('DEL', KEYS[2])
return 1
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

type CachedEnvelope = {
  payloadHash: string;
  decision: DecisionResponse;
};

type LockEnvelope = {
  payloadHash: string;
  token: string;
};

type ClaimReply = [number, string];

export type RedisStateStoreOptions = Readonly<{
  url: string;
  hmacSecret: string;
  velocityWindowSeconds: number;
  commandTimeoutMs: number;
  circuitFailureThreshold: number;
  circuitResetMs: number;
  idempotencyTtlSeconds: number;
  idempotencyLockMs: number;
  idempotencyWaitMs: number;
  namespace?: string;
  onCircuitTransition?: (from: CircuitState, to: CircuitState) => void;
  onAvailabilityChange?: (from: SharedStateAvailability, to: SharedStateAvailability) => void;
  onClientError?: (error: Error) => void;
}>;

export type SharedStateAvailability = "unknown" | "available" | "unavailable";

class RedisExecutor {
  readonly #client: RedisClientType;
  readonly #breaker: CircuitBreaker;
  readonly #onAvailability: (available: boolean) => void;
  #connecting: Promise<void> | undefined;

  constructor(
    client: RedisClientType,
    breaker: CircuitBreaker,
    onAvailability: (available: boolean) => void,
  ) {
    this.#client = client;
    this.#breaker = breaker;
    this.#onAvailability = onAvailability;
  }

  async run<T>(operation: (client: RedisClientType) => Promise<T>): Promise<T> {
    try {
      const result = await this.#breaker.execute(async () => {
        await this.#ensureConnected();
        return operation(this.#client);
      });
      this.#onAvailability(true);
      return result;
    } catch (error) {
      this.#onAvailability(false);
      throw error;
    }
  }

  close(): void {
    if (this.#client.isOpen) this.#client.destroy();
  }

  async #ensureConnected(): Promise<void> {
    if (this.#client.isReady) return;
    if (this.#connecting === undefined) {
      this.#connecting = this.#client
        .connect()
        .then(() => undefined)
        .finally(() => {
          this.#connecting = undefined;
        });
    }
    await this.#connecting;
    if (!this.#client.isReady) {
      throw new StateStoreUnavailableError("Redis connection is not ready");
    }
  }
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch (error) {
    throw new StateStoreUnavailableError(`invalid ${label} JSON in Redis`, error);
  }
  throw new StateStoreUnavailableError(`invalid ${label} value in Redis`);
}

function parseLock(raw: string): LockEnvelope {
  const value = parseJsonObject(raw, "idempotency lock");
  if (typeof value.payloadHash !== "string" || typeof value.token !== "string") {
    throw new StateStoreUnavailableError("invalid idempotency lock fields in Redis");
  }
  return { payloadHash: value.payloadHash, token: value.token };
}

function isDecisionResponse(value: unknown): value is DecisionResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.decisionId === "string" &&
    ["APPROVED", "REVIEW", "REJECTED"].includes(String(candidate.decision)) &&
    typeof candidate.score === "number" &&
    Array.isArray(candidate.reasons) &&
    typeof candidate.evaluatedAt === "string" &&
    typeof candidate.degraded === "boolean"
  );
}

function parseCached(raw: string): CachedEnvelope {
  const value = parseJsonObject(raw, "idempotency response");
  if (typeof value.payloadHash !== "string" || !isDecisionResponse(value.decision)) {
    throw new StateStoreUnavailableError("invalid idempotency response fields in Redis");
  }
  return { payloadHash: value.payloadHash, decision: value.decision };
}

function parseClaimReply(value: unknown): ClaimReply {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new StateStoreUnavailableError("invalid idempotency claim reply from Redis");
  }
  const status = Number(value[0]);
  const payload = String(value[1] ?? "");
  if (![1, 2, 3].includes(status)) {
    throw new StateStoreUnavailableError("unknown idempotency claim status from Redis");
  }
  return [status, payload];
}

export class RedisStateStore implements VelocityStore, IdempotencyStore {
  readonly #options: RedisStateStoreOptions;
  readonly #executor: RedisExecutor;
  readonly #namespace: string;
  #availability: SharedStateAvailability = "unknown";

  constructor(options: RedisStateStoreOptions) {
    this.#options = options;
    this.#namespace = options.namespace ?? "trg";

    const client = createClient({
      url: options.url,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 1_000,
      socket: {
        connectTimeout: options.commandTimeoutMs,
        reconnectStrategy: false,
      },
    });
    client.on("error", (error) => options.onClientError?.(error));

    const breaker = new CircuitBreaker({
      failureThreshold: options.circuitFailureThreshold,
      resetAfterMs: options.circuitResetMs,
      timeoutMs: options.commandTimeoutMs,
      onTransition: options.onCircuitTransition,
    });
    this.#executor = new RedisExecutor(client, breaker, (available) => {
      const next = available ? "available" : "unavailable";
      if (next === this.#availability) return;
      const previous = this.#availability;
      this.#availability = next;
      options.onAvailabilityChange?.(previous, next);
    });
  }

  get availability(): SharedStateAvailability {
    return this.#availability;
  }

  async probe(): Promise<void> {
    await this.#executor.run((client) => client.ping());
  }

  async hit(cardId: string): Promise<number> {
    const key = this.#key("velocity", cardId);
    const reply = await this.#executor.run((client) =>
      client.eval(VELOCITY_SCRIPT, {
        keys: [key],
        arguments: [String(this.#options.velocityWindowSeconds)],
      }),
    );
    const count = Number(reply);
    if (!Number.isInteger(count) || count < 1) {
      throw new StateStoreUnavailableError("invalid velocity count returned by Redis");
    }
    return count;
  }

  async incrementRateLimit(key: string, timeWindowMs: number): Promise<RateLimitCount> {
    const redisKey = this.#key("rate-limit", key);
    const reply = await this.#executor.run((client) =>
      client.eval(RATE_LIMIT_SCRIPT, {
        keys: [redisKey],
        arguments: [String(timeWindowMs)],
      }),
    );
    if (!Array.isArray(reply) || reply.length !== 2) {
      throw new StateStoreUnavailableError("invalid rate limit reply from Redis");
    }
    const current = Number(reply[0]);
    const ttl = Number(reply[1]);
    if (!Number.isInteger(current) || current < 1 || !Number.isInteger(ttl) || ttl < 1) {
      throw new StateStoreUnavailableError("invalid rate limit values from Redis");
    }
    return { current, ttl };
  }

  async execute(
    key: string,
    payloadHash: string,
    operation: () => Promise<DecisionResponse>,
  ): Promise<IdempotentResult> {
    return this.#executeUntil(
      key,
      payloadHash,
      operation,
      Date.now() + this.#options.idempotencyWaitMs,
    );
  }

  close(): void {
    this.#executor.close();
  }

  #key(
    kind: "velocity" | "idempotency-response" | "idempotency-lock" | "rate-limit",
    value: string,
  ): string {
    const digest = createHmac("sha256", this.#options.hmacSecret).update(value).digest("hex");
    return `${this.#namespace}:${kind}:${digest}`;
  }

  async #executeUntil(
    key: string,
    payloadHash: string,
    operation: () => Promise<DecisionResponse>,
    deadline: number,
  ): Promise<IdempotentResult> {
    const responseKey = this.#key("idempotency-response", key);
    const lockKey = this.#key("idempotency-lock", key);
    const lock: LockEnvelope = { payloadHash, token: randomUUID() };
    const serializedLock = JSON.stringify(lock);

    const claim = parseClaimReply(
      await this.#executor.run((client) =>
        client.eval(CLAIM_SCRIPT, {
          keys: [responseKey, lockKey],
          arguments: [serializedLock, String(this.#options.idempotencyLockMs)],
        }),
      ),
    );

    if (claim[0] === 1) {
      const cached = parseCached(claim[1]);
      if (cached.payloadHash !== payloadHash) throw new IdempotencyConflictError();
      return { decision: cached.decision, replayed: true };
    }

    if (claim[0] === 2) {
      const pending = parseLock(claim[1]);
      if (pending.payloadHash !== payloadHash) throw new IdempotencyConflictError();
      if (Date.now() >= deadline) {
        throw new StateStoreUnavailableError("timed out waiting for idempotent response");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
      return this.#executeUntil(key, payloadHash, operation, deadline);
    }

    try {
      const decision = await operation();
      const cached: CachedEnvelope = { payloadHash, decision };
      const completed = Number(
        await this.#executor.run((client) =>
          client.eval(COMPLETE_SCRIPT, {
            keys: [responseKey, lockKey],
            arguments: [
              serializedLock,
              JSON.stringify(cached),
              String(this.#options.idempotencyTtlSeconds),
            ],
          }),
        ),
      );
      if (completed !== 1) {
        throw new StateStoreUnavailableError("idempotency lock expired before completion");
      }
      return { decision, replayed: false };
    } catch (error) {
      await this.#releaseLock(lockKey, serializedLock);
      throw error;
    }
  }

  async #releaseLock(lockKey: string, serializedLock: string): Promise<void> {
    try {
      await this.#executor.run((client) =>
        client.eval(RELEASE_SCRIPT, {
          keys: [lockKey],
          arguments: [serializedLock],
        }),
      );
    } catch {
      // Le verrou possède toujours un TTL : une panne de cleanup ne peut pas
      // créer un verrou permanent et ne masque pas l'erreur initiale.
    }
  }
}
