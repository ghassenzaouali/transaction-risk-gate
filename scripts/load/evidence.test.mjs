import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidence } from "./evidence.mjs";

test("assemble une preuve de charge exploitable", () => {
  const log = [
    "progress",
    JSON.stringify({
      event: "load_evidence",
      completedAt: "2026-09-01T00:00:00.000Z",
      replicas: ["api-1", "api-2"],
      replicaCount: 2,
      velocityReplicas: ["api-1", "api-2"],
      velocityTriggered: 5,
      replicaCheck: true,
      velocityCheck: true,
    }),
  ].join("\n");
  const result = buildEvidence(
    log,
    {
      metrics: {
        http_req_failed: { values: { rate: 0.001 } },
        http_req_duration: { values: { "p(95)": 120, "p(99)": 220 } },
        checks: { values: { rate: 1 } },
      },
    },
    "scale",
  );
  assert.equal(result.replicaCount, 2);
  assert.equal(result.p95Ms, 120);
  assert.equal(result.velocityTriggered, 5);
});

test("refuse une preuve opérationnelle rouge", () => {
  const log = JSON.stringify({
    event: "load_evidence",
    replicas: ["api-1"],
    replicaCheck: false,
    velocityCheck: true,
  });
  assert.throws(() => buildEvidence(log, {}, "scale"), /evidence failed/);
});

test("lit le préfixe de log réellement émis par k6", () => {
  const event = JSON.stringify({
    event: "load_evidence",
    completedAt: "2026-09-02T05:15:48.861Z",
    replicas: ["api-1", "api-2"],
    replicaCount: 2,
    velocityReplicas: ["api-1", "api-2"],
    velocityTriggered: 5,
    replicaCheck: true,
    velocityCheck: true,
  });
  const log = `time="2026-09-02T07:15:48+02:00" level=info msg=${JSON.stringify(event)} source=console`;
  const result = buildEvidence(log, { metrics: {} }, "scale");
  assert.equal(result.completedAt, "2026-09-02T05:15:48.861Z");
  assert.equal(result.replicaCount, 2);
});
