import assert from "node:assert/strict";
import test from "node:test";
import { assertDegradedDecision, assertRecoveredDecision } from "./redis-outage.mjs";

const response = (status, headers = {}) => new Response("{}", { status, headers });

test("valide la politique fail-safe pendant la panne", () => {
  assert.doesNotThrow(() =>
    assertDegradedDecision(response(200, { "X-Degraded-Mode": "true" }), {
      decision: "REVIEW",
      score: 30,
      degraded: true,
      reasons: [{ rule: "RISK_CONTEXT_UNAVAILABLE" }],
    }),
  );
});

test("refuse une approbation dégradée", () => {
  assert.throws(
    () =>
      assertDegradedDecision(response(200, { "X-Degraded-Mode": "true" }), {
        decision: "APPROVED",
        score: 0,
        degraded: true,
        reasons: [],
      }),
    /forcer REVIEW/,
  );
});

test("valide le retour à une décision normale", () => {
  assert.doesNotThrow(() =>
    assertRecoveredDecision(response(200), { decision: "APPROVED", degraded: false }),
  );
});
