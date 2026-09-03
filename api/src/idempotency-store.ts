import type { DecisionResponse } from "./decision.js";
import { IdempotencyConflictError } from "./infrastructure/state-store-errors.js";

export type IdempotentResult = Readonly<{
  decision: DecisionResponse;
  replayed: boolean;
}>;

export interface IdempotencyStore {
  execute(
    key: string,
    payloadHash: string,
    operation: () => Promise<DecisionResponse>,
  ): Promise<IdempotentResult>;
}

type MemoryEntry = {
  payloadHash: string;
  expiresAt: number;
  decision: Promise<DecisionResponse>;
};

/** Implémentation single-flight utilisée par les tests sans Redis. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #entries = new Map<string, MemoryEntry>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(ttlSeconds = 86_400, now: () => number = () => Date.now()) {
    this.#ttlMs = ttlSeconds * 1_000;
    this.#now = now;
  }

  async execute(
    key: string,
    payloadHash: string,
    operation: () => Promise<DecisionResponse>,
  ): Promise<IdempotentResult> {
    const existing = this.#entries.get(key);
    if (existing !== undefined && existing.expiresAt > this.#now()) {
      if (existing.payloadHash !== payloadHash) throw new IdempotencyConflictError();
      return { decision: await existing.decision, replayed: true };
    }
    if (existing !== undefined) this.#entries.delete(key);

    const decision = Promise.resolve().then(operation);
    const entry: MemoryEntry = {
      payloadHash,
      expiresAt: this.#now() + this.#ttlMs,
      decision,
    };
    this.#entries.set(key, entry);

    try {
      return { decision: await decision, replayed: false };
    } catch (error) {
      if (this.#entries.get(key) === entry) this.#entries.delete(key);
      throw error;
    }
  }
}
