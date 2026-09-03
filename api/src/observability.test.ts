import { test } from "node:test";
import assert from "node:assert/strict";
import type { DestinationStream } from "pino";
import { createAppLogger } from "./observability.js";
import { testConfig } from "./test-helpers.js";

test("structured logger redacts secrets, identifiers and payloads", () => {
  const chunks: string[] = [];
  const destination: DestinationStream = {
    write(chunk) {
      chunks.push(String(chunk));
    },
  };
  const logger = createAppLogger(
    { ...testConfig, logLevel: "info" },
    "instance-redaction",
    destination,
  );

  logger.info({
    event: "redaction_test",
    headers: {
      "x-api-key": "api-secret-never-visible",
      "idempotency-key": "idempotency-secret-never-visible",
    },
    context: {
      cardId: "card-never-visible",
      transactionId: "transaction-never-visible",
      payload: { amount: 999 },
    },
  });

  const output = chunks.join("");
  for (const sensitive of [
    "api-secret-never-visible",
    "idempotency-secret-never-visible",
    "card-never-visible",
    "transaction-never-visible",
    '"amount":999',
  ]) {
    assert.doesNotMatch(output, new RegExp(sensitive));
  }
  assert.match(output, /\[REDACTED\]/);
  assert.match(output, /"service":"transaction-risk-gate-api"/);
  assert.match(output, /"environment":"local"/);
  assert.match(output, /"version":"test"/);
  assert.match(output, /"instanceId":"instance-redaction"/);
});
