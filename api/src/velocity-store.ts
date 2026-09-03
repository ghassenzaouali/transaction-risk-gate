/**
 * Source de vérité du compteur de vélocité. C'est le *seam* du projet : la
 * règle VELOCITY ne dépend que de cette interface, jamais d'une implémentation.
 * Passer à Redis = un nouveau fichier `redis-velocity-store.ts` + une variable
 * d'environnement, sans toucher aux règles.
 */
export interface VelocityStore {
  /**
   * Enregistre une occurrence pour cette carte et renvoie le nombre
   * d'occurrences dans la fenêtre courante, celle-ci comprise.
   */
  hit(cardId: string): Promise<number>;
}

type Window = { count: number; resetAt: number };

/**
 * Compteur en mémoire à **fenêtre fixe** — volontairement la même sémantique
 * que Redis `INCR` + `EXPIRE` : le compteur d'une carte repart de zéro à
 * l'expiration de sa fenêtre, il ne glisse pas. Ainsi le passage à Redis
 * préserve le comportement de détection, pas seulement l'interface.
 *
 * Limites assumées, toutes résolues par l'implémentation Redis :
 *  - non partagé : chaque replica a son propre compteur (c'est LE défaut que le
 *    projet met en scène) ;
 *  - les cartes jamais revues gardent une entrée jusqu'au redémarrage.
 */
export class InMemoryVelocityStore implements VelocityStore {
  readonly #windows = new Map<string, Window>();
  readonly #windowMs: number;
  readonly #now: () => number;

  // `now` injectable pour tester l'expiration de fenêtre sans horloge réelle.
  constructor(windowSeconds: number, now: () => number = () => Date.now()) {
    this.#windowMs = windowSeconds * 1000;
    this.#now = now;
  }

  async hit(cardId: string): Promise<number> {
    const now = this.#now();
    const current = this.#windows.get(cardId);

    if (current === undefined || now >= current.resetAt) {
      this.#windows.set(cardId, { count: 1, resetAt: now + this.#windowMs });
      return 1;
    }

    current.count += 1;
    return current.count;
  }
}
