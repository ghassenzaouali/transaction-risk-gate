import fs from "node:fs";
import process from "node:process";
import { validatePullRequest } from "./lib/git-policy.mjs";

function readEvent() {
  if (process.env.TRG_PR_EVENT_JSON) {
    return JSON.parse(process.env.TRG_PR_EVENT_JSON);
  }
  if (!process.env.GITHUB_EVENT_PATH) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
}

async function currentLabels(event) {
  const fallback = (event.pull_request.labels ?? []).map((label) => label.name);
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository || !event.number) {
    return fallback;
  }

  const response = await fetch(
    `https://api.github.com/repos/${repository}/issues/${event.number}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub labels request failed with HTTP ${response.status}`);
  }
  const issue = await response.json();
  return issue.labels.map((label) => (typeof label === "string" ? label : label.name));
}

const event = readEvent();
if (!event?.pull_request) {
  console.log("Pull request validation skipped outside a pull_request event.");
  process.exit(0);
}

const labels = await currentLabels(event);
const failures = validatePullRequest({
  title: event.pull_request.title,
  head: event.pull_request.head.ref,
  base: event.pull_request.base.ref,
  labels,
});

if (failures.length > 0) {
  console.error("Pull request governance failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Pull request ${event.number} satisfies Transaction Risk Gate governance.`);
