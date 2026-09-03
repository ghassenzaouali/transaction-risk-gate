import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const failures = [];

const requiredFiles = [
  ".editorconfig",
  ".gitattributes",
  ".github/actions/setup-bicep/action.yml",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  ".github/labeler.yml",
  ".github/pull_request_template.md",
  ".github/workflows/ci.yml",
  ".github/workflows/deploy.yml",
  ".github/workflows/load-test.yml",
  ".github/workflows/release.yml",
  ".githooks/commit-msg",
  ".githooks/pre-commit",
  ".githooks/pre-push",
  ".githooks/run-pre-commit",
  ".gitignore",
  ".gitleaks.toml",
  ".markdownlint-cli2.jsonc",
  ".pre-commit-config.yaml",
  ".prettierignore",
  ".prettierrc.json",
  ".release/README.md",
  ".release/manifest.example.json",
  ".sonarlint/connectedMode.json",
  ".vscode/extensions.json",
  ".vscode/settings.json",
  "CONTRIBUTING.md",
  "README.md",
  "SECURITY.md",
  "docs/README.md",
  "docs/api/openapi.yaml",
  "docs/architecture.md",
  "docs/governance/definition-of-done.md",
  "docs/governance/git-policy.md",
  "docs/governance/quality-security-gates.md",
  "docs/governance/release-policy.md",
  "docs/livraison.md",
  "docs/limites.md",
  "docs/plateforme-azure.md",
  "docs/postman/cloud.postman_environment.json",
  "docs/postman/local.postman_environment.json",
  "docs/postman/transaction-risk-gate.postman_collection.json",
  "docs/test-charge.md",
  "docs/test-panne.md",
  "docs/tests.md",
  "package-lock.json",
  "package.json",
  "scripts/dev/bootstrap-hooks.ps1",
  "scripts/dev/bootstrap-hooks.sh",
  "scripts/governance/lib/git-policy.mjs",
  "scripts/governance/tests/git-policy.test.mjs",
  "scripts/governance/validate-commit-message.mjs",
  "scripts/governance/validate-pre-push.mjs",
  "scripts/governance/validate-pull-request.mjs",
  "scripts/governance/validate-repository.mjs",
  "scripts/release/manifest.mjs",
  "scripts/release/manifest.test.mjs",
  "scripts/load/config.mjs",
  "scripts/load/config.test.mjs",
  "scripts/load/evidence.mjs",
  "scripts/load/evidence.test.mjs",
  "scripts/load/load-test.js",
  "scripts/failure/redis-outage.mjs",
  "scripts/failure/redis-outage.test.mjs",
  "scripts/smoke/smoke-test.mjs",
  "scripts/smoke/smoke-test.test.mjs",
  "sonar-project.properties",
  // infra/ (Bicep + runbooks) est ajouté à cette liste avec la tranche TRG-7.
];

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    failures.push(`missing required governance file: ${relativePath}`);
  }
}

const ignoredDirectories = new Set([
  ".git",
  ".local",
  ".scannerwork",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
]);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    files.push(...(entry.isDirectory() ? walk(absolutePath) : [absolutePath]));
  }
  return files;
}

function repositoryPath(absolutePath) {
  return path.relative(root, absolutePath).replaceAll("\\", "/");
}

function withoutFencedCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, "");
}

const allFiles = walk(root);
const markdownFiles = allFiles.filter((file) => file.endsWith(".md"));
for (const markdownFile of markdownFiles) {
  const relativePath = repositoryPath(markdownFile);
  const source = fs.readFileSync(markdownFile, "utf8");
  const fenceCount = (source.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 !== 0) {
    failures.push(`${relativePath}: unbalanced fenced code block`);
  }

  for (const match of withoutFencedCode(source).matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    }
    target = target.split(/\s+"/, 1)[0];
    if (!target || target.startsWith("#") || /^(?:https?:|mailto:|urn:|data:)/i.test(target)) {
      continue;
    }
    const decodedTarget = decodeURIComponent(target.split("#", 1)[0]);
    const resolvedTarget = path.resolve(path.dirname(markdownFile), decodedTarget);
    if (!fs.existsSync(resolvedTarget)) {
      failures.push(`${relativePath}: broken relative link '${target}'`);
    }
  }
}

const adrFiles = allFiles.filter((file) =>
  /[\\/]docs[\\/]decisions[\\/]ADR-\d{3}-.+\.md$/.test(file),
);
const adrNumbers = new Map();
for (const adrFile of adrFiles) {
  const number = path.basename(adrFile).match(/^ADR-(\d{3})-/)?.[1];
  const previous = adrNumbers.get(number);
  if (previous) {
    failures.push(
      `duplicate ADR number ${number}: ${repositoryPath(previous)} and ${repositoryPath(adrFile)}`,
    );
  } else {
    adrNumbers.set(number, adrFile);
  }
}

const workflowDirectory = path.join(root, ".github", "workflows");
if (fs.existsSync(workflowDirectory)) {
  for (const workflow of fs.readdirSync(workflowDirectory)) {
    if (!/\.ya?ml$/.test(workflow)) {
      continue;
    }
    const relativePath = `.github/workflows/${workflow}`;
    const source = fs.readFileSync(path.join(workflowDirectory, workflow), "utf8");
    for (const [pattern, reason] of [
      [/continue-on-error:\s*true/i, "mandatory jobs cannot continue on error"],
      [/allow_failure:\s*true/i, "mandatory jobs cannot allow failure"],
      [/permissions:\s*write-all/i, "write-all permissions are forbidden"],
      [/pull_request_target:/i, "pull_request_target is forbidden"],
    ]) {
      if (pattern.test(source)) {
        failures.push(`${relativePath}: ${reason}`);
      }
    }
    for (const match of source.matchAll(/uses:\s*([^@\s]+)@([^\s#]+)/g)) {
      const action = match[1];
      const reference = match[2];
      if (!action.startsWith("./") && !/^[a-f0-9]{40}$/.test(reference)) {
        failures.push(`${relativePath}: action ${action} must use a full commit SHA`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Repository policy validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Repository policy validation passed (${markdownFiles.length} Markdown files, ${adrFiles.length} ADRs).`,
);
