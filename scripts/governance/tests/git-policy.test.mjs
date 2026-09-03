import assert from "node:assert/strict";
import test from "node:test";
import {
  branchIdentity,
  expectedBaseBranch,
  validateBranchName,
  validateCommitMessage,
  validatePullRequest,
} from "../lib/git-policy.mjs";

test("accepts every supported short-lived branch class", () => {
  for (const type of [
    "feat",
    "fix",
    "security",
    "test",
    "docs",
    "refactor",
    "ci",
    "chore",
    "hotfix",
  ]) {
    assert.deepEqual(validateBranchName(`${type}/TRG-12-short-topic`), []);
  }
  assert.deepEqual(validateBranchName("release/v1.2.3"), []);
});

test("rejects malformed branch names", () => {
  assert.notDeepEqual(validateBranchName("feature/TRG-1-topic"), []);
  assert.notDeepEqual(validateBranchName("feat/TRG-0-topic"), []);
  assert.notDeepEqual(validateBranchName("feat/TRG-1-Bad_Name"), []);
});

test("maps branches to the expected protected base", () => {
  assert.equal(expectedBaseBranch(branchIdentity("feat/TRG-2-risk-engine")), "develop");
  assert.equal(expectedBaseBranch(branchIdentity("release/v1.0.0")), "main");
  assert.equal(expectedBaseBranch(branchIdentity("hotfix/TRG-10-production-fix")), "main");
});

test("requires the work item in commit subjects", () => {
  assert.deepEqual(
    validateCommitMessage("[TRG-2] implementer le moteur de risque", "feat/TRG-2-risk-engine"),
    [],
  );
  assert.match(
    validateCommitMessage("[TRG-3] implementer le moteur", "feat/TRG-2-risk-engine").join("\n"),
    /TRG-2/,
  );
});

test("accepts Dependabot generated subjects without weakening human branches", () => {
  assert.deepEqual(
    validateCommitMessage(
      "[TRG-6]: bump zod from 4.5.2 to 4.5.4",
      "dependabot/npm_and_yarn/api/develop/npm-production-7257b05964",
    ),
    [],
  );
  assert.match(
    validateCommitMessage("[TRG-6]: contourner la convention", "ci/TRG-6-quality-gates").join("\n"),
    /requires commit prefix/,
  );
});

test("validates optional commit bodies", () => {
  assert.deepEqual(
    validateCommitMessage(
      "[TRG-1] formaliser la gouvernance\n\n- ajouter les règles\n- documenter les contrôles",
      "chore/TRG-1-project-governance",
    ),
    [],
  );
  assert.match(
    validateCommitMessage(
      "[TRG-1] formaliser la gouvernance\nbody without separator",
      "chore/TRG-1-project-governance",
    ).join("\n"),
    /blank line/,
  );
});

test("allows generated merge commits and blocks direct protected commits", () => {
  assert.deepEqual(validateCommitMessage("Merge pull request #1 from branch", "develop"), []);
  assert.match(validateCommitMessage("[TRG-1] commit direct", "develop").join("\n"), /forbidden/);
});

test("accepts a fully classified pull request", () => {
  assert.deepEqual(
    validatePullRequest({
      title: "[TRG-4] securiser les frontières API",
      head: "security/TRG-4-api-observability",
      base: "develop",
      labels: ["type:security", "risk:high", "area:api", "release:required"],
    }),
    [],
  );
});

test("accepts a Dependabot generated pull request title", () => {
  assert.deepEqual(
    validatePullRequest({
      title: "[TRG-6]: bump zod from 4.5.2 to 4.5.4",
      head: "dependabot/npm_and_yarn/api/develop/npm-production-7257b05964",
      base: "develop",
      labels: ["type:chore", "risk:low", "area:quality", "release:not-required"],
    }),
    [],
  );
});

test("rejects a pull request with mismatched identity and labels", () => {
  const failures = validatePullRequest({
    title: "[TRG-5] construire le simulateur",
    head: "feat/TRG-4-api-observability",
    base: "main",
    labels: ["type:feat", "type:fix", "area:web"],
  });
  assert.ok(failures.some((failure) => failure.includes("target develop")));
  assert.ok(failures.some((failure) => failure.includes("TRG-4")));
  assert.ok(failures.some((failure) => failure.includes("exactly one type")));
  assert.ok(failures.some((failure) => failure.includes("risk")));
  assert.ok(failures.some((failure) => failure.includes("release")));
});
