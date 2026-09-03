import { test } from "node:test";
import assert from "node:assert/strict";
import type { RiskPolicy, Transaction } from "../domain/risk-engine.js";
import type { VelocityStore } from "../velocity-store.js";
import { evaluateTransaction } from "./evaluate-transaction.js";

const policy: RiskPolicy = {
  amountThreshold: 1000,
  velocityMax: 3,
  velocityWindowSeconds: 60,
  allowedCountries: ["FR"],
  highRiskMerchantCategories: ["crypto"],
};

const transaction: Transaction = {
  transactionId: "txn_1",
  cardId: "card_1",
  amount: 20,
  currency: "EUR",
  country: "FR",
  channel: "in_store",
  merchantCategory: "grocery",
};

test("records velocity once and delegates the returned context to the domain", async () => {
  const observedCardIds: string[] = [];
  const store: VelocityStore = {
    hit: async (cardId) => {
      observedCardIds.push(cardId);
      return 4;
    },
  };

  const result = await evaluateTransaction(transaction, policy, store);

  assert.deepEqual(observedCardIds, ["card_1"]);
  assert.equal(result.score, 30);
  assert.equal(result.decision, "REVIEW");
  assert.equal(result.reasons[0]?.rule, "VELOCITY");
});

test("propagates a velocity dependency failure without fabricating a decision", async () => {
  const store: VelocityStore = {
    hit: () => Promise.reject(new Error("velocity unavailable")),
  };

  await assert.rejects(
    () => evaluateTransaction(transaction, policy, store),
    /velocity unavailable/,
  );
});
