/**
 * Serveur de développement local — le remplaçant de nginx tant que la brique
 * Docker n'existe pas. Deux rôles, exactement ceux de nginx en production :
 *   1. sert les fichiers statiques de `web/` ;
 *   2. relaie `/api/*` vers l'API en injectant `X-API-Key` côté serveur, pour
 *      que la clé n'atteigne jamais le navigateur.
 *
 * Zéro dépendance : uniquement des modules natifs de Node.
 *   node --env-file-if-exists=../.env web/dev-server.mjs
 */
import { createServer, request as proxyRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";

const WEB_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WEB_PORT ?? 8080);
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3000";
const API_KEY = process.env.API_KEY ?? "";

const CONTENT_TYPE = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

function relayToApi(clientRequest, clientResponse) {
  const target = new URL(clientRequest.url, API_ORIGIN);
  const headers = { ...clientRequest.headers, host: target.host };
  delete headers["x-api-key"];
  delete headers["x-load-test-token"];
  if (API_KEY) headers["x-api-key"] = API_KEY;

  const upstream = proxyRequest(
    target,
    { method: clientRequest.method, headers },
    (upstreamResponse) => {
      clientResponse.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(clientResponse);
    },
  );
  upstream.on("error", () => {
    clientResponse.writeHead(502, { "content-type": "application/json" });
    clientResponse.end(JSON.stringify({ error: "bad_gateway" }));
  });
  clientRequest.pipe(upstream);
}

async function serveStatic(clientRequest, clientResponse) {
  const requestedPath = (clientRequest.url ?? "/").split("?")[0];
  const relative = normalize(requestedPath === "/" ? "/index.html" : requestedPath);
  const file = join(WEB_DIR, relative);
  if (!file.startsWith(WEB_DIR)) {
    clientResponse.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    clientResponse.writeHead(200, {
      "content-type": CONTENT_TYPE[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    });
    clientResponse.end(body);
  } catch {
    clientResponse.writeHead(404).end("not found");
  }
}

createServer((clientRequest, clientResponse) => {
  if (
    (clientRequest.url ?? "").startsWith("/api/") ||
    (clientRequest.url ?? "").split("?", 1)[0] === "/ready"
  ) {
    relayToApi(clientRequest, clientResponse);
  } else {
    void serveStatic(clientRequest, clientResponse);
  }
}).listen(PORT, () => {
  console.log(`web  → http://localhost:${PORT}`);
  console.log(
    `api  → ${API_ORIGIN}  ·  X-API-Key : ${API_KEY ? "injectée" : "ABSENTE (définis API_KEY)"}`,
  );
});
