import { Counter, Gauge, Histogram, Registry } from "prom-client";

export type HttpSample = {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
};

export type Metrics = {
  registry: Registry;
  recordHttpRequest(sample: HttpSample): void;
  recordDecision(sample: { decision: string; degraded: boolean }): void;
  recordSharedStateFailure(): void;
  recordCircuitTransition(sample: { from: string; to: string }): void;
  recordAuthFailure(): void;
  recordRateLimitExceeded(profile: "public" | "load"): void;
  recordRateLimitFallback(): void;
  recordRequestFailure(code: string): void;
  requestStarted(): void;
  requestFinished(): void;
  recordRequestAborted(reason: "aborted" | "timeout"): void;
};

/**
 * Fabrique un registre Prometheus neuf avec les métriques de l'application.
 * Un registre par appel (pas le registre global) : aucune collision entre
 * instances, notamment dans les tests. Les métriques process par défaut
 * (`collectDefaultMetrics`) sont branchées à part, dans `server.ts`.
 */
export function createMetrics(): Metrics {
  const registry = new Registry();

  const httpDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "Durée des requêtes HTTP, par route et code de statut",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const decisionsTotal = new Counter({
    name: "decisions_total",
    help: "Décisions rendues, par verdict et état de dégradation",
    labelNames: ["decision", "degraded"],
    registers: [registry],
  });

  const degradedDecisionsTotal = new Counter({
    name: "degraded_decisions_total",
    help: "Décisions forcées en revue car l'état partagé est indisponible",
    registers: [registry],
  });

  const sharedStateErrorsTotal = new Counter({
    name: "shared_state_errors_total",
    help: "Opérations d'état partagé ayant déclenché le mode fail-safe",
    registers: [registry],
  });

  const circuitTransitionsTotal = new Counter({
    name: "redis_circuit_transitions_total",
    help: "Transitions du circuit breaker Redis",
    labelNames: ["from", "to"],
    registers: [registry],
  });

  const authFailuresTotal = new Counter({
    name: "authentication_failures_total",
    help: "Requêtes métier rejetées pour authentification absente ou invalide",
    registers: [registry],
  });

  const rateLimitExceededTotal = new Counter({
    name: "rate_limit_exceeded_total",
    help: "Requêtes refusées par le rate limiting",
    labelNames: ["profile"],
    registers: [registry],
  });

  const rateLimitFallbackTotal = new Counter({
    name: "rate_limit_fallback_total",
    help: "Comptages servis par la protection locale pendant une panne Redis",
    registers: [registry],
  });

  const requestFailuresTotal = new Counter({
    name: "request_failures_total",
    help: "Requêtes refusées ou échouées par code stable",
    labelNames: ["code"],
    registers: [registry],
  });

  const inFlightRequests = new Gauge({
    name: "http_requests_in_flight",
    help: "Nombre de requêtes HTTP en cours dans cette instance",
    registers: [registry],
  });

  const requestAbortedTotal = new Counter({
    name: "http_requests_aborted_total",
    help: "Connexions abandonnées ou expirées",
    labelNames: ["reason"],
    registers: [registry],
  });

  return {
    registry,
    recordHttpRequest({ method, route, statusCode, durationSeconds }) {
      httpDuration.observe({ method, route, status_code: String(statusCode) }, durationSeconds);
    },
    recordDecision({ decision, degraded }) {
      decisionsTotal.inc({ decision, degraded: String(degraded) });
      if (degraded) degradedDecisionsTotal.inc();
    },
    recordSharedStateFailure() {
      sharedStateErrorsTotal.inc();
    },
    recordCircuitTransition({ from, to }) {
      circuitTransitionsTotal.inc({ from, to });
    },
    recordAuthFailure() {
      authFailuresTotal.inc();
    },
    recordRateLimitExceeded(profile) {
      rateLimitExceededTotal.inc({ profile });
    },
    recordRateLimitFallback() {
      rateLimitFallbackTotal.inc();
    },
    recordRequestFailure(code) {
      requestFailuresTotal.inc({ code });
    },
    requestStarted() {
      inFlightRequests.inc();
    },
    requestFinished() {
      inFlightRequests.dec();
    },
    recordRequestAborted(reason) {
      requestAbortedTotal.inc({ reason });
    },
  };
}
