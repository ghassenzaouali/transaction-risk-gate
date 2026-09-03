import fs from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

export function buildEvidence(logSource, summary, profile) {
  const line = logSource
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.includes("load_evidence"));
  if (!line) throw new Error("load_evidence event is missing from k6 output");

  const message = line.startsWith("{")
    ? line
    : JSON.parse(`"${line.match(/\bmsg="((?:\\.|[^"])*)"/)?.[1] ?? ""}"`);
  const operational = JSON.parse(message);
  if (!operational.replicaCheck || !operational.velocityCheck) {
    throw new Error("replica or velocity evidence failed");
  }

  const metrics = summary.metrics ?? {};
  return Object.freeze({
    profile,
    completedAt: operational.completedAt,
    replicas: operational.replicas,
    replicaCount: operational.replicaCount,
    velocityReplicas: operational.velocityReplicas,
    velocityTriggered: operational.velocityTriggered,
    errorRate: metrics.http_req_failed?.values?.rate,
    p95Ms: metrics.http_req_duration?.values?.["p(95)"],
    p99Ms: metrics.http_req_duration?.values?.["p(99)"],
    checksRate: metrics.checks?.values?.rate,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [logPath, summaryPath, outputPath, profile = "baseline"] = process.argv.slice(2);
  if (!logPath || !summaryPath || !outputPath) {
    throw new Error("usage: evidence.mjs <k6.log> <summary.json> <evidence.json> [profile]");
  }
  const evidence = buildEvidence(
    fs.readFileSync(logPath, "utf8"),
    JSON.parse(fs.readFileSync(summaryPath, "utf8")),
    profile,
  );
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ event: "load_evidence_written", ...evidence }));
}
