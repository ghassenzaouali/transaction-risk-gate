import assert from "node:assert/strict";
import { test } from "node:test";
import { validateReleaseManifest } from "./manifest.mjs";

const valid = {
  version: "v1.0.0",
  sourceSha: "a".repeat(40),
  apiImage: `registry.azurecr.io/transaction-risk-gate-api@sha256:${"b".repeat(64)}`,
  webImage: `registry.azurecr.io/transaction-risk-gate-web@sha256:${"c".repeat(64)}`,
  createdAt: "2026-09-01T00:00:00.000Z",
};

test("accepte uniquement deux images ACR immuables du registre attendu", () => {
  assert.deepEqual(validateReleaseManifest(valid, "registry"), valid);
});

test("refuse tags mutables, mauvais registre et champs supplémentaires", () => {
  assert.throws(
    () =>
      validateReleaseManifest({
        ...valid,
        apiImage: "registry.azurecr.io/transaction-risk-gate-api:latest",
      }),
    /digest/,
  );
  assert.throws(() => validateReleaseManifest(valid, "other"), /registre attendu/);
  assert.throws(() => validateReleaseManifest({ ...valid, token: "interdit" }), /champs/);
});
