import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, rateLimitProfile } from "./app.js";
import { postDecision, TEST_API_KEY, testConfig, testDeps } from "./test-helpers.js";

const validBody = {
  transactionId: "txn_security_1",
  cardId: "card_security_1",
  amount: 20,
  currency: "EUR",
  country: "FR",
  channel: "in_store",
  merchantCategory: "grocery",
};

const authGet = (url: string, headers: Record<string, string> = {}) => ({
  method: "GET" as const,
  url,
  headers: { "x-api-key": TEST_API_KEY, ...headers },
});

test("safe X-Request-Id is echoed and an unsafe value is rejected", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const safe = await app.inject(authGet("/api/rules", { "x-request-id": "req.safe-123" }));
  assert.equal(safe.statusCode, 200);
  assert.equal(safe.headers["x-request-id"], "req.safe-123");

  const unsafe = await app.inject(authGet("/api/rules", { "x-request-id": "bad value\nline" }));
  assert.equal(unsafe.statusCode, 400);
  assert.equal(unsafe.json().error, "invalid_request_id");
  assert.notEqual(unsafe.headers["x-request-id"], "bad value\nline");
});

test("unexpected query parameters and oversized payloads are rejected", async (t) => {
  const deps = testDeps({ config: { ...testConfig, bodyLimitBytes: 1_024 } });
  const app = buildApp(deps);
  t.after(() => app.close());

  const query = await app.inject(authGet("/api/rules?unexpected=true"));
  assert.equal(query.statusCode, 400);
  assert.equal(query.json().error, "unexpected_query");

  const oversized = await app.inject(postDecision({ ...validBody, cardId: "x".repeat(2_000) }));
  assert.equal(oversized.statusCode, 413);
  assert.equal(oversized.json().error, "payload_too_large");
});

test("malformed JSON and unsupported media types keep precise client status codes", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const malformed = await app.inject({
    method: "POST",
    url: "/api/decisions",
    headers: { "content-type": "application/json", "x-api-key": TEST_API_KEY },
    payload: '{"transactionId":',
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error, "invalid_request");

  const unsupported = await app.inject({
    method: "POST",
    url: "/api/decisions",
    headers: { "content-type": "text/plain", "x-api-key": TEST_API_KEY },
    payload: "not-json",
  });
  assert.equal(unsupported.statusCode, 415);
  assert.equal(unsupported.json().error, "unsupported_media_type");
});

test("every response carries defensive security headers", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.match(response.headers["content-security-policy"] ?? "", /default-src 'none'/);
});

test("public API profile is blocked after its configured ceiling", async (t) => {
  const deps = testDeps({
    config: {
      ...testConfig,
      rateLimitMax: 2,
      rateLimitLoadMax: 4,
      rateLimitWindowMs: 60_000,
    },
  });
  const app = buildApp(deps);
  t.after(() => app.close());

  assert.equal((await app.inject(authGet("/api/rules"))).statusCode, 200);
  assert.equal((await app.inject(authGet("/api/rules"))).statusCode, 200);
  const limited = await app.inject(authGet("/api/rules"));
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error, "rate_limit_exceeded");

  const metrics = await deps.metrics.registry.metrics();
  assert.match(metrics, /rate_limit_exceeded_total\{profile="public"\} 1/);
});

test("a valid load token raises the ceiling only outside production", async (t) => {
  const loadTestToken = "load-test-token-with-at-least-32-bytes";
  const deps = testDeps({
    config: {
      ...testConfig,
      appEnvironment: "integration",
      loadTestToken,
      rateLimitMax: 1,
      rateLimitLoadMax: 3,
      rateLimitWindowMs: 60_000,
    },
  });
  const app = buildApp(deps);
  t.after(() => app.close());
  const loadHeaders = { "x-load-test-token": loadTestToken };

  assert.equal((await app.inject(authGet("/api/rules", loadHeaders))).statusCode, 200);
  assert.equal((await app.inject(authGet("/api/rules", loadHeaders))).statusCode, 200);
  assert.equal((await app.inject(authGet("/api/rules", loadHeaders))).statusCode, 200);
  assert.equal((await app.inject(authGet("/api/rules", loadHeaders))).statusCode, 429);

  assert.equal(
    rateLimitProfile(
      { "x-load-test-token": loadTestToken },
      { ...deps.config, appEnvironment: "production" },
    ),
    "public",
  );
});

test("malformed load token is rejected before business processing", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject(authGet("/api/rules", { "x-load-test-token": "short" }));
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "invalid_load_test_token");
});
