import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryVelocityStore } from "./velocity-store.js";

test("counts successive occurrences within the window", async () => {
  const store = new InMemoryVelocityStore(60, () => 0);
  assert.equal(await store.hit("card_1"), 1);
  assert.equal(await store.hit("card_1"), 2);
  assert.equal(await store.hit("card_1"), 3);
});

test("cards are counted independently", async () => {
  const store = new InMemoryVelocityStore(60, () => 0);
  assert.equal(await store.hit("card_1"), 1);
  assert.equal(await store.hit("card_2"), 1);
  assert.equal(await store.hit("card_1"), 2);
});

test("the counter resets after the window (fixed window)", async () => {
  let now = 0;
  const store = new InMemoryVelocityStore(60, () => now);
  await store.hit("card_1");
  await store.hit("card_1");
  now = 60_000;
  assert.equal(await store.hit("card_1"), 1);
});

test("the window does not slide: a late hit does not extend it", async () => {
  let now = 0;
  const store = new InMemoryVelocityStore(60, () => now);
  await store.hit("card_1"); // resetAt = 60_000
  now = 59_000;
  assert.equal(await store.hit("card_1"), 2); // same window
  now = 60_000;
  assert.equal(await store.hit("card_1"), 1); // reset, not 3
});
