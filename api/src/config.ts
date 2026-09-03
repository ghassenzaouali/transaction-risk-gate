import { z } from "zod";

/** Une liste CSV d'items normalisés et validés un par un, non vide. */
function csvOf(normalize: (value: string) => string, itemPattern: RegExp) {
  return z
    .string()
    .transform((raw) =>
      raw
        .split(",")
        .map((part) => normalize(part.trim()))
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(itemPattern)).min(1).max(250))
    .refine((items) => new Set(items).size === items.length, {
      message: "configuration list must not contain duplicates",
    });
}

// Le schéma ne décrit que les variables qui ont un consommateur aujourd'hui.
// Chaque brique ajoute les siennes ici, dans le même commit que le code qui les
// lit — jamais de configuration morte dans le schéma.
//
// HOST / PORT : infrastructure, des défauts sûrs existent.
// Le reste : réglages métier, aucun défaut raisonnable — absent => arrêt immédiat.
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
const APP_ENVIRONMENTS = ["local", "integration", "preproduction", "production"] as const;

const redisUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("redis://") || value.startsWith("rediss://"), {
    message: "REDIS_URL must use redis:// or rediss://",
  });

const ConfigSchema = z
  .object({
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    APP_ENVIRONMENT: z.enum(APP_ENVIRONMENTS).default("local"),
    APP_VERSION: z.string().trim().min(1).max(64).default("dev"),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(16_384),
    CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(5_000),
    MAX_REQUESTS_PER_SOCKET: z.coerce.number().int().min(1).max(10_000).default(1_000),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(60),
    RATE_LIMIT_LOAD_MAX: z.coerce.number().int().min(1).max(1_000_000).default(5_000),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    LOAD_TEST_TOKEN: z.string().min(32).max(256).optional(),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    SHUTDOWN_DELAY_MS: z.coerce.number().int().nonnegative().default(5_000),

    API_KEY: z.string().min(32).max(256),
    REDIS_URL: redisUrl,
    REDIS_HMAC_SECRET: z.string().min(32).max(256),
    REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(50).max(5_000).default(250),
    REDIS_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(3),
    REDIS_CIRCUIT_RESET_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().min(60).max(604_800).default(86_400),
    IDEMPOTENCY_LOCK_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
    IDEMPOTENCY_WAIT_MS: z.coerce.number().int().min(100).max(10_000).default(2_000),
    AMOUNT_THRESHOLD: z.coerce.number().finite().positive().max(1_000_000_000),
    VELOCITY_MAX: z.coerce.number().int().positive().max(10_000),
    VELOCITY_WINDOW_SECONDS: z.coerce.number().int().positive().max(3_600),
    ALLOWED_COUNTRIES: csvOf((value) => value.toUpperCase(), /^[A-Z]{2}$/),
    HIGH_RISK_MERCHANT_CATEGORIES: csvOf((value) => value.toLowerCase(), /^[a-z][a-z0-9_]*$/),
  })
  .superRefine((config, context) => {
    if (config.RATE_LIMIT_LOAD_MAX < config.RATE_LIMIT_MAX) {
      context.addIssue({
        code: "custom",
        path: ["RATE_LIMIT_LOAD_MAX"],
        message: "RATE_LIMIT_LOAD_MAX must be greater than or equal to RATE_LIMIT_MAX",
      });
    }
    if (config.APP_ENVIRONMENT === "production" && config.LOAD_TEST_TOKEN !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["LOAD_TEST_TOKEN"],
        message: "LOAD_TEST_TOKEN is forbidden in production",
      });
    }
  });

export type Config = Readonly<{
  host: string;
  port: number;
  appEnvironment: (typeof APP_ENVIRONMENTS)[number];
  appVersion: string;
  logLevel: (typeof LOG_LEVELS)[number];
  bodyLimitBytes: number;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  keepAliveTimeoutMs: number;
  maxRequestsPerSocket: number;
  trustProxyHops: number;
  rateLimitMax: number;
  rateLimitLoadMax: number;
  rateLimitWindowMs: number;
  loadTestToken: string | undefined;
  shutdownTimeoutMs: number;
  shutdownDelayMs: number;
  apiKey: string;
  redisUrl: string;
  redisHmacSecret: string;
  redisCommandTimeoutMs: number;
  redisCircuitFailureThreshold: number;
  redisCircuitResetMs: number;
  idempotencyTtlSeconds: number;
  idempotencyLockMs: number;
  idempotencyWaitMs: number;
  amountThreshold: number;
  velocityMax: number;
  velocityWindowSeconds: number;
  allowedCountries: readonly string[];
  highRiskMerchantCategories: readonly string[];
}>;

/**
 * Valide l'environnement et renvoie la configuration typée et gelée.
 * Lève une `ZodError` si une variable est absente ou invalide — c'est
 * l'appelant (`server.ts`) qui décide d'arrêter le process.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.parse(env);
  return Object.freeze({
    host: parsed.HOST,
    port: parsed.PORT,
    appEnvironment: parsed.APP_ENVIRONMENT,
    appVersion: parsed.APP_VERSION,
    logLevel: parsed.LOG_LEVEL,
    bodyLimitBytes: parsed.BODY_LIMIT_BYTES,
    connectionTimeoutMs: parsed.CONNECTION_TIMEOUT_MS,
    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    keepAliveTimeoutMs: parsed.KEEP_ALIVE_TIMEOUT_MS,
    maxRequestsPerSocket: parsed.MAX_REQUESTS_PER_SOCKET,
    trustProxyHops: parsed.TRUST_PROXY_HOPS,
    rateLimitMax: parsed.RATE_LIMIT_MAX,
    rateLimitLoadMax: parsed.RATE_LIMIT_LOAD_MAX,
    rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
    loadTestToken: parsed.LOAD_TEST_TOKEN,
    shutdownTimeoutMs: parsed.SHUTDOWN_TIMEOUT_MS,
    shutdownDelayMs: parsed.SHUTDOWN_DELAY_MS,
    apiKey: parsed.API_KEY,
    redisUrl: parsed.REDIS_URL,
    redisHmacSecret: parsed.REDIS_HMAC_SECRET,
    redisCommandTimeoutMs: parsed.REDIS_COMMAND_TIMEOUT_MS,
    redisCircuitFailureThreshold: parsed.REDIS_CIRCUIT_FAILURE_THRESHOLD,
    redisCircuitResetMs: parsed.REDIS_CIRCUIT_RESET_MS,
    idempotencyTtlSeconds: parsed.IDEMPOTENCY_TTL_SECONDS,
    idempotencyLockMs: parsed.IDEMPOTENCY_LOCK_MS,
    idempotencyWaitMs: parsed.IDEMPOTENCY_WAIT_MS,
    amountThreshold: parsed.AMOUNT_THRESHOLD,
    velocityMax: parsed.VELOCITY_MAX,
    velocityWindowSeconds: parsed.VELOCITY_WINDOW_SECONDS,
    allowedCountries: Object.freeze(parsed.ALLOWED_COUNTRIES),
    highRiskMerchantCategories: Object.freeze(parsed.HIGH_RISK_MERCHANT_CATEGORIES),
  });
}
