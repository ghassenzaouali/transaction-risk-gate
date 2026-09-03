import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_CURRENCY, TransactionSchema } from "./transaction.js";

const validInput = {
  transactionId: "txn_1",
  cardId: "card_1",
  amount: 20,
  currency: "EUR",
  country: "FR",
  channel: "in_store",
  merchantCategory: "grocery",
};

test("accepts and normalizes a valid EUR transaction", () => {
  const parsed = TransactionSchema.parse({
    ...validInput,
    country: " fr ",
    currency: " eur ",
    merchantCategory: " Grocery ",
  });

  assert.equal(parsed.country, "FR");
  assert.equal(parsed.currency, SUPPORTED_CURRENCY);
  assert.equal(parsed.merchantCategory, "grocery");
});

test("rejects every currency except EUR", () => {
  for (const currency of ["USD", "GBP", "CHF"]) {
    assert.equal(TransactionSchema.safeParse({ ...validInput, currency }).success, false);
  }
});

test("rejects missing, unknown and malformed fields", () => {
  const { amount: _omitted, ...withoutAmount } = validInput;
  assert.equal(TransactionSchema.safeParse(withoutAmount).success, false);
  assert.equal(TransactionSchema.safeParse({ ...validInput, unexpected: true }).success, false);
  assert.equal(
    TransactionSchema.safeParse({ ...validInput, merchantCategory: "crypto/currency" }).success,
    false,
  );
});

test("rejects invalid amounts, channels and oversized identifiers", () => {
  for (const amount of [-1, 0, Number.POSITIVE_INFINITY]) {
    assert.equal(TransactionSchema.safeParse({ ...validInput, amount }).success, false);
  }
  assert.equal(TransactionSchema.safeParse({ ...validInput, channel: "atm" }).success, false);
  assert.equal(
    TransactionSchema.safeParse({ ...validInput, transactionId: "x".repeat(65) }).success,
    false,
  );
});
