# Tests de panne et rétablissement

## Panne Redis locale

Avec la stack Compose démarrée :

```powershell
node scripts/failure/redis-outage.mjs
```

Le runbook :

1. arrête uniquement Redis ;
2. soumet une transaction normalement approuvable ;
3. exige HTTP 200, `REVIEW`, score au moins 30, `degraded: true`, header `X-Degraded-Mode: true` et
   raison `RISK_CONTEXT_UNAVAILABLE` ;
4. redémarre Redis même si une assertion échoue ;
5. attend la sonde half-open du circuit breaker ;
6. exige une nouvelle décision `APPROVED`, non dégradée ;
7. confirme `/ready` en mode normal avec Redis disponible.

Cette politique est fail-safe : une information de vélocité inconnue ne devient jamais une
approbation. Le service reste utile pour une revue manuelle au lieu de répondre
systématiquement 503.

## Rollback de déploiement

Avant une nouvelle révision, le workflow capture les révisions API et web actives. Si le smoke test
du candidat échoue, il remet 100 % du trafic sur les deux révisions précédentes, rejoue le smoke et
conserve le workflow en échec. Une restauration saine ne transforme donc jamais un candidat rouge en
livraison réussie.

Le workflow `Déploiement` permet aussi un rollback manuel vers des révisions explicites ou vers les
précédentes. Cette action cible un environnement GitHub protégé et utilise Azure OIDC.

## Résultats vérifiés

<!-- À COMPLÉTER en TRG-9, à partir des exécutions réelles de ce dépôt. -->

Panne Redis locale (`node scripts/failure/redis-outage.mjs`) : consigner la décision dégradée
observée (`REVIEW`, score au moins 30, `degraded: true`), la décision rétablie (`APPROVED`) et la
readiness finale (`normal`).

Rollback de déploiement : consigner le [run du rollback][1] réel en intégration (bascule du trafic
vers les révisions précédentes, smoke test rejoué, workflow maintenu en échec) puis le [run de
restauration][2] explicite des révisions courantes. La production n'est jamais ciblée.

[1]: https://github.com/ghassenzaouali/transaction-risk-gate/actions/runs/REMPLACER-rollback
[2]: https://github.com/ghassenzaouali/transaction-risk-gate/actions/runs/REMPLACER-restauration
