import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  invariant(
    url.protocol === "https:" || ["127.0.0.1", "localhost"].includes(url.hostname),
    "HTTPS est obligatoire hors localhost",
  );
  return url.toString().replace(/\/$/, "");
}

export function assertDegradedDecision(response, body) {
  invariant(response.status === 200, `mode dégradé HTTP ${response.status}`);
  invariant(response.headers.get("x-degraded-mode") === "true", "X-Degraded-Mode est absent");
  invariant(body.decision === "REVIEW", "une panne Redis doit forcer REVIEW");
  invariant(body.degraded === true, "la décision de panne doit être dégradée");
  invariant(body.score >= 30, "le score dégradé doit atteindre le seuil REVIEW");
  invariant(
    body.reasons?.some((reason) => reason.rule === "RISK_CONTEXT_UNAVAILABLE"),
    "la raison de contexte indisponible est absente",
  );
}

export function assertRecoveredDecision(response, body) {
  invariant(response.status === 200, `rétablissement HTTP ${response.status}`);
  invariant(response.headers.get("x-degraded-mode") === null, "le header dégradé persiste");
  invariant(body.decision === "APPROVED", "la transaction saine n'est plus APPROVED");
  invariant(body.degraded === false, "la décision reste dégradée après rétablissement");
}

async function decision(baseUrl, suffix) {
  const response = await fetch(`${baseUrl}/api/decisions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `failure-${suffix}`,
      "X-Request-Id": `failure.${suffix}`,
    },
    body: JSON.stringify({
      transactionId: `failure-${suffix}`,
      cardId: `failure-card-${suffix}`,
      amount: 20,
      currency: "EUR",
      country: "FR",
      channel: "in_store",
      merchantCategory: "grocery",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  return { response, body: await response.json() };
}

function compose(...args) {
  execFileSync("docker", ["compose", ...args], { stdio: "inherit" });
}

export async function runRedisOutage(rawBaseUrl, { timeoutMs = 45_000 } = {}) {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const runId = randomUUID();
  let redisStopped = false;
  try {
    compose("stop", "redis");
    redisStopped = true;
    const degraded = await decision(baseUrl, `${runId}-degraded`);
    assertDegradedDecision(degraded.response, degraded.body);

    compose("start", "redis");
    redisStopped = false;
    const deadline = Date.now() + timeoutMs;
    let recovered;
    while (Date.now() < deadline) {
      await wait(1_000);
      const candidate = await decision(baseUrl, `${runId}-${Date.now()}`);
      if (candidate.body.degraded === false) {
        assertRecoveredDecision(candidate.response, candidate.body);
        recovered = candidate;
        break;
      }
    }
    invariant(recovered, `Redis ne s'est pas rétabli en ${timeoutMs} ms`);

    const readyResponse = await fetch(`${baseUrl}/ready`, { signal: AbortSignal.timeout(10_000) });
    const ready = await readyResponse.json();
    invariant(readyResponse.status === 200, `/ready HTTP ${readyResponse.status}`);
    invariant(ready.mode === "normal", "/ready ne revient pas en mode normal");
    invariant(ready.dependencies?.redis === "available", "/ready ne confirme pas Redis");

    return Object.freeze({
      event: "redis_failure_recovery_passed",
      degradedDecision: degraded.body.decision,
      degradedScore: degraded.body.score,
      recoveredDecision: recovered.body.decision,
      readyMode: ready.mode,
    });
  } finally {
    if (redisStopped) compose("start", "redis");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.env.PUBLIC_BASE_URL ?? process.argv[2] ?? "http://127.0.0.1:8080";
  console.log(JSON.stringify(await runRedisOutage(baseUrl)));
}
