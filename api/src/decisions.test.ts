import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { InMemoryVelocityStore } from "./velocity-store.js";
import type { VelocityStore } from "./velocity-store.js";
import { TEST_API_KEY, postDecision, testDeps } from "./test-helpers.js";
import { StateStoreUnavailableError } from "./infrastructure/state-store-errors.js";

const authGet = (url: string) => ({
  method: "GET" as const,
  url,
  headers: { "x-api-key": TEST_API_KEY },
});

const validBody = {
  transactionId: "txn_1",
  cardId: "card_1",
  amount: 20,
  currency: "EUR",
  country: "FR",
  channel: "in_store",
  merchantCategory: "grocery",
};

test("returns a full decision for a valid transaction", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject(postDecision(validBody));
  assert.equal(response.statusCode, 200);

  const decision = response.json();
  assert.match(decision.decisionId, /^dec_[0-9a-f-]{36}$/);
  assert.equal(decision.decision, "APPROVED");
  assert.equal(decision.score, 0);
  assert.equal(typeof decision.evaluatedAt, "string");
  assert.equal(decision.degraded, false);
});

test("rejects an invalid body with 400", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject(postDecision({ cardId: "card_1" }));
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "invalid_transaction");
});

test("normalizes the body: a lowercase country still matches the allowed list", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject(postDecision({ ...validBody, country: "fr" }));
  assert.equal(response.json().decision, "APPROVED");
});

test("rejects a non-EUR transaction", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject(postDecision({ ...validBody, currency: "USD" }));
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "invalid_transaction");
});

test("returns generic reasons without transaction values", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject(
    postDecision({
      ...validBody,
      amount: 9876,
      country: "US",
      channel: "online",
      merchantCategory: "crypto",
    }),
  );
  assert.equal(response.statusCode, 200);

  const serializedReasons = JSON.stringify(response.json().reasons);
  for (const sensitiveValue of ["card_1", "txn_1", "US", "9876", "crypto"]) {
    assert.doesNotMatch(serializedReasons, new RegExp(sensitiveValue, "i"));
  }
});

test("same Idempotency-Key returns the exact same decision", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const headers = { "idempotency-key": "idem-key-123" };
  const first = await app.inject(postDecision(validBody, headers));
  const second = await app.inject(postDecision(validBody, headers));

  assert.deepEqual(second.json(), first.json());
});

test("an idempotent replay does not increment the velocity counter", async (t) => {
  let hits = 0;
  const countingStore: VelocityStore = {
    hit: async () => {
      hits += 1;
      return hits;
    },
  };
  const app = buildApp(testDeps({ velocityStore: countingStore }));
  t.after(() => app.close());

  const headers = { "idempotency-key": "idem-key-abc" };
  await app.inject(postDecision(validBody, headers));
  await app.inject(postDecision(validBody, headers));

  assert.equal(hits, 1);
});

test("concurrent identical requests execute the evaluation only once", async (t) => {
  let hits = 0;
  const countingStore: VelocityStore = {
    hit: async () => {
      hits += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return hits;
    },
  };
  const app = buildApp(testDeps({ velocityStore: countingStore }));
  t.after(() => app.close());

  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      app.inject(postDecision(validBody, { "idempotency-key": "idem-concurrent-1" })),
    ),
  );

  assert.equal(hits, 1);
  assert.ok(responses.every((response) => response.statusCode === 200));
  assert.equal(new Set(responses.map((response) => response.json().decisionId)).size, 1);
});

test("same Idempotency-Key with another payload returns 409", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const headers = { "idempotency-key": "idem-conflict-1" };
  await app.inject(postDecision(validBody, headers));
  const response = await app.inject(postDecision({ ...validBody, amount: 21 }, headers));

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error, "idempotency_conflict");
});

test("invalid Idempotency-Key returns 400", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject(postDecision(validBody, { "idempotency-key": "bad key" }));
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "invalid_idempotency_key");
});

test("shared state outage forces REVIEW and degraded=true", async (t) => {
  const unavailableStore: VelocityStore = {
    hit: () => Promise.reject(new StateStoreUnavailableError("Redis unavailable")),
  };
  const app = buildApp(testDeps({ velocityStore: unavailableStore }));
  t.after(() => app.close());

  const response = await app.inject(postDecision(validBody));
  const decision = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-degraded-mode"], "true");
  assert.equal(decision.decision, "REVIEW");
  assert.equal(decision.degraded, true);
  assert.ok(decision.score >= 30);
  assert.equal(decision.reasons.at(-1).rule, "RISK_CONTEXT_UNAVAILABLE");
});

test("without an Idempotency-Key, each call is evaluated afresh", async (t) => {
  const velocityStore = new InMemoryVelocityStore(60, () => 0);
  const app = buildApp(testDeps({ velocityStore }));
  t.after(() => app.close());

  const first = await app.inject(postDecision(validBody));
  const second = await app.inject(postDecision(validBody));

  assert.notEqual(first.json().decisionId, second.json().decisionId);
});

test("GET /api/decisions is not exposed", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject(authGet("/api/decisions"));
  assert.equal(response.statusCode, 404);
});

test("GET /api/rules exposes the active weights, bands and thresholds", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject(authGet("/api/rules"));
  assert.equal(response.statusCode, 200);

  const view = response.json();
  assert.equal(view.currency, "EUR");
  assert.equal(view.maxScore, 100);
  assert.deepEqual(view.scoreBands, {
    approved: { min: 0, max: 29 },
    review: { min: 30, max: 59 },
    rejected: { min: 60, max: 100 },
  });
  assert.equal(view.rules.length, 5);
  assert.equal(
    view.rules.find((r: { rule: string }) => r.rule === "AMOUNT_THRESHOLD").parameters.threshold,
    1000,
  );
});

test("GET /api/rules requires the API key", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/api/rules" });
  assert.equal(response.statusCode, 401);
});
