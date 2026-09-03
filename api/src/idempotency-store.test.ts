import { test } from "node:test";
import assert from "node:assert/strict";
import type { DecisionResponse } from "./decision.js";
import { InMemoryIdempotencyStore } from "./idempotency-store.js";
import { IdempotencyConflictError } from "./infrastructure/state-store-errors.js";

const decision = (decisionId: string): DecisionResponse => ({
  decisionId,
  decision: "APPROVED",
  score: 0,
  reasons: [],
  evaluatedAt: "2026-09-01T00:00:00.000Z",
  degraded: false,
});

test("replays one operation for concurrent identical requests", async () => {
  const store = new InMemoryIdempotencyStore();
  let evaluations = 0;
  const operation = async () => {
    evaluations += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return decision("dec_single");
  };

  const results = await Promise.all(
    Array.from({ length: 10 }, () => store.execute("key", "hash-a", operation)),
  );

  assert.equal(evaluations, 1);
  assert.deepEqual(
    new Set(results.map((result) => result.decision.decisionId)),
    new Set(["dec_single"]),
  );
  assert.equal(results.filter((result) => result.replayed).length, 9);
});

test("rejects a payload mismatch while the first operation is pending", async () => {
  const store = new InMemoryIdempotencyStore();
  let release: ((value: DecisionResponse) => void) | undefined;
  const pending = new Promise<DecisionResponse>((resolve) => {
    release = resolve;
  });

  const first = store.execute("key", "hash-a", () => pending);
  await assert.rejects(
    () => store.execute("key", "hash-b", () => Promise.resolve(decision("dec_other"))),
    IdempotencyConflictError,
  );
  release?.(decision("dec_first"));
  await first;
});

test("evaluates again after the configured TTL", async () => {
  let now = 0;
  const store = new InMemoryIdempotencyStore(1, () => now);
  let evaluations = 0;
  const operation = async () => decision(`dec_${++evaluations}`);

  await store.execute("key", "hash", operation);
  now = 1_000;
  const result = await store.execute("key", "hash", operation);

  assert.equal(evaluations, 2);
  assert.equal(result.decision.decisionId, "dec_2");
  assert.equal(result.replayed, false);
});

test("releases a failed operation so a retry can evaluate", async () => {
  const store = new InMemoryIdempotencyStore();
  await assert.rejects(
    () => store.execute("key", "hash", () => Promise.reject(new Error("failed"))),
    /failed/,
  );

  const result = await store.execute("key", "hash", () => Promise.resolve(decision("dec_retry")));
  assert.equal(result.decision.decisionId, "dec_retry");
  assert.equal(result.replayed, false);
});
