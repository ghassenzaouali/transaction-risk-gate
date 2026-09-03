import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const here = new URL("./", import.meta.url);

/** Références locales d'index.html : attributs `src` et `href` non absolus. */
function htmlLocalAssets(html) {
  const assets = new Set();
  for (const [, value] of html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/gi)) {
    if (/^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith("data:") || value.startsWith("#")) {
      continue;
    }
    assets.add(value.replace(/^\.\//, ""));
  }
  return assets;
}

/** Fermeture transitive des imports ESM relatifs depuis un module d'entrée. */
async function moduleClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const source = await readFile(new URL(name, here), "utf8");
    for (const [, spec] of source.matchAll(/(?:import|export)[^"';]*?\bfrom\s*"(\.\/[^"]+)"/g)) {
      queue.push(spec.replace(/^\.\//, ""));
    }
  }
  return seen;
}

/** Fichiers copiés à la racine servie par le Dockerfile web. */
function dockerfileWebRootFiles(dockerfile) {
  const copyLine = dockerfile
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^COPY\s+.+\s+\/usr\/share\/nginx\/html\/?$/.test(line));
  assert.ok(copyLine, "aucune ligne COPY vers /usr/share/nginx/html/ dans web/Dockerfile");
  return new Set(
    copyLine
      .replace(/^COPY\s+/, "")
      .replace(/\s+\/usr\/share\/nginx\/html\/?$/, "")
      .split(/\s+/),
  );
}

test("l'image web embarque tous les fichiers dont la page a besoin", async () => {
  const [html, dockerfile] = await Promise.all([
    readFile(new URL("index.html", here), "utf8"),
    readFile(new URL("Dockerfile", here), "utf8"),
  ]);

  const required = new Set([...htmlLocalAssets(html), ...(await moduleClosure("app.mjs"))]);
  const shipped = dockerfileWebRootFiles(dockerfile);

  const missing = [...required].filter((asset) => !shipped.has(asset));
  assert.deepEqual(
    missing,
    [],
    `fichiers requis par la page mais absents du COPY de web/Dockerfile : ${missing.join(", ")}`,
  );
});
