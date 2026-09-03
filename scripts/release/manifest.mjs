import fs from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const EXACT_KEYS = ["version", "sourceSha", "apiImage", "webImage", "createdAt"];
const IMAGE_PATTERN =
  /^[a-z0-9][a-z0-9.-]*\.azurecr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateReleaseManifest(manifest, expectedRegistry) {
  invariant(
    manifest && typeof manifest === "object" && !Array.isArray(manifest),
    "manifest JSON invalide",
  );
  invariant(
    Object.keys(manifest).sort().join(",") === [...EXACT_KEYS].sort().join(","),
    "champs du manifeste inattendus ou manquants",
  );
  invariant(
    /^v\d+\.\d+\.\d+$/.test(manifest.version),
    "version SemVer vMAJOR.MINOR.PATCH invalide",
  );
  invariant(/^[a-f0-9]{40}$/.test(manifest.sourceSha), "sourceSha Git complet invalide");
  invariant(
    IMAGE_PATTERN.test(manifest.apiImage),
    "apiImage doit être une référence ACR par digest",
  );
  invariant(
    IMAGE_PATTERN.test(manifest.webImage),
    "webImage doit être une référence ACR par digest",
  );
  invariant(!Number.isNaN(Date.parse(manifest.createdAt)), "createdAt ISO-8601 invalide");

  if (expectedRegistry) {
    const prefix = `${expectedRegistry}.azurecr.io/`;
    invariant(manifest.apiImage.startsWith(prefix), "apiImage ne vient pas du registre attendu");
    invariant(manifest.webImage.startsWith(prefix), "webImage ne vient pas du registre attendu");
  }
  return Object.freeze({ ...manifest });
}

export function readReleaseManifest(file, expectedRegistry) {
  return validateReleaseManifest(JSON.parse(fs.readFileSync(file, "utf8")), expectedRegistry);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? ".release/manifest.json";
  const manifest = readReleaseManifest(file, process.env.AZURE_CONTAINER_REGISTRY);
  const output = [
    `version=${manifest.version}`,
    `source_sha=${manifest.sourceSha}`,
    `api_image=${manifest.apiImage}`,
    `web_image=${manifest.webImage}`,
  ].join("\n");
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`, { encoding: "utf8", mode: 0o600 });
  }
  console.log(JSON.stringify({ event: "release_manifest_validated", ...manifest }));
}
