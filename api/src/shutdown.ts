import type { FastifyInstance } from "fastify";

type Closable = Pick<FastifyInstance, "close" | "log">;

/**
 * Attend la fin du drainage (`app.close()` : plus de nouvelles connexions, les
 * requêtes en cours se terminent), avec un plafond de temps. Rejette si le
 * drainage dépasse `timeoutMs` ou si `close()` échoue. Ne touche pas au process.
 */
export function shutdownGracefully(app: Closable, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Pas de `unref()` : pendant le drainage, on veut justement que ce timer
    // maintienne le process en vie jusqu'à `close()` ou l'échéance.
    const timer = setTimeout(
      () => reject(new Error(`drainage non terminé en ${timeoutMs} ms`)),
      timeoutMs,
    );

    app.close().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(
          error instanceof Error ? error : new Error("app.close() a échoué", { cause: error }),
        );
      },
    );
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type ShutdownOptions = {
  timeoutMs: number;
  /** Délai entre « /ready → 503 » et l'arrêt des connexions, le temps que le
   *  load balancer nous retire du pool. `0` pour désactiver. */
  drainDelayMs: number;
  /** Appelé dès le signal, avant le délai — typiquement `readiness.beginShutdown`. */
  onShutdownStart?: () => void;
};

/**
 * Branche SIGTERM (plateforme) et SIGINT (Ctrl+C) sur un arrêt gracieux :
 * signal → `onShutdownStart` → délai de drain → `app.close()` → exit.
 * Premier signal seulement ; un second est ignoré, l'arrêt est déjà lancé.
 */
export function registerGracefulShutdown(app: FastifyInstance, options: ShutdownOptions): void {
  let started = false;

  const handle = async (signal: NodeJS.Signals): Promise<void> => {
    if (started) return;
    started = true;
    app.log.info(
      { event: "shutdown_started", signal },
      "arrêt gracieux : /ready renvoie désormais 503",
    );
    options.onShutdownStart?.();

    if (options.drainDelayMs > 0) await sleep(options.drainDelayMs);

    try {
      await shutdownGracefully(app, options.timeoutMs);
      app.log.info({ event: "shutdown_completed" }, "arrêt gracieux terminé");
      process.exit(0);
    } catch (error) {
      app.log.error(
        { event: "shutdown_failed", errorType: error instanceof Error ? error.name : "unknown" },
        "arrêt gracieux : échec ou dépassement, sortie forcée",
      );
      process.exit(1);
    }
  };

  process.once("SIGTERM", (signal) => void handle(signal));
  process.once("SIGINT", (signal) => void handle(signal));
}
