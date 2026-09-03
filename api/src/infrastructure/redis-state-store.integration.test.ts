import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import type { DecisionResponse } from "../decision.js";
import { IdempotencyConflictError } from "./state-store-errors.js";
import { RedisStateStore, type RedisStateStoreOptions } from "./redis-state-store.js";

const redisUrl = process.env.REDIS_TEST_URL;
const skip = redisUrl === undefined ? "REDIS_TEST_URL absent" : false;
const hmacSecret = "integration-hmac-secret-at-least-32-bytes";

const decision = (decisionId: string): DecisionResponse => ({
  decisionId,
  decision: "APPROVED",
  score: 0,
  reasons: [],
  evaluatedAt: "2026-09-01T00:00:00.000Z",
  degraded: false,
});

const createStore = (namespace: string, overrides: Partial<RedisStateStoreOptions> = {}) =>
  new RedisStateStore({
    url: redisUrl ?? "redis://127.0.0.1:6379",
    hmacSecret,
    velocityWindowSeconds: 60,
    commandTimeoutMs: 250,
    circuitFailureThreshold: 3,
    circuitResetMs: 100,
    idempotencyTtlSeconds: 86_400,
    idempotencyLockMs: 5_000,
    idempotencyWaitMs: 2_000,
    namespace,
    ...overrides,
  });

const withAdmin = async (t: TestContext) => {
  const admin = createClient({ url: redisUrl });
  admin.on("error", () => {});
  await admin.connect();
  t.after(() => admin.destroy());
  return admin;
};

test("Redis startup probe resolves the initial availability", { skip }, async (t) => {
  const transitions: string[] = [];
  const store = createStore(`trg-test-${randomUUID()}`, {
    onAvailabilityChange: (from, to) => transitions.push(`${from}->${to}`),
  });
  t.after(() => store.close());

  assert.equal(store.availability, "unknown");
  await store.probe();
  assert.equal(store.availability, "available");
  assert.deepEqual(transitions, ["unknown->available"]);
});

test(
  "Redis shares atomic velocity across replicas and hides card identifiers",
  { skip },
  async (t) => {
    const namespace = `trg-test-${randomUUID()}`;
    const first = createStore(namespace);
    const second = createStore(namespace);
    t.after(() => first.close());
    t.after(() => second.close());
    const admin = await withAdmin(t);

    assert.equal(await first.hit("card-sensitive-42"), 1);
    assert.equal(await second.hit("card-sensitive-42"), 2);
    assert.equal(await first.hit("card-sensitive-42"), 3);

    const keys = await admin.keys(`${namespace}:*`);
    assert.equal(keys.length, 1);
    assert.doesNotMatch(keys[0] ?? "", /card-sensitive-42/);
    const ttl = await admin.ttl(keys[0] ?? "");
    assert.ok(ttl > 0 && ttl <= 60, `TTL inattendu : ${ttl}`);
  },
);

test("Redis velocity expires at the configured fixed-window TTL", { skip }, async (t) => {
  const namespace = `trg-test-${randomUUID()}`;
  const store = createStore(namespace, { velocityWindowSeconds: 1 });
  t.after(() => store.close());

  assert.equal(await store.hit("card-expiring"), 1);
  assert.equal(await store.hit("card-expiring"), 2);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(await store.hit("card-expiring"), 1);
});

test("Redis shares and pseudonymizes the rate limit counter", { skip }, async (t) => {
  const namespace = `trg-test-${randomUUID()}`;
  const first = createStore(namespace);
  const second = createStore(namespace);
  t.after(() => first.close());
  t.after(() => second.close());
  const admin = await withAdmin(t);

  const initial = await first.incrementRateLimit("public:203.0.113.10", 60_000);
  assert.equal(initial.current, 1);
  assert.ok(initial.ttl > 0 && initial.ttl <= 60_000);
  const next = await second.incrementRateLimit("public:203.0.113.10", 60_000);
  assert.equal(next.current, 2);
  assert.ok(next.ttl > 0 && next.ttl <= 60_000);

  const keys = await admin.keys(`${namespace}:rate-limit:*`);
  assert.equal(keys.length, 1);
  assert.doesNotMatch(keys[0] ?? "", /203\.0\.113\.10/);
});

test(
  "Redis idempotency is single-flight, replayed for 24h and pseudonymized",
  { skip },
  async (t) => {
    const namespace = `trg-test-${randomUUID()}`;
    const first = createStore(namespace);
    const second = createStore(namespace);
    t.after(() => first.close());
    t.after(() => second.close());
    const admin = await withAdmin(t);
    let evaluations = 0;

    const operation = async () => {
      evaluations += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return decision("dec_distributed");
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        (index % 2 === 0 ? first : second).execute(
          "idem-sensitive-key",
          "payload-hash-a",
          operation,
        ),
      ),
    );

    assert.equal(evaluations, 1);
    assert.equal(new Set(results.map((result) => result.decision.decisionId)).size, 1);
    assert.equal(results.filter((result) => result.replayed).length, 9);

    const keys = await admin.keys(`${namespace}:*`);
    assert.equal(keys.length, 1);
    assert.doesNotMatch(keys[0] ?? "", /idem-sensitive-key/);
    const ttl = await admin.ttl(keys[0] ?? "");
    assert.ok(ttl > 86_300 && ttl <= 86_400, `TTL inattendu : ${ttl}`);

    await assert.rejects(
      () => first.execute("idem-sensitive-key", "payload-hash-b", operation),
      IdempotencyConflictError,
    );
    assert.equal(evaluations, 1);
  },
);
