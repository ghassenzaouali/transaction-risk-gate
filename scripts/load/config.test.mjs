import assert from "node:assert/strict";
import test from "node:test";
import { createLoadOptions, performanceTargets, requiresMultipleReplicas } from "./config.mjs";

test("baseline reste un contrôle court et mesurable", () => {
  const options = createLoadOptions("baseline");
  assert.equal(options.scenarios.decisions.vus, 5);
  assert.equal(options.scenarios.decisions.duration, "30s");
  assert.deepEqual(options.thresholds.http_req_duration, ["p(95)<250", "p(99)<500"]);
  assert.ok(options.summaryTrendStats.includes("p(99)"));
  assert.equal(performanceTargets.baseline.errorRate, 0.01);
});

test("scale applique son enveloppe et impose plusieurs replicas", () => {
  const options = createLoadOptions("scale");
  assert.equal(options.scenarios.decisions.stages.at(-2).target, 150);
  assert.deepEqual(options.thresholds.http_req_duration, ["p(95)<750", "p(99)<1000"]);
  assert.equal(requiresMultipleReplicas("scale"), true);
  assert.equal(requiresMultipleReplicas("baseline"), false);
});

test("stress caractérise la capacité avec une enveloppe explicite", () => {
  const options = createLoadOptions("stress");
  assert.equal(options.scenarios.decisions.stages.at(-2).target, 300);
  assert.deepEqual(options.thresholds.http_req_duration, ["p(95)<1250", "p(99)<1750"]);
  assert.equal(requiresMultipleReplicas("stress"), true);
});

test("un profil inconnu est refusé", () => {
  assert.throws(() => createLoadOptions("production-surprise"), /unknown load profile/);
});
