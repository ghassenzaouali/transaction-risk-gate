import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimitStore, type SharedRateLimitCounter } from "./rate-limit-store.js";

const increment = (store: InstanceType<ReturnType<typeof createRateLimitStore>>, key: string) =>
  new Promise<{ current: number; ttl: number }>((resolve, reject) => {
    store.incr(
      key,
      (error, result) => {
        if (error !== null) return reject(error);
        if (result === undefined) return reject(new Error("missing rate limit result"));
        resolve(result);
      },
      60_000,
      10,
    );
  });

test("rate limit adapter delegates to the shared counter", async () => {
  const counter: SharedRateLimitCounter = {
    incrementRateLimit: async () => ({ current: 7, ttl: 12_000 }),
  };
  const Store = createRateLimitStore(counter, () => assert.fail("unexpected fallback"));
  const store = new Store({});

  assert.deepEqual(await increment(store, "public:127.0.0.1"), { current: 7, ttl: 12_000 });
});

test("Redis failure keeps a bounded local rate limit active", async () => {
  let fallbacks = 0;
  const counter: SharedRateLimitCounter = {
    incrementRateLimit: () => Promise.reject(new Error("Redis unavailable")),
  };
  const Store = createRateLimitStore(counter, () => {
    fallbacks += 1;
  });
  const store = new Store({});

  assert.equal((await increment(store, "public:127.0.0.1")).current, 1);
  assert.equal((await increment(store, "public:127.0.0.1")).current, 2);
  assert.equal(fallbacks, 2);
});
