import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { branchIdentity, validateBranchName } from "./lib/git-policy.mjs";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: git("rev-parse", "--show-toplevel"),
    stdio: "inherit",
  });
}

function runNpm(args) {
  if (process.platform !== "win32") {
    run("npm", args);
    return;
  }

  const wrappers = execFileSync("where.exe", ["npm.cmd"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  const npmCli = wrappers
    .map((wrapper) => path.join(path.dirname(wrapper), "node_modules", "npm", "bin", "npm-cli.js"))
    .find((candidate) => fs.existsSync(candidate));

  if (!npmCli) {
    throw new Error("npm-cli.js was not found next to an npm.cmd on PATH");
  }
  run(process.execPath, [npmCli, ...args]);
}

const branch = git("branch", "--show-current");
const identity = branchIdentity(branch);
const failures = validateBranchName(branch, { allowAutomation: false });

if (identity.kind === "protected" || identity.kind === "release") {
  failures.push(`direct push to protected reference '${branch}' is forbidden`);
}

let upstream = "";
try {
  upstream = execFileSync(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
} catch {
  // A first push is valid when it explicitly sets the same-name upstream.
}

if (upstream && upstream !== `origin/${branch}`) {
  failures.push(`branch tracks '${upstream}', expected 'origin/${branch}'`);
}

if (failures.length > 0) {
  console.error("Pre-push validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

run("git", ["diff", "--check"]);
runNpm(["run", "format:check"]);
runNpm(["run", "docs:lint"]);
run(process.execPath, ["scripts/governance/validate-repository.mjs"]);
run(process.execPath, ["--test", "scripts/governance/tests/git-policy.test.mjs"]);

const root = git("rev-parse", "--show-toplevel");

if (process.env.TRG_SKIP_TESTS_PRE_PUSH !== "1") {
  if (fs.existsSync(path.join(root, "api", "package.json"))) {
    runNpm(["--prefix", "api", "run", "build"]);
    runNpm(["--prefix", "api", "test"]);
  }
  if (fs.existsSync(path.join(root, "web", "package.json"))) {
    runNpm(["--prefix", "web", "test"]);
  }
}

console.log(`Pre-push validation passed for ${branch}.`);
