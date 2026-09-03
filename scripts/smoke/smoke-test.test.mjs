import assert from "node:assert/strict";
import { test } from "node:test";
import { runSmokeOnce } from "./smoke-test.mjs";

function json(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("valide santé, Redis, règles, décision et rejeu sans secret", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith("/healthz")) return new Response("ok\n");
    if (url.endsWith("/ready")) {
      return json({ status: "ready", mode: "normal", dependencies: { redis: "available" } });
    }
    if (url.endsWith("/api/rules")) {
      return json({
        currency: "EUR",
        rules: [30, 25, 20, 15, 10].map((weight) => ({ weight })),
      });
    }
    return json(
      { decisionId: "dec-smoke", decision: "APPROVED", degraded: false },
      { "X-Instance-Id": "api-1" },
    );
  };

  const summary = await runSmokeOnce(fetchImpl, "https://example.test/", "fixed-id");

  assert.equal(summary.replayed, true);
  assert.equal(summary.instanceId, "api-1");
  assert.equal(requests.filter(({ url }) => url.endsWith("/api/decisions")).length, 2);
  assert.equal(
    requests.some(({ options }) => options.headers?.["X-API-Key"]),
    false,
  );
});

test("refuse un readiness dégradé", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/healthz")) return new Response("ok\n");
    return json({ status: "ready", mode: "degraded", dependencies: { redis: "unavailable" } });
  };

  await assert.rejects(
    () => runSmokeOnce(fetchImpl, "https://example.test", "fixed-id"),
    /dégradé/,
  );
});
