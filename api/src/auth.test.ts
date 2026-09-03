import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { keyIsValid } from "./auth.js";
import { postDecision, testDeps } from "./test-helpers.js";

const validBody = {
  transactionId: "txn_1",
  cardId: "card_1",
  amount: 20,
  currency: "EUR",
  country: "FR",
  channel: "in_store",
  merchantCategory: "grocery",
};

test("keyIsValid: exact match only, undefined and mismatched length are rejected", () => {
  assert.equal(keyIsValid("secret", "secret"), true);
  assert.equal(keyIsValid("secret", "other"), false);
  assert.equal(keyIsValid("sec", "secret"), false);
  assert.equal(keyIsValid(undefined, "secret"), false);
});

test("POST /api/decisions without X-API-Key is 401", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/decisions",
    payload: JSON.stringify(validBody),
    headers: { "content-type": "application/json" },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error, "unauthorized");
});

test("POST /api/decisions with a wrong X-API-Key is 401", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject(postDecision(validBody, { "x-api-key": "wrong" }));
  assert.equal(response.statusCode, 401);
});

test("POST /api/decisions with the right X-API-Key is 200", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject(postDecision(validBody));
  assert.equal(response.statusCode, 200);
});

test("a 401 still carries X-Instance-Id and X-Request-Id", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/api/decisions" });
  assert.equal(response.statusCode, 401);
  assert.equal(response.headers["x-instance-id"], "test-instance");
  assert.ok(response.headers["x-request-id"]);
});

for (const probe of ["/health", "/ready", "/metrics"]) {
  test(`${probe} stays open without an API key`, async (t) => {
    const app = buildApp(testDeps());
    t.after(() => app.close());

    const response = await app.inject({ method: "GET", url: probe });
    assert.notEqual(response.statusCode, 401);
  });
}
