import type { Decision, Reason } from "./domain/risk-engine.js";

/**
 * La réponse de `POST /api/decisions` : le verdict enrichi d'un identifiant et
 * d'un horodatage. Aussi ce qu'on mémorise (cache d'idempotence, flux récent).
 */
export type DecisionResponse = Readonly<{
  decisionId: string;
  decision: Decision;
  score: number;
  reasons: readonly Reason[];
  evaluatedAt: string;
  degraded: boolean;
}>;
