import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SCORE,
  RULE_WEIGHTS,
  describeRules,
  evaluateDegradedRisk,
  evaluateRisk,
  scoreToDecision,
  type RiskPolicy,
  type Transaction,
} from "./risk-engine.js";

const policy: RiskPolicy = Object.freeze({
  amountThreshold: 1000,
  velocityMax: 3,
  velocityWindowSeconds: 60,
  allowedCountries: ["FR", "DE"],
  highRiskMerchantCategories: ["gambling", "crypto"],
});

const cleanTransaction: Transaction = Object.freeze({
  transactionId: "txn_1",
  cardId: "card_1",
  amount: 20,
  currency: "EUR",
  country: "FR",
  channel: "in_store",
  merchantCategory: "grocery",
});

const evaluate = (overrides: Partial<Transaction> = {}, velocityCount = 1) =>
  evaluateRisk({ ...cleanTransaction, ...overrides }, policy, { velocityCount });

test("the five immutable weights total exactly 100", () => {
  assert.deepEqual(RULE_WEIGHTS, {
    VELOCITY: 30,
    COUNTRY_RISK: 25,
    AMOUNT_THRESHOLD: 20,
    HIGH_RISK_MERCHANT: 15,
    CARD_NOT_PRESENT: 10,
  });
  assert.equal(MAX_SCORE, 100);
  assert.ok(Object.isFrozen(RULE_WEIGHTS));
});

test("scoreToDecision maps every exact band boundary", () => {
  assert.equal(scoreToDecision(0), "APPROVED");
  assert.equal(scoreToDecision(29), "APPROVED");
  assert.equal(scoreToDecision(30), "REVIEW");
  assert.equal(scoreToDecision(59), "REVIEW");
  assert.equal(scoreToDecision(60), "REJECTED");
  assert.equal(scoreToDecision(100), "REJECTED");
});

test("scoreToDecision rejects impossible domain scores", () => {
  for (const score of [-1, 1.5, 101, Number.NaN]) {
    assert.throws(() => scoreToDecision(score), RangeError);
  }
});

test("describeRules exposes five rules, EUR and the exact score bands", () => {
  const view = describeRules({ ...policy, amountThreshold: 2500, velocityMax: 7 });

  assert.equal(view.currency, "EUR");
  assert.equal(view.maxScore, 100);
  assert.deepEqual(view.scoreBands, {
    approved: { min: 0, max: 29 },
    review: { min: 30, max: 59 },
    rejected: { min: 60, max: 100 },
  });
  assert.deepEqual(
    view.rules.map((rule) => [rule.rule, rule.weight]),
    Object.entries(RULE_WEIGHTS),
  );
  assert.equal(
    view.rules.find((rule) => rule.rule === "AMOUNT_THRESHOLD")?.parameters.threshold,
    2500,
  );
});

test("a clean transaction is APPROVED with score 0", () => {
  assert.deepEqual(evaluate(), {
    score: 0,
    decision: "APPROVED",
    reasons: [],
    degraded: false,
  });
});

test("each rule triggers only beyond its configured boundary", () => {
  assert.equal(evaluate({}, 3).score, 0);
  assert.equal(evaluate({}, 4).score, 30);
  assert.equal(evaluate({ amount: 1000 }).score, 0);
  assert.equal(evaluate({ amount: 1000.01 }).score, 20);
  assert.equal(evaluate({ country: "US" }).score, 25);
  assert.equal(evaluate({ merchantCategory: "crypto" }).score, 15);
  assert.equal(evaluate({ channel: "online" }).score, 10);
});

test("an exact score of 60 is REJECTED", () => {
  const result = evaluate({ country: "US", amount: 5000, merchantCategory: "crypto" });
  assert.equal(result.score, 60);
  assert.equal(result.decision, "REJECTED");
  assert.deepEqual(
    result.reasons.map((reason) => reason.rule),
    ["COUNTRY_RISK", "AMOUNT_THRESHOLD", "HIGH_RISK_MERCHANT"],
  );
});

test("all rules produce the maximum score 100 in stable order", () => {
  const result = evaluate(
    { country: "US", amount: 5000, merchantCategory: "crypto", channel: "online" },
    4,
  );
  assert.equal(result.score, 100);
  assert.equal(result.decision, "REJECTED");
  assert.deepEqual(
    result.reasons.map((reason) => reason.rule),
    ["VELOCITY", "COUNTRY_RISK", "AMOUNT_THRESHOLD", "HIGH_RISK_MERCHANT", "CARD_NOT_PRESENT"],
  );
});

test("reasons do not expose transaction values or identifiers", () => {
  const result = evaluate(
    { country: "US", amount: 9876, merchantCategory: "crypto", channel: "online" },
    9,
  );
  const serialized = JSON.stringify(result.reasons);
  for (const sensitiveValue of ["card_1", "txn_1", "US", "9876", "crypto"]) {
    assert.doesNotMatch(serialized, new RegExp(sensitiveValue, "i"));
  }
});

test("invalid velocity context is rejected", () => {
  for (const velocityCount of [0, -1, 1.5]) {
    assert.throws(() => evaluateRisk(cleanTransaction, policy, { velocityCount }), RangeError);
  }
});

test("degraded mode never approves and exposes the unavailable context", () => {
  const result = evaluateDegradedRisk(cleanTransaction, policy);
  assert.equal(result.score, 30);
  assert.equal(result.decision, "REVIEW");
  assert.equal(result.degraded, true);
  assert.equal(result.reasons.at(-1)?.rule, "RISK_CONTEXT_UNAVAILABLE");
});

test("degraded mode remains REVIEW when known rules exceed rejection", () => {
  const result = evaluateDegradedRisk(
    {
      ...cleanTransaction,
      amount: 5000,
      country: "US",
      merchantCategory: "crypto",
      channel: "online",
    },
    policy,
  );
  assert.equal(result.score, 70);
  assert.equal(result.decision, "REVIEW");
  assert.equal(result.degraded, true);
});
