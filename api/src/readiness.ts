/**
 * État « puis-je servir du trafic ? », lu par `GET /ready` et basculé par
 * l'arrêt gracieux. Un petit objet injecté dans `deps` — pas d'état global
 * mutable.
 */
export type Readiness = {
  isReady(): boolean;
  beginShutdown(): void;
};

export function createReadiness(): Readiness {
  let ready = true;
  return {
    isReady: () => ready,
    beginShutdown: () => {
      ready = false;
    },
  };
}
