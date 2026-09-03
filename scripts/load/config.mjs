const profiles = Object.freeze({
  baseline: Object.freeze({
    executor: "constant-vus",
    vus: 5,
    duration: "30s",
  }),
  scale: Object.freeze({
    executor: "ramping-vus",
    startVUs: 0,
    stages: Object.freeze([
      Object.freeze({ duration: "30s", target: 5 }),
      Object.freeze({ duration: "60s", target: 50 }),
      Object.freeze({ duration: "60s", target: 150 }),
      Object.freeze({ duration: "30s", target: 0 }),
    ]),
    gracefulRampDown: "15s",
  }),
  stress: Object.freeze({
    executor: "ramping-vus",
    startVUs: 0,
    stages: Object.freeze([
      Object.freeze({ duration: "30s", target: 50 }),
      Object.freeze({ duration: "60s", target: 150 }),
      Object.freeze({ duration: "60s", target: 300 }),
      Object.freeze({ duration: "30s", target: 0 }),
    ]),
    gracefulRampDown: "15s",
  }),
});

export const performanceTargets = Object.freeze({
  baseline: Object.freeze({
    errorRate: 0.01,
    p95Ms: 250,
    p99Ms: 500,
    checkRate: 0.99,
  }),
  scale: Object.freeze({
    errorRate: 0.01,
    p95Ms: 750,
    p99Ms: 1000,
    checkRate: 0.99,
  }),
  stress: Object.freeze({
    errorRate: 0.01,
    p95Ms: 1250,
    p99Ms: 1750,
    checkRate: 0.99,
  }),
});

export function createLoadOptions(profileName = "baseline") {
  const profile = profiles[profileName];
  if (!profile) {
    throw new Error(`unknown load profile '${profileName}'`);
  }
  const targets = performanceTargets[profileName];

  const scenario = {
    ...profile,
    ...(profile.stages === undefined
      ? {}
      : { stages: profile.stages.map((stage) => ({ ...stage })) }),
    exec: "evaluateDecision",
  };

  // k6 complète cet objet à l'initialisation de chaque VU : il doit rester
  // mutable même si les profils sources sont immuables.
  return {
    discardResponseBodies: false,
    summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
    scenarios: { decisions: scenario },
    thresholds: {
      http_req_failed: [`rate<${targets.errorRate}`],
      http_req_duration: [`p(95)<${targets.p95Ms}`, `p(99)<${targets.p99Ms}`],
      checks: [`rate>${targets.checkRate}`],
    },
  };
}

export function requiresMultipleReplicas(profileName) {
  return profileName === "scale" || profileName === "stress";
}
