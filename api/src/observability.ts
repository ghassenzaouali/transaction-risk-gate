import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";
import type { Config } from "./config.js";

export const REDACTED_LOG_PATHS = Object.freeze([
  "headers",
  "req.headers",
  "request.headers",
  "body",
  "payload",
  "transaction",
  "cardId",
  "transactionId",
  "idempotencyKey",
  "apiKey",
  "redisHmacSecret",
  "loadTestToken",
  "*.headers",
  "*.body",
  "*.payload",
  "*.transaction",
  "*.cardId",
  "*.transactionId",
  "*.idempotencyKey",
  "*.apiKey",
  "*.redisHmacSecret",
  "*.loadTestToken",
]);

export function createLoggerOptions(config: Config, instanceId: string): LoggerOptions {
  return {
    level: config.logLevel,
    base: {
      service: "transaction-risk-gate-api",
      environment: config.appEnvironment,
      version: config.appVersion,
      instanceId,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [...REDACTED_LOG_PATHS],
      censor: "[REDACTED]",
    },
  };
}

export function createAppLogger(
  config: Config,
  instanceId: string,
  destination?: DestinationStream,
): Logger {
  const options = createLoggerOptions(config, instanceId);
  return destination === undefined ? pino(options) : pino(options, destination);
}
