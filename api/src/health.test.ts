import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { createReadiness } from "./readiness.js";
import { testDeps } from "./test-helpers.js";

test("GET /health returns 200 with status ok", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
});

test("GET /ready returns 200 ready by default", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/ready" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ready",
    mode: "normal",
    dependencies: { redis: "available" },
  });
});

test("GET /ready remains 200 and reports degraded Redis", async (t) => {
  const app = buildApp(testDeps({ sharedStateStatus: () => "unavailable" }));
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/ready" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ready",
    mode: "degraded",
    dependencies: { redis: "unavailable" },
  });
});

test("GET /ready returns 503 once shutdown has begun", async (t) => {
  const readiness = createReadiness();
  const app = buildApp(testDeps({ readiness }));
  t.after(() => app.close());

  readiness.beginShutdown();
  const response = await app.inject({ method: "GET", url: "/ready" });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: "shutting_down" });
});

test("every response carries the X-Instance-Id header", async (t) => {
  const app = buildApp(testDeps());
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.headers["x-instance-id"], "test-instance");
});
