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

Le 3 septembre 2026, le runbook Compose (`node scripts/failure/redis-outage.mjs`) a produit
`redis_failure_recovery_passed` : décision dégradée `REVIEW` de score 30 pendant l'arrêt de Redis,
décision rétablie `APPROVED` après redémarrage et sonde half-open du circuit breaker, readiness
finale `normal`. Le smoke préalable confirmait santé, cinq règles, Redis disponible et rejeu
idempotent. La politique fail-safe n'a produit aucune approbation pendant la panne.

Rollback de déploiement : le [run du rollback][1] rejouera en intégration la bascule du trafic vers
les révisions précédentes, le smoke test sur l'état restauré et le maintien du workflow en échec ;
le [run de restauration][2] rétablira ensuite explicitement les révisions courantes. Ces deux runs
sont déclenchés via `workflow_dispatch` de `deploy.yml`, une fois le workflow présent sur `main`. La
production n'est jamais ciblée.

[1]: https://github.com/ghassenzaouali/transaction-risk-gate/actions/runs/REMPLACER-rollback
[2]: https://github.com/ghassenzaouali/transaction-risk-gate/actions/runs/REMPLACER-restauration
