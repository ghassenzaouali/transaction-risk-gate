export class StateStoreUnavailableError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "StateStoreUnavailableError";
    this.cause = cause;
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("the idempotency key is already associated with another payload");
    this.name = "IdempotencyConflictError";
  }
}
