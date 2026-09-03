import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

// Comparaison à temps constant : `===` sur une chaîne révèle, par le temps de
// réponse, la longueur et le plus long préfixe correct. On compare des hachages
// SHA-256 (toujours 32 octets, d'où pas de fuite de longueur).
const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

export function keyIsValid(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Exige l'en-tête `X-API-Key` sur tout ce qui est sous `/api/`. Le reste
 * (`/health`, `/ready`, `/metrics`, routes hors `/api/`) passe sans clé : les
 * sondes de la plateforme n'envoient aucun en-tête, un 401 les ferait boucler.
 */
export function registerApiKeyAuth(
  app: FastifyInstance,
  apiKey: string,
  onDenied: () => void,
): void {
  app.addHook("onRequest", (request, reply, done) => {
    if (!request.url.startsWith("/api/")) return done();

    const provided = request.headers["x-api-key"];
    if (typeof provided === "string" && keyIsValid(provided, apiKey)) return done();

    onDenied();
    request.log.warn(
      { event: "authentication_denied", reason: "missing_or_invalid_api_key" },
      "interservice authentication denied",
    );
    reply.code(401).send({ error: "unauthorized" });
  });
}
