import fs from "node:fs";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { validateCommitMessage } from "./lib/git-policy.mjs";

const messagePath = process.argv[2];
if (!messagePath || !fs.existsSync(messagePath)) {
  console.error("Usage: node validate-commit-message.mjs <commit-message-file>");
  process.exit(2);
}

const message = fs.readFileSync(messagePath, "utf8");
const branch = (
  process.env.TRG_VALIDATION_BRANCH ??
  execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" })
).trim();
const failures = validateCommitMessage(message, branch);

if (failures.length > 0) {
  console.error("Commit message validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Commit message matches branch ${branch}.`);
