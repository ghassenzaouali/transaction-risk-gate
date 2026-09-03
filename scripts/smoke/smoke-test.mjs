import process from "node:process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_INTERVAL_MS = 5_000;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  invariant(
    url.protocol === "https:" || url.hostname === "127.0.0.1",
    "HTTPS est obligatoire hors localhost",
  );
  return url.toString().replace(/\/$/, "");
}

async function requestJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    signal: AbortSignal.timeout(10_000),
  });
  invariant(response.ok, `${options.method ?? "GET"} ${url} a répondu HTTP ${response.status}`);
  return { response, body: await response.json() };
}

export async function runSmokeOnce(fetchImpl, rawBaseUrl, id = randomUUID()) {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  const health = await fetchImpl(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(10_000) });
  invariant(health.ok, `/healthz a répondu HTTP ${health.status}`);
  invariant((await health.text()).trim() === "ok", "/healthz ne renvoie pas ok");

  const { body: ready } = await requestJson(fetchImpl, `${baseUrl}/ready`);
  invariant(ready.status === "ready", "/ready ne signale pas ready");
  invariant(ready.mode === "normal", "/ready signale un mode dégradé");
  invariant(ready.dependencies?.redis === "available", "/ready ne confirme pas Redis");

  const { body: rules } = await requestJson(fetchImpl, `${baseUrl}/api/rules`);
  invariant(rules.currency === "EUR", "le contrat métier ne signale pas EUR");
  invariant(
    Array.isArray(rules.rules) && rules.rules.length === 5,
    "les cinq règles ne sont pas actives",
  );
  invariant(
    rules.rules.reduce((sum, rule) => sum + rule.weight, 0) === 100,
    "les poids ne totalisent pas 100",
  );

  const transaction = {
    transactionId: `smoke_${id}`,
    cardId: `smoke_card_${id}`,
    amount: 20,
    currency: "EUR",
    country: "FR",
    channel: "in_store",
    merchantCategory: "grocery",
  };
  const headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": `smoke-${id}`,
    "X-Request-Id": `smoke.${id}`,
  };
  const options = { method: "POST", headers, body: JSON.stringify(transaction) };
  const first = await requestJson(fetchImpl, `${baseUrl}/api/decisions`, options);
  invariant(
    first.body.decision === "APPROVED",
    "la transaction synthétique saine n'est pas APPROVED",
  );
  invariant(first.body.degraded === false, "la décision synthétique est dégradée");
  invariant(first.response.headers.get("x-instance-id"), "X-Instance-Id est absent");

  const replay = await requestJson(fetchImpl, `${baseUrl}/api/decisions`, options);
  invariant(
    replay.body.decisionId === first.body.decisionId,
    "le rejeu idempotent diffère de la première réponse",
  );

  return Object.freeze({
    baseUrl,
    mode: ready.mode,
    redis: ready.dependencies.redis,
    rules: rules.rules.length,
    decision: first.body.decision,
    decisionId: first.body.decisionId,
    instanceId: first.response.headers.get("x-instance-id"),
    replayed: true,
  });
}

export async function runSmokeWithRetry(
  fetchImpl,
  baseUrl,
  { timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = DEFAULT_INTERVAL_MS } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      return await runSmokeOnce(fetchImpl, baseUrl);
    } catch (error) {
      lastError = error;
      if (Date.now() + intervalMs > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  } while (Date.now() < deadline);
  throw new Error(`Smoke test impossible après ${timeoutMs} ms`, { cause: lastError });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.env.PUBLIC_BASE_URL ?? process.argv[2];
  invariant(baseUrl, "PUBLIC_BASE_URL ou un premier argument est requis");
  const summary = await runSmokeWithRetry(fetch, baseUrl);
  console.log(JSON.stringify({ event: "smoke_passed", ...summary }));
}
