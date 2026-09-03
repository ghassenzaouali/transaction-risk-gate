import { test } from "node:test";
import assert from "node:assert/strict";
import { createReadiness } from "./readiness.js";

test("starts ready", () => {
  assert.equal(createReadiness().isReady(), true);
});

test("beginShutdown flips it to not ready, and stays there", () => {
  const readiness = createReadiness();
  readiness.beginShutdown();
  assert.equal(readiness.isReady(), false);
  readiness.beginShutdown();
  assert.equal(readiness.isReady(), false);
});
