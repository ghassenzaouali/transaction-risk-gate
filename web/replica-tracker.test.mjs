import { test } from "node:test";
import assert from "node:assert/strict";
import { createReplicaTracker } from "./replica-tracker.mjs";

test("compte les identifiants distincts vus dans la fenêtre", () => {
  const tracker = createReplicaTracker(30_000);
  tracker.observe("api-1", 0);
  tracker.observe("api-2", 0);
  tracker.observe("api-1", 0);
  assert.equal(tracker.count(0), 2);
});

test("oublie une instance vue il y a plus de ttlMs", () => {
  const tracker = createReplicaTracker(30_000);
  tracker.observe("api-1", 0);
  tracker.observe("api-2", 25_000);
  assert.equal(tracker.count(31_000), 1); // api-1 périmé, api-2 encore là
});

test("une instance revue rafraîchit son horodatage", () => {
  const tracker = createReplicaTracker(30_000);
  tracker.observe("api-1", 0);
  tracker.observe("api-1", 20_000);
  assert.equal(tracker.count(40_000), 1); // revue à 20 s, pas périmée à 40 s
});

test("ignore une valeur absente", () => {
  const tracker = createReplicaTracker();
  tracker.observe(null);
  tracker.observe("");
  tracker.observe(undefined);
  assert.equal(tracker.count(), 0);
});
