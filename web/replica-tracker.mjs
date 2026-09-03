/**
 * Déduit le nombre de replicas actifs des en-têtes `X-Instance-Id` vus dans les
 * réponses. Une instance revue dans la dernière fenêtre `ttlMs` compte ; au-delà
 * elle est oubliée (scale-in, ou instance qui ne répond plus). Aucun appel à
 * Azure : l'information est déjà dans les réponses que le tableau de bord reçoit.
 */
export function createReplicaTracker(ttlMs = 30_000) {
  /** @type {Map<string, number>} identifiant d'instance -> instant de la dernière réponse */
  const lastSeen = new Map();

  return {
    observe(instanceId, now = Date.now()) {
      if (instanceId) lastSeen.set(instanceId, now);
    },

    count(now = Date.now()) {
      for (const [instanceId, seenAt] of lastSeen) {
        if (now - seenAt > ttlMs) lastSeen.delete(instanceId);
      }
      return lastSeen.size;
    },
  };
}
