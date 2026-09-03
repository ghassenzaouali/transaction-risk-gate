import type { VelocityStore } from "../velocity-store.js";
import {
  evaluateRisk,
  type Evaluation,
  type RiskPolicy,
  type Transaction,
} from "../domain/risk-engine.js";

/**
 * Cas d'usage applicatif : enrichir la transaction avec son contexte de
 * vélocité, puis déléguer toute décision au moteur de domaine pur.
 */
export async function evaluateTransaction(
  transaction: Transaction,
  policy: RiskPolicy,
  velocityStore: VelocityStore,
): Promise<Evaluation> {
  const velocityCount = await velocityStore.hit(transaction.cardId);
  return evaluateRisk(transaction, policy, { velocityCount });
}
