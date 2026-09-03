import { hostname } from "node:os";
import { z } from "zod";
import { collectDefaultMetrics } from "prom-client";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createMetrics } from "./metrics.js";
import { createReadiness } from "./readiness.js";
import { registerGracefulShutdown } from "./shutdown.js";
import { RedisStateStore } from "./infrastructure/redis-state-store.js";
import type { CircuitState } from "./infrastructure/circuit-breaker.js";
import { createRateLimitStore } from "./rate-limit-store.js";

// Fail fast : une configuration invalide arrête le process avant tout démarrage
// de serveur, avec la liste lisible des variables fautives.
let config: Config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error(`Configuration invalide :\n${z.prettifyError(error)}`);
  } else {
    console.error(error);
  }
  process.exit(1);
}

const metrics = createMetrics();
// Métriques process (heap, GC, event-loop lag) : ici, pas dans createMetrics(),
// pour ne pas poser de timer dans les tests.
collectDefaultMetrics({ register: metrics.registry });

const readiness = createReadiness();

let reportCircuitTransition = (_from: CircuitState, _to: CircuitState) => {};
let reportRedisError = (_error: Error) => {};
let reportAvailability = (_from: string, _to: string) => {};
const stateStore = new RedisStateStore({
  url: config.redisUrl,
  hmacSecret: config.redisHmacSecret,
  velocityWindowSeconds: config.velocityWindowSeconds,
  commandTimeoutMs: config.redisCommandTimeoutMs,
  circuitFailureThreshold: config.redisCircuitFailureThreshold,
  circuitResetMs: config.redisCircuitResetMs,
  idempotencyTtlSeconds: config.idempotencyTtlSeconds,
  idempotencyLockMs: config.idempotencyLockMs,
  idempotencyWaitMs: config.idempotencyWaitMs,
  onCircuitTransition: (from, to) => reportCircuitTransition(from, to),
  onAvailabilityChange: (from, to) => reportAvailability(from, to),
  onClientError: (error) => reportRedisError(error),
});
const rateLimitStore = createRateLimitStore(stateStore, () => metrics.recordRateLimitFallback());

const app = buildApp({
  config,
  velocityStore: stateStore,
  idempotencyStore: stateStore,
  metrics,
  readiness,
  // En conteneur, le nom d'hôte est l'identifiant du conteneur.
  instanceId: process.env.INSTANCE_ID ?? hostname(),
  sharedStateStatus: () => stateStore.availability,
  rateLimitStore,
});

reportCircuitTransition = (from, to) => {
  const level = to === "CLOSED" ? "info" : "warn";
  metrics.recordCircuitTransition({ from, to });
  app.log[level]({ event: "redis_circuit_transition", from, to }, "Redis circuit changed state");
};
reportRedisError = (error) => {
  app.log.error({ event: "redis_client_error", errorType: error.name }, "Redis client error");
};
reportAvailability = (from, to) => {
  const event = to === "available" ? "redis_recovered" : "redis_unavailable";
  const level = to === "available" ? "info" : "warn";
  app.log[level]({ event, from, to }, "Redis availability changed");
};
app.addHook("onClose", async () => stateStore.close());

try {
  try {
    await stateStore.probe();
  } catch (error) {
    app.log.warn(
      {
        event: "redis_initial_probe_failed",
        errorType: error instanceof Error ? error.name : "UnknownError",
      },
      "Redis initial probe failed; starting in degraded mode",
    );
  }

  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info({ event: "server_listening", address }, "server listening");

  // Le canal IPC permet aux tests d'intégration et aux superviseurs de
  // détecter la disponibilité sans dépendre du format humain des logs.
  process.send?.({ event: "server_listening", address });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

// SIGTERM / SIGINT : /ready passe à 503, on laisse le load balancer nous retirer,
// puis on draine les requêtes en cours et on sort.
registerGracefulShutdown(app, {
  timeoutMs: config.shutdownTimeoutMs,
  drainDelayMs: config.shutdownDelayMs,
  onShutdownStart: () => readiness.beginShutdown(),
});
