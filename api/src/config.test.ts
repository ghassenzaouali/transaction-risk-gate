import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { loadConfig } from "./config.js";

// Environnement minimal valide : uniquement les variables métier requises.
// HOST / PORT sont volontairement omis pour vérifier leurs défauts.
const requiredEnv: NodeJS.ProcessEnv = {
  API_KEY: randomBytes(32).toString("hex"),
  REDIS_URL: "redis://127.0.0.1:6379",
  REDIS_HMAC_SECRET: randomBytes(32).toString("hex"),
  AMOUNT_THRESHOLD: "1000",
  VELOCITY_MAX: "3",
  VELOCITY_WINDOW_SECONDS: "60",
  ALLOWED_COUNTRIES: "FR,DE",
  HIGH_RISK_MERCHANT_CATEGORIES: "gambling,crypto",
};

test("loadConfig applies HOST/PORT/LOG_LEVEL defaults when the rest is provided", () => {
  const config = loadConfig({ ...requiredEnv });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 3000);
  assert.equal(config.appEnvironment, "local");
  assert.equal(config.appVersion, "dev");
  assert.equal(config.logLevel, "info");
  assert.equal(config.bodyLimitBytes, 16_384);
  assert.equal(config.rateLimitMax, 60);
  assert.equal(config.rateLimitLoadMax, 5_000);
  assert.equal(config.rateLimitWindowMs, 60_000);
  assert.equal(config.trustProxyHops, 0);
  assert.equal(config.shutdownTimeoutMs, 10_000);
  assert.equal(config.shutdownDelayMs, 5_000);
  assert.equal(config.redisCommandTimeoutMs, 250);
  assert.equal(config.redisCircuitFailureThreshold, 3);
  assert.equal(config.redisCircuitResetMs, 10_000);
  assert.equal(config.idempotencyTtlSeconds, 86_400);
  assert.equal(config.idempotencyLockMs, 5_000);
  assert.equal(config.idempotencyWaitMs, 2_000);
});

test("loadConfig rejects an unknown LOG_LEVEL", () => {
  assert.throws(() => loadConfig({ ...requiredEnv, LOG_LEVEL: "verbose" }), z.ZodError);
});

test("loadConfig reads and coerces provided variables", () => {
  const config = loadConfig({ ...requiredEnv, HOST: "127.0.0.1", PORT: "8080" });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8080);
});

test("loadConfig throws a ZodError on a non-numeric PORT", () => {
  assert.throws(() => loadConfig({ ...requiredEnv, PORT: "abc" }), z.ZodError);
});

test("loadConfig throws a ZodError on an out-of-range PORT", () => {
  assert.throws(() => loadConfig({ ...requiredEnv, PORT: "70000" }), z.ZodError);
});

test("loadConfig throws when a required rule threshold is missing", () => {
  const { AMOUNT_THRESHOLD: _omitted, ...withoutThreshold } = requiredEnv;
  assert.throws(() => loadConfig(withoutThreshold), z.ZodError);
});

test("loadConfig rejects unsafe rule thresholds", () => {
  for (const AMOUNT_THRESHOLD of ["0", "-1", "Infinity", "1000000001"]) {
    assert.throws(() => loadConfig({ ...requiredEnv, AMOUNT_THRESHOLD }), z.ZodError);
  }
  for (const VELOCITY_MAX of ["0", "1.5", "10001"]) {
    assert.throws(() => loadConfig({ ...requiredEnv, VELOCITY_MAX }), z.ZodError);
  }
  for (const VELOCITY_WINDOW_SECONDS of ["0", "1.5", "3601"]) {
    assert.throws(() => loadConfig({ ...requiredEnv, VELOCITY_WINDOW_SECONDS }), z.ZodError);
  }
});

test("loadConfig throws when API_KEY is missing", () => {
  const { API_KEY: _omitted, ...withoutKey } = requiredEnv;
  assert.throws(() => loadConfig(withoutKey), z.ZodError);
});

test("loadConfig rejects short interservice secrets", () => {
  assert.throws(() => loadConfig({ ...requiredEnv, API_KEY: "too-short" }), z.ZodError);
});

test("load test profile is forbidden in production", () => {
  assert.throws(
    () =>
      loadConfig({
        ...requiredEnv,
        APP_ENVIRONMENT: "production",
        LOAD_TEST_TOKEN: "test-load-token-with-at-least-32-bytes",
      }),
    z.ZodError,
  );
  const nonProduction = loadConfig({
    ...requiredEnv,
    APP_ENVIRONMENT: "integration",
    LOAD_TEST_TOKEN: "test-load-token-with-at-least-32-bytes",
  });
  assert.equal(nonProduction.loadTestToken, "test-load-token-with-at-least-32-bytes");
});

test("load test ceiling cannot be lower than the public ceiling", () => {
  assert.throws(
    () => loadConfig({ ...requiredEnv, RATE_LIMIT_MAX: "100", RATE_LIMIT_LOAD_MAX: "99" }),
    z.ZodError,
  );
});

test("loadConfig rejects invalid Redis safety configuration", () => {
  assert.throws(
    () => loadConfig({ ...requiredEnv, REDIS_URL: "https://redis.example" }),
    z.ZodError,
  );
  assert.throws(() => loadConfig({ ...requiredEnv, REDIS_HMAC_SECRET: "too-short" }), z.ZodError);
  assert.throws(() => loadConfig({ ...requiredEnv, REDIS_COMMAND_TIMEOUT_MS: "0" }), z.ZodError);
  assert.throws(() => loadConfig({ ...requiredEnv, IDEMPOTENCY_TTL_SECONDS: "59" }), z.ZodError);
});

test("loadConfig parses and normalizes a CSV list", () => {
  const config = loadConfig({ ...requiredEnv, ALLOWED_COUNTRIES: "fr, de , es" });
  assert.deepEqual(config.allowedCountries, ["FR", "DE", "ES"]);
});

test("loadConfig rejects a malformed country code", () => {
  assert.throws(() => loadConfig({ ...requiredEnv, ALLOWED_COUNTRIES: "FR,DEU" }), z.ZodError);
});

test("loadConfig rejects duplicate normalized configuration entries", () => {
  assert.throws(() => loadConfig({ ...requiredEnv, ALLOWED_COUNTRIES: "FR,fr" }), z.ZodError);
  assert.throws(
    () =>
      loadConfig({
        ...requiredEnv,
        HIGH_RISK_MERCHANT_CATEGORIES: "crypto,Crypto",
      }),
    z.ZodError,
  );
});

test("the returned config is frozen", () => {
  const config = loadConfig({ ...requiredEnv });
  assert.throws(() => {
    // @ts-expect-error -- mutation interdite au typage comme à l'exécution
    config.port = 1;
  }, TypeError);
});

test("the config list values are frozen too, not just the parent object", () => {
  const config = loadConfig({ ...requiredEnv });
  assert.ok(Object.isFrozen(config.allowedCountries));
  assert.throws(() => {
    (config.allowedCountries as string[]).push("US");
  }, TypeError);
});
