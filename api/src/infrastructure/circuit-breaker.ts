import { StateStoreUnavailableError } from "./state-store-errors.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export type CircuitBreakerOptions = Readonly<{
  failureThreshold: number;
  resetAfterMs: number;
  timeoutMs: number;
  now?: () => number;
  onTransition?: (from: CircuitState, to: CircuitState) => void;
}>;

export class CircuitBreaker {
  readonly #options: CircuitBreakerOptions;
  readonly #now: () => number;
  #state: CircuitState = "CLOSED";
  #consecutiveFailures = 0;
  #openedAt = 0;

  constructor(options: CircuitBreakerOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => Date.now());
  }

  get state(): CircuitState {
    return this.#state;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.#admitOperation();

    try {
      const result = await this.#withTimeout(operation);
      this.#recordSuccess();
      return result;
    } catch (cause) {
      this.#recordFailure();
      if (cause instanceof StateStoreUnavailableError) throw cause;
      throw new StateStoreUnavailableError("shared state operation failed", cause);
    }
  }

  #admitOperation(): void {
    if (this.#state === "CLOSED") return;

    if (this.#state === "OPEN") {
      if (this.#now() - this.#openedAt < this.#options.resetAfterMs) {
        throw new StateStoreUnavailableError("shared state circuit is open");
      }
      this.#transitionTo("HALF_OPEN");
      return;
    }

    throw new StateStoreUnavailableError("shared state circuit half-open probe is in progress");
  }

  async #withTimeout<T>(operation: () => Promise<T>): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new StateStoreUnavailableError("shared state command timed out")),
        this.#options.timeoutMs,
      );
    });

    try {
      return await Promise.race([operation(), expired]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  #recordSuccess(): void {
    this.#consecutiveFailures = 0;
    if (this.#state !== "CLOSED") this.#transitionTo("CLOSED");
  }

  #recordFailure(): void {
    if (this.#state === "HALF_OPEN") {
      this.#openedAt = this.#now();
      this.#transitionTo("OPEN");
      return;
    }

    this.#consecutiveFailures += 1;
    if (this.#consecutiveFailures >= this.#options.failureThreshold) {
      this.#openedAt = this.#now();
      this.#transitionTo("OPEN");
    }
  }

  #transitionTo(next: CircuitState): void {
    if (this.#state === next) return;
    const previous = this.#state;
    this.#state = next;
    this.#options.onTransition?.(previous, next);
  }
}
