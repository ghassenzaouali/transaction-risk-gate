import type { FastifyRateLimitStore, FastifyRateLimitStoreCtor } from "@fastify/rate-limit";

export type RateLimitCount = Readonly<{ current: number; ttl: number }>;

export interface SharedRateLimitCounter {
  incrementRateLimit(key: string, timeWindowMs: number): Promise<RateLimitCount>;
}

class LocalFallbackCounter {
  readonly #windows = new Map<string, { current: number; expiresAt: number }>();
  readonly #maxKeys: number;

  constructor(maxKeys = 10_000) {
    this.#maxKeys = maxKeys;
  }

  increment(key: string, timeWindowMs: number, now = Date.now()): RateLimitCount {
    const existing = this.#windows.get(key);
    if (existing === undefined || existing.expiresAt <= now) {
      this.#evictIfNeeded();
      this.#windows.set(key, { current: 1, expiresAt: now + timeWindowMs });
      return { current: 1, ttl: timeWindowMs };
    }
    existing.current += 1;
    return { current: existing.current, ttl: Math.max(1, existing.expiresAt - now) };
  }

  #evictIfNeeded(): void {
    if (this.#windows.size < this.#maxKeys) return;
    const oldest = this.#windows.keys().next().value as string | undefined;
    if (oldest !== undefined) this.#windows.delete(oldest);
  }
}

/**
 * Adapte le compteur Redis à @fastify/rate-limit. Si l'état partagé tombe,
 * une limite locale bornée reste active : la protection ne disparaît jamais,
 * même si sa portée devient temporairement celle d'un replica.
 */
export function createRateLimitStore(
  counter: SharedRateLimitCounter,
  onFallback: () => void,
): FastifyRateLimitStoreCtor {
  const fallback = new LocalFallbackCounter();

  return class SharedStore implements FastifyRateLimitStore {
    incr(
      key: string,
      callback: (error: Error | null, result?: RateLimitCount) => void,
      timeWindow: number,
      _max: number,
    ): void {
      counter.incrementRateLimit(key, timeWindow).then(
        (result) => callback(null, result),
        () => {
          onFallback();
          callback(null, fallback.increment(key, timeWindow));
        },
      );
    }

    child(): FastifyRateLimitStore {
      return this;
    }
  };
}
