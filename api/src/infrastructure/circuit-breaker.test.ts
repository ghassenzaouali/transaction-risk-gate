import { test } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker, type CircuitState } from "./circuit-breaker.js";
import { StateStoreUnavailableError } from "./state-store-errors.js";

test("opens after the configured failures and rejects calls while open", async () => {
  let calls = 0;
  const breaker = new CircuitBreaker({ failureThreshold: 2, resetAfterMs: 100, timeoutMs: 50 });
  const failingOperation = async () => {
    calls += 1;
    throw new Error("redis down");
  };

  await assert.rejects(() => breaker.execute(failingOperation), StateStoreUnavailableError);
  assert.equal(breaker.state, "CLOSED");
  await assert.rejects(() => breaker.execute(failingOperation), StateStoreUnavailableError);
  assert.equal(breaker.state, "OPEN");
  await assert.rejects(() => breaker.execute(failingOperation), /circuit is open/);
  assert.equal(calls, 2);
});

test("allows one half-open probe and closes after recovery", async () => {
  let now = 0;
  const transitions: Array<[CircuitState, CircuitState]> = [];
  const breaker = new CircuitBreaker({
    failureThreshold: 1,
    resetAfterMs: 100,
    timeoutMs: 50,
    now: () => now,
    onTransition: (from, to) => transitions.push([from, to]),
  });

  await assert.rejects(
    () => breaker.execute(() => Promise.reject(new Error("down"))),
    StateStoreUnavailableError,
  );
  now = 100;
  assert.equal(await breaker.execute(() => Promise.resolve("recovered")), "recovered");
  assert.equal(breaker.state, "CLOSED");
  assert.deepEqual(transitions, [
    ["CLOSED", "OPEN"],
    ["OPEN", "HALF_OPEN"],
    ["HALF_OPEN", "CLOSED"],
  ]);
});

test("a failed half-open probe reopens the circuit", async () => {
  let now = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 1,
    resetAfterMs: 100,
    timeoutMs: 50,
    now: () => now,
  });

  await assert.rejects(() => breaker.execute(() => Promise.reject(new Error("down"))));
  now = 100;
  await assert.rejects(() => breaker.execute(() => Promise.reject(new Error("still down"))));
  assert.equal(breaker.state, "OPEN");
});

test("times out a slow operation", async () => {
  const breaker = new CircuitBreaker({ failureThreshold: 1, resetAfterMs: 100, timeoutMs: 5 });
  await assert.rejects(
    () => breaker.execute(() => new Promise((resolve) => setTimeout(resolve, 100))),
    /timed out/,
  );
  assert.equal(breaker.state, "OPEN");
});
