import { SUPPORTED_CURRENCY, type Transaction } from "./transaction.js";

export type { Transaction };

export type RuleName =
  "VELOCITY" | "COUNTRY_RISK" | "AMOUNT_THRESHOLD" | "HIGH_RISK_MERCHANT" | "CARD_NOT_PRESENT";

export type ReasonRule = RuleName | "RISK_CONTEXT_UNAVAILABLE";

export type Reason = Readonly<{
  rule: ReasonRule;
  weight: number;
  detail: string;
}>;

export type Decision = "APPROVED" | "REVIEW" | "REJECTED";

export type Evaluation = Readonly<{
  score: number;
  decision: Decision;
  reasons: readonly Reason[];
  degraded: boolean;
}>;

export type RiskPolicy = Readonly<{
  amountThreshold: number;
  velocityMax: number;
  velocityWindowSeconds: number;
  allowedCountries: readonly string[];
  highRiskMerchantCategories: readonly string[];
}>;

export type RiskContext = Readonly<{
  velocityCount: number;
}>;

export const RULE_WEIGHTS = Object.freeze({
  VELOCITY: 30,
  COUNTRY_RISK: 25,
  AMOUNT_THRESHOLD: 20,
  HIGH_RISK_MERCHANT: 15,
  CARD_NOT_PRESENT: 10,
} as const satisfies Record<RuleName, number>);

export const MAX_SCORE = Object.values(RULE_WEIGHTS).reduce((total, weight) => total + weight, 0);

if (MAX_SCORE !== 100) {
  throw new Error(`risk rule weights must total 100, received ${MAX_SCORE}`);
}

const REVIEW_AT = 30;
const REJECT_AT = 60;

export function scoreToDecision(score: number): Decision {
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
    throw new RangeError(`risk score must be an integer from 0 to ${MAX_SCORE}`);
  }
  if (score >= REJECT_AT) return "REJECTED";
  if (score >= REVIEW_AT) return "REVIEW";
  return "APPROVED";
}

export type RuleView = Readonly<{
  rule: RuleName;
  weight: number;
  parameters: Readonly<Record<string, number | string | readonly string[]>>;
}>;

export type RulesView = Readonly<{
  currency: typeof SUPPORTED_CURRENCY;
  maxScore: number;
  scoreBands: Readonly<{
    approved: Readonly<{ min: 0; max: 29 }>;
    review: Readonly<{ min: 30; max: 59 }>;
    rejected: Readonly<{ min: 60; max: 100 }>;
  }>;
  rules: readonly RuleView[];
}>;

/** Vue publique de la politique active, sans état transactionnel. */
export function describeRules(policy: RiskPolicy): RulesView {
  return {
    currency: SUPPORTED_CURRENCY,
    maxScore: MAX_SCORE,
    scoreBands: {
      approved: { min: 0, max: 29 },
      review: { min: 30, max: 59 },
      rejected: { min: 60, max: 100 },
    },
    rules: [
      {
        rule: "VELOCITY",
        weight: RULE_WEIGHTS.VELOCITY,
        parameters: {
          maxPerWindow: policy.velocityMax,
          windowSeconds: policy.velocityWindowSeconds,
        },
      },
      {
        rule: "COUNTRY_RISK",
        weight: RULE_WEIGHTS.COUNTRY_RISK,
        parameters: { allowedCountries: policy.allowedCountries },
      },
      {
        rule: "AMOUNT_THRESHOLD",
        weight: RULE_WEIGHTS.AMOUNT_THRESHOLD,
        parameters: { threshold: policy.amountThreshold, currency: SUPPORTED_CURRENCY },
      },
      {
        rule: "HIGH_RISK_MERCHANT",
        weight: RULE_WEIGHTS.HIGH_RISK_MERCHANT,
        parameters: { categories: policy.highRiskMerchantCategories },
      },
      {
        rule: "CARD_NOT_PRESENT",
        weight: RULE_WEIGHTS.CARD_NOT_PRESENT,
        parameters: { channel: "online" },
      },
    ],
  };
}

function evaluateRules(
  transaction: Transaction,
  policy: RiskPolicy,
  context: RiskContext,
): readonly Reason[] {
  const reasons: Reason[] = [];

  if (context.velocityCount > policy.velocityMax) {
    reasons.push({
      rule: "VELOCITY",
      weight: RULE_WEIGHTS.VELOCITY,
      detail: "transaction frequency exceeds the configured window limit",
    });
  }
  if (!policy.allowedCountries.includes(transaction.country)) {
    reasons.push({
      rule: "COUNTRY_RISK",
      weight: RULE_WEIGHTS.COUNTRY_RISK,
      detail: "transaction country is outside the configured allowlist",
    });
  }
  if (transaction.amount > policy.amountThreshold) {
    reasons.push({
      rule: "AMOUNT_THRESHOLD",
      weight: RULE_WEIGHTS.AMOUNT_THRESHOLD,
      detail: "transaction amount exceeds the configured EUR threshold",
    });
  }
  if (policy.highRiskMerchantCategories.includes(transaction.merchantCategory)) {
    reasons.push({
      rule: "HIGH_RISK_MERCHANT",
      weight: RULE_WEIGHTS.HIGH_RISK_MERCHANT,
      detail: "merchant category is classified as high risk",
    });
  }
  if (transaction.channel === "online") {
    reasons.push({
      rule: "CARD_NOT_PRESENT",
      weight: RULE_WEIGHTS.CARD_NOT_PRESENT,
      detail: "card is not present for the transaction channel",
    });
  }

  return Object.freeze(reasons);
}

/** Évaluation pure et déterministe : aucun accès réseau, horloge ou stockage. */
export function evaluateRisk(
  transaction: Transaction,
  policy: RiskPolicy,
  context: RiskContext,
): Evaluation {
  if (!Number.isInteger(context.velocityCount) || context.velocityCount < 1) {
    throw new RangeError("velocity count must be a positive integer");
  }

  const reasons = evaluateRules(transaction, policy, context);
  const score = reasons.reduce((total, reason) => total + reason.weight, 0);

  return Object.freeze({
    score,
    decision: scoreToDecision(score),
    reasons,
    degraded: false,
  });
}

/**
 * Politique fail-safe : sans état partagé, aucune approbation automatique
 * n'est possible. La transaction est orientée vers une revue manuelle.
 */
export function evaluateDegradedRisk(transaction: Transaction, policy: RiskPolicy): Evaluation {
  const partial = evaluateRisk(transaction, policy, { velocityCount: 1 });
  const reasons = Object.freeze([
    ...partial.reasons,
    {
      rule: "RISK_CONTEXT_UNAVAILABLE" as const,
      weight: 0,
      detail: "shared risk context is temporarily unavailable",
    },
  ]);

  return Object.freeze({
    score: Math.max(partial.score, REVIEW_AT),
    decision: "REVIEW" as const,
    reasons,
    degraded: true,
  });
}
