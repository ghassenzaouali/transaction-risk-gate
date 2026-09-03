import http from "k6/http";
import { check, fail } from "k6";
import exec from "k6/execution";
import { createLoadOptions, requiresMultipleReplicas } from "./config.mjs";

const profile = __ENV.LOAD_PROFILE || "baseline";
const baseUrl = (__ENV.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const loadToken = __ENV.LOAD_TEST_TOKEN || "";

export const options = createLoadOptions(profile);

function headers(id) {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": id,
    "X-Request-Id": id,
    "X-Load-Test-Token": loadToken,
  };
}

function safeJson(response) {
  try {
    return response.json();
  } catch {
    return {};
  }
}

function instanceId(response) {
  return response.headers["X-Instance-Id"] || response.headers["x-instance-id"] || "unknown";
}

export function setup() {
  const localTarget = /^http:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal)(:\d+)?$/.test(
    baseUrl,
  );
  if (!baseUrl || (!baseUrl.startsWith("https://") && !localTarget)) {
    fail("PUBLIC_BASE_URL HTTPS est requis hors localhost");
  }
  if (loadToken.length < 32)
    fail("LOAD_TEST_TOKEN est requis et doit contenir au moins 32 caractères");

  const ready = http.get(`${baseUrl}/ready`, { tags: { operation: "ready" } });
  const rules = http.get(`${baseUrl}/api/rules`, { tags: { operation: "rules" } });
  check(ready, {
    "readiness normal avant charge": (response) =>
      response.status === 200 && safeJson(response).mode === "normal",
  });
  check(rules, {
    "contrat EUR et cinq règles": (response) => {
      const body = safeJson(response);
      return response.status === 200 && body.currency === "EUR" && body.rules?.length === 5;
    },
  });
  return { startedAt: new Date().toISOString() };
}

export function evaluateDecision() {
  const suffix = `${profile}-${exec.vu.idInTest}-${exec.scenario.iterationInTest}`;
  const transaction = {
    transactionId: `load-${suffix}`,
    cardId: `load-card-${suffix}`,
    amount: 20,
    currency: "EUR",
    country: "FR",
    channel: "in_store",
    merchantCategory: "grocery",
  };
  const response = http.post(`${baseUrl}/api/decisions`, JSON.stringify(transaction), {
    headers: headers(`load-${suffix}`),
    tags: { operation: "decision", profile },
  });
  const body = safeJson(response);
  check(response, {
    "décision HTTP 200": (value) => value.status === 200,
    "décision non dégradée": () => body.degraded === false,
    "décision expliquée": () =>
      ["APPROVED", "REVIEW", "REJECTED"].includes(body.decision) && Number.isInteger(body.score),
    "instance identifiable": (value) => instanceId(value) !== "unknown",
  });
}

export function teardown(data) {
  const replicaRequests = Array.from({ length: 100 }, (_, index) => ({
    method: "GET",
    url: `${baseUrl}/ready`,
    params: {
      headers: { "X-Request-Id": `replica-${Date.now()}-${index}` },
      tags: { operation: "replica_probe" },
    },
  }));
  const replicaResponses = http.batch(replicaRequests);
  const replicas = [...new Set(replicaResponses.map(instanceId).filter((id) => id !== "unknown"))];

  const velocityId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const velocityRequests = Array.from({ length: 8 }, (_, index) => {
    const id = `velocity-${velocityId}-${index}`;
    return {
      method: "POST",
      url: `${baseUrl}/api/decisions`,
      body: JSON.stringify({
        transactionId: id,
        cardId: `shared-card-${velocityId}`,
        amount: 20,
        currency: "EUR",
        country: "FR",
        channel: "in_store",
        merchantCategory: "grocery",
      }),
      params: { headers: headers(id), tags: { operation: "velocity_probe" } },
    };
  });
  const velocityResponses = http.batch(velocityRequests);
  const velocityDecisions = velocityResponses.map(safeJson);
  const velocityTriggered = velocityDecisions.filter((decision) =>
    decision.reasons?.some((reason) => reason.rule === "VELOCITY"),
  ).length;
  const velocityReplicas = [
    ...new Set(velocityResponses.map(instanceId).filter((id) => id !== "unknown")),
  ];

  const replicaCheck = check(replicas, {
    "au moins un replica observé": (values) => values.length >= 1,
    "plusieurs replicas sous montée en charge": (values) =>
      !requiresMultipleReplicas(profile) || values.length >= 2,
  });
  const velocityCheck = check(velocityDecisions, {
    "vélocité Redis cohérente": (values) =>
      values.length === 8 &&
      values.every((value) => value.degraded === false) &&
      velocityTriggered >= 5,
  });

  console.log(
    JSON.stringify({
      event: "load_evidence",
      profile,
      startedAt: data.startedAt,
      completedAt: new Date().toISOString(),
      replicas,
      replicaCount: replicas.length,
      velocityReplicas,
      velocityTriggered,
      replicaCheck,
      velocityCheck,
    }),
  );
}

export function handleSummary(data) {
  const target = __ENV.K6_SUMMARY_PATH || "artifacts/k6-summary.json";
  return {
    [target]: JSON.stringify(data, null, 2),
    stdout: `\nRésumé k6 ${profile}: ${data.state?.testRunDurationMs ?? 0} ms\n`,
  };
}
