import { randomUUID } from "node:crypto";
import Fastify, { LogController, type FastifyError, type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { FastifyRateLimitStoreCtor } from "@fastify/rate-limit";
import type { Config } from "./config.js";
import type { VelocityStore } from "./velocity-store.js";
import type { IdempotencyStore } from "./idempotency-store.js";
import type { Metrics } from "./metrics.js";
import type { Readiness } from "./readiness.js";
import { keyIsValid, registerApiKeyAuth } from "./auth.js";
import { registerDecisions } from "./decisions.js";
import { describeRules } from "./domain/risk-engine.js";
import { createLoggerOptions } from "./observability.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export type RateLimitProfile = "public" | "load";

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function rateLimitProfile(
  headers: Record<string, unknown>,
  config: Config,
): RateLimitProfile {
  const provided = headers["x-load-test-token"];
  if (
    config.appEnvironment !== "production" &&
    config.loadTestToken !== undefined &&
    typeof provided === "string" &&
    keyIsValid(provided, config.loadTestToken)
  ) {
    return "load";
  }
  return "public";
}

/** Tout ce dont l'application a besoin, injecté depuis `server.ts` (ou les tests). */
export type AppDeps = {
  config: Config;
  velocityStore: VelocityStore;
  idempotencyStore: IdempotencyStore;
  metrics: Metrics;
  readiness: Readiness;
  instanceId: string;
  sharedStateStatus?: () => "unknown" | "available" | "unavailable";
  rateLimitStore?: FastifyRateLimitStoreCtor;
};

/**
 * Fabrique l'instance Fastify et enregistre les routes.
 * Séparée de `server.ts` pour permettre `app.inject()` en test sans socket.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: createLoggerOptions(deps.config, deps.instanceId),
    logController: new LogController({
      disableRequestLogging: true,
      requestIdLogLabel: "requestId",
    }),
    bodyLimit: deps.config.bodyLimitBytes,
    connectionTimeout: deps.config.connectionTimeoutMs,
    requestTimeout: deps.config.requestTimeoutMs,
    keepAliveTimeout: deps.config.keepAliveTimeoutMs,
    maxRequestsPerSocket: deps.config.maxRequestsPerSocket,
    routerOptions: { maxParamLength: 64 },
    trustProxy:
      deps.config.trustProxyHops === 0
        ? false
        : (_address: string, hop: number) => hop < deps.config.trustProxyHops,
    // Réutilise l'id fourni par un proxy/nginx s'il existe, sinon en génère un.
    genReqId: (req) => {
      const header = req.headers["x-request-id"];
      return validRequestId(header) ? header : randomUUID();
    },
  });

  const pendingRequests = new WeakSet<object>();
  const finishRequest = (request: object) => {
    if (!pendingRequests.has(request)) return;
    pendingRequests.delete(request);
    deps.metrics.requestFinished();
  };

  app.addHook("onRequest", (request, reply, done) => {
    pendingRequests.add(request);
    deps.metrics.requestStarted();

    // Quel conteneur traite la requête (interface : compte des replicas) + trace.
    reply.header("X-Instance-Id", deps.instanceId);
    reply.header("X-Request-Id", request.id);

    const rawRequestId = request.headers["x-request-id"];
    if (rawRequestId !== undefined && !validRequestId(rawRequestId)) {
      deps.metrics.recordRequestFailure("invalid_request_id");
      request.log.warn(
        { event: "request_rejected", reason: "invalid_request_id" },
        "unsafe request identifier rejected",
      );
      void reply.code(400).send({ error: "invalid_request_id" });
      return;
    }

    const loadToken = request.headers["x-load-test-token"];
    if (
      loadToken !== undefined &&
      (typeof loadToken !== "string" || loadToken.length < 32 || loadToken.length > 256)
    ) {
      deps.metrics.recordRequestFailure("invalid_load_test_token");
      request.log.warn(
        { event: "request_rejected", reason: "invalid_load_test_token" },
        "invalid load test token header rejected",
      );
      void reply.code(400).send({ error: "invalid_load_test_token" });
      return;
    }
    done();
  });

  app.addHook("onResponse", (request, reply, done) => {
    finishRequest(request);
    deps.metrics.recordHttpRequest({
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      statusCode: reply.statusCode,
      durationSeconds: reply.elapsedTime / 1000,
    });
    request.log.info(
      {
        event: "http_request_completed",
        method: request.method,
        route: request.routeOptions.url ?? "unmatched",
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      "HTTP request completed",
    );
    done();
  });

  app.addHook("onRequestAbort", (request, done) => {
    finishRequest(request);
    deps.metrics.recordRequestAborted("aborted");
    request.log.warn({ event: "http_request_aborted" }, "request aborted");
    done();
  });

  app.addHook("onTimeout", (request, _reply, done) => {
    finishRequest(request);
    deps.metrics.recordRequestAborted("timeout");
    request.log.warn({ event: "http_request_timeout" }, "request timed out");
    done();
  });

  app.addHook("onSend", (_request, reply, payload, done) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    done(null, payload);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const clientError =
      typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500;
    const code =
      error.code === "FST_ERR_CTP_BODY_TOO_LARGE"
        ? "payload_too_large"
        : error.statusCode === 429
          ? "rate_limit_exceeded"
          : clientError
            ? "invalid_request"
            : "request_failed";
    const statusCode =
      code === "payload_too_large"
        ? 413
        : code === "rate_limit_exceeded"
          ? 429
          : clientError
            ? (error.statusCode ?? 400)
            : 500;
    deps.metrics.recordRequestFailure(code);
    const level = statusCode >= 500 ? "error" : "warn";
    request.log[level](
      { event: "request_failed", code, statusCode, errorType: error.name },
      "request processing failed",
    );
    return reply
      .code(statusCode >= 400 && statusCode < 600 ? statusCode : 500)
      .send({ error: code });
  });

  // Les routes vivent dans le même contexte que le plugin. L'enregistrement
  // asynchrone garantit que le hook de rate limiting existe avant les routes.
  app.register(async (routes) => {
    await routes.register(rateLimit, {
      global: true,
      hook: "onRequest",
      timeWindow: deps.config.rateLimitWindowMs,
      max: (request) =>
        rateLimitProfile(request.headers, deps.config) === "load"
          ? deps.config.rateLimitLoadMax
          : deps.config.rateLimitMax,
      keyGenerator: (request) => `${rateLimitProfile(request.headers, deps.config)}:${request.ip}`,
      allowList: (request) => !request.url.startsWith("/api/"),
      enableDraftSpec: true,
      skipOnError: false,
      ...(deps.rateLimitStore === undefined ? {} : { store: deps.rateLimitStore }),
      onExceeded: (request) => {
        const profile = rateLimitProfile(request.headers, deps.config);
        deps.metrics.recordRateLimitExceeded(profile);
        request.log.warn({ event: "rate_limit_exceeded", profile }, "request rate limited");
      },
    });

    // Le rate limiter précède l'authentification pour compter aussi les tentatives
    // invalides et limiter les attaques par force brute.
    registerApiKeyAuth(routes, deps.config.apiKey, () => deps.metrics.recordAuthFailure());

    routes.addHook("preValidation", (request, reply, done) => {
      if (request.routeOptions.url === "/api/decisions" && request.method === "POST") {
        const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
        if (contentType !== "application/json") {
          deps.metrics.recordRequestFailure("unsupported_media_type");
          void reply.code(415).send({ error: "unsupported_media_type" });
          return;
        }
      }
      if (request.url.includes("?")) {
        deps.metrics.recordRequestFailure("unexpected_query");
        void reply.code(400).send({ error: "unexpected_query" });
        return;
      }
      done();
    });

    // Liveness : le process répond-il ? Ne teste aucune dépendance externe.
    routes.get("/health", async () => ({ status: "ok" }));

    routes.get("/ready", async (_request, reply) => {
      if (deps.readiness.isReady()) {
        const redis = deps.sharedStateStatus?.() ?? "available";
        return {
          status: "ready",
          mode: redis === "available" ? "normal" : "degraded",
          dependencies: { redis },
        };
      }
      return reply.code(503).send({ status: "shutting_down" });
    });

    routes.get("/metrics", async (_request, reply) => {
      reply.header("Content-Type", deps.metrics.registry.contentType);
      return deps.metrics.registry.metrics();
    });

    routes.get("/api/rules", async () => describeRules(deps.config));
    registerDecisions(routes, deps);
  });

  return app;
}
