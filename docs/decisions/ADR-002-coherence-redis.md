# ADR-002 — Cohérence distribuée avec Redis

## Statut

Acceptée et implémentée dans `TRG-3`.

## Contexte

Plusieurs replicas API ne partagent pas leur mémoire. Sans état externe, trois transactions de la
même carte peuvent atteindre trois instances différentes et chaque instance peut croire qu’elle ne
voit qu’une transaction. L’idempotence souffre du même problème lors de requêtes concurrentes.

## Décision

Redis porte uniquement l’état temporaire partagé :

- compteur de vélocité atomique, TTL 60 secondes ;
- réservation et réponse d’idempotence, TTL 24 heures ;
- détection d’une même clé associée à un payload différent ;
- coordination d’une seule évaluation pour les requêtes concurrentes.

L’identifiant de carte est transformé par HMAC avant de devenir une clé. Redis n’est ni une base
métier permanente, ni un stockage de logs ou d’audit.

Timeout initial : 250 ms. Après trois erreurs, le circuit s’ouvre pendant 10 secondes puis autorise
une requête de test. Ces valeurs restent configurables et seront ajustées après mesure.

## Mode dégradé

Si Redis est indisponible, l’API ne peut pas prouver la vélocité globale. Elle force donc :

```json
{
  "decision": "REVIEW",
  "degraded": true,
  "reasons": [
    {
      "rule": "RISK_CONTEXT_UNAVAILABLE"
    }
  ]
}
```

Le score devient au minimum le seuil `REVIEW`. Une panne ne peut jamais réduire le risque ni
produire `APPROVED`. L’événement est journalisé sans donnée sensible et alimente des métriques de
panne, décision dégradée et rétablissement.

## Conséquences

Positives : cohérence entre replicas, opérations atomiques et réponse sûre à une panne. Coûts :
dépendance réseau supplémentaire, configuration de secrets et tests d’intégration réels.

## Alternatives écartées

| Option                   | Motif                                                            |
| ------------------------ | ---------------------------------------------------------------- |
| mémoire locale           | incohérente avec plusieurs replicas                              |
| continuer sans vélocité  | peut approuver une transaction risquée                           |
| retourner uniquement 503 | disponibilité plus faible alors qu’une revue sûre reste possible |
| base relationnelle       | durable et plus lourde que cet état court et atomique            |

## Vérification attendue

Les tests unitaires couvrent TTL, replay, conflit `409`, concurrence, timeout, ouverture et
rétablissement du circuit. Les tests d'intégration exécutés avec un vrai Redis vérifient le partage
multi-replica, les opérations atomiques, l'expiration et l'absence des identifiants bruts dans les
clés. La CI fournit le service Redis nécessaire ; ces scénarios ne sont pas simulés par un mock.
