import { randomBytes } from "node:crypto";
import type { AppDeps } from "./app.js";
import type { Config } from "./config.js";
import { InMemoryVelocityStore } from "./velocity-store.js";
import { InMemoryIdempotencyStore } from "./idempotency-store.js";
import { createMetrics } from "./metrics.js";
import { createReadiness } from "./readiness.js";

const createTestSecret = (): string => randomBytes(32).toString("hex");

export const TEST_API_KEY = createTestSecret();

export const testConfig: Config = Object.freeze({
  host: "0.0.0.0",
  port: 3000,
  appEnvironment: "local",
  appVersion: "test",
  logLevel: "silent",
  bodyLimitBytes: 16_384,
  connectionTimeoutMs: 10_000,
  requestTimeoutMs: 15_000,
  keepAliveTimeoutMs: 5_000,
  maxRequestsPerSocket: 1_000,
  trustProxyHops: 0,
  rateLimitMax: 60,
  rateLimitLoadMax: 5_000,
  rateLimitWindowMs: 60_000,
  loadTestToken: undefined,
  shutdownTimeoutMs: 10_000,
  shutdownDelayMs: 0,
  apiKey: TEST_API_KEY,
  redisUrl: "redis://127.0.0.1:6379",
  redisHmacSecret: createTestSecret(),
  redisCommandTimeoutMs: 250,
  redisCircuitFailureThreshold: 3,
  redisCircuitResetMs: 10_000,
  idempotencyTtlSeconds: 86_400,
  idempotencyLockMs: 5_000,
  idempotencyWaitMs: 2_000,
  amountThreshold: 1000,
  velocityMax: 3,
  velocityWindowSeconds: 60,
  allowedCountries: ["FR", "DE"],
  highRiskMerchantCategories: ["gambling", "crypto"],
});

export function testDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    config: testConfig,
    velocityStore: new InMemoryVelocityStore(60, () => 0),
    idempotencyStore: new InMemoryIdempotencyStore(),
    metrics: createMetrics(),
    readiness: createReadiness(),
    instanceId: "test-instance",
    ...overrides,
  };
}

/** Options `app.inject` d'un POST /api/decisions, clé d'API incluse par défaut. */
export function postDecision(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: "POST" as const,
    url: "/api/decisions",
    payload: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-api-key": TEST_API_KEY, ...headers },
  };
}
