export const workBranchPattern =
  /^(feat|fix|security|test|docs|refactor|ci|chore|hotfix)\/TRG-([1-9][0-9]*)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const releaseBranchPattern = /^release\/v([0-9]+)\.([0-9]+)\.([0-9]+)$/;
export const automationBranchPattern = /^dependabot\/.+$/;

export const typeLabels = new Set([
  "type:feat",
  "type:fix",
  "type:security",
  "type:test",
  "type:docs",
  "type:refactor",
  "type:ci",
  "type:chore",
]);
export const riskLabels = new Set(["risk:low", "risk:medium", "risk:high"]);
export const releaseLabels = new Set(["release:required", "release:not-required"]);

function countLabels(labels, allowed) {
  return labels.filter((label) => allowed.has(label)).length;
}

export function branchIdentity(branch) {
  const work = workBranchPattern.exec(branch);
  if (work) {
    return {
      kind: work[1] === "hotfix" ? "hotfix" : "work",
      type: work[1],
      workItem: work[2],
    };
  }
  const release = releaseBranchPattern.exec(branch);
  if (release) {
    return { kind: "release", version: `${release[1]}.${release[2]}.${release[3]}` };
  }
  if (automationBranchPattern.test(branch)) {
    return { kind: "automation", workItem: "6" };
  }
  if (branch === "main" || branch === "develop") {
    return { kind: "protected", branch };
  }
  return { kind: "invalid" };
}

export function expectedBaseBranch(identity) {
  if (identity.kind === "hotfix" || identity.kind === "release") {
    return "main";
  }
  if (identity.kind === "work" || identity.kind === "automation") {
    return "develop";
  }
  return undefined;
}

export function validateBranchName(branch, { allowAutomation = true } = {}) {
  const identity = branchIdentity(branch);
  if (identity.kind === "invalid" || (!allowAutomation && identity.kind === "automation")) {
    return [
      `branch '${branch || "(detached)"}' must follow <class>/TRG-<number>-<kebab-case> or release/v<semver>`,
    ];
  }
  return [];
}

function validateSubjectShape(subject) {
  const failures = [];
  if (subject.length > 72) {
    failures.push(`subject is ${subject.length} characters; maximum is 72`);
  }
  if (subject.endsWith(".")) {
    failures.push("subject must not end with a period");
  }
  return failures;
}

export function validateCommitMessage(message, branch) {
  const normalized = message.replace(/\r\n/g, "\n").trimEnd();
  const lines = normalized.split("\n");
  const subject = lines[0] ?? "";

  if (/^(Merge|Revert) /.test(subject)) {
    return [];
  }

  const failures = validateSubjectShape(subject);
  const identity = branchIdentity(branch);

  if (identity.kind === "work" || identity.kind === "hotfix" || identity.kind === "automation") {
    const humanPrefix = `[TRG-${identity.workItem}] `;
    const automationPrefix = `[TRG-${identity.workItem}]: `;
    const prefix =
      identity.kind === "automation" && subject.startsWith(automationPrefix)
        ? automationPrefix
        : humanPrefix;
    if (!subject.startsWith(prefix)) {
      failures.push(`branch ${branch} requires commit prefix ${humanPrefix.trim()}`);
    } else {
      const summary = subject.slice(prefix.length);
      if (!/^[a-zà-öø-ÿ0-9]/u.test(summary)) {
        failures.push("commit summary must begin with a lowercase verb or a digit");
      }
    }
  } else if (identity.kind === "protected" || identity.kind === "release") {
    failures.push(`direct commits on ${branch} are forbidden; use a reviewed pull request`);
  } else {
    failures.push(...validateBranchName(branch, { allowAutomation: false }));
  }

  if (lines.length > 1) {
    if (lines[1] !== "") {
      failures.push("the optional body must be separated by one blank line");
    }
    for (const [index, line] of lines.slice(2).entries()) {
      if (line !== "" && !line.startsWith("- ")) {
        failures.push(`body line ${index + 3} must start with '- '`);
      }
    }
  }

  return [...new Set(failures)];
}

export function validatePullRequest({ title, head, base, labels }) {
  const failures = validateSubjectShape(title);
  const identity = branchIdentity(head);
  failures.push(...validateBranchName(head));

  const expectedBase = expectedBaseBranch(identity);
  if (expectedBase && base !== expectedBase) {
    failures.push(`branch ${head} must target ${expectedBase}, not ${base}`);
  }

  const titlePattern =
    identity.kind === "automation"
      ? /^\[TRG-([1-9][0-9]*)\](?::)? ([a-zà-öø-ÿ0-9].*)$/u
      : /^\[TRG-([1-9][0-9]*)\] ([a-zà-öø-ÿ0-9].*)$/u;
  const titleMatch = titlePattern.exec(title);
  if (!titleMatch) {
    failures.push("pull request title must follow [TRG-N] lowercase summary");
  } else if (
    (identity.kind === "work" || identity.kind === "hotfix" || identity.kind === "automation") &&
    titleMatch[1] !== identity.workItem
  ) {
    failures.push(`pull request title must use TRG-${identity.workItem} from branch ${head}`);
  }

  if (countLabels(labels, typeLabels) !== 1) {
    failures.push("pull request requires exactly one type:* label");
  }
  if (countLabels(labels, riskLabels) !== 1) {
    failures.push("pull request requires exactly one risk:* label");
  }
  if (countLabels(labels, releaseLabels) !== 1) {
    failures.push("pull request requires exactly one release:* label");
  }
  if (!labels.some((label) => label.startsWith("area:"))) {
    failures.push("pull request requires at least one area:* label");
  }

  return [...new Set(failures)];
}
