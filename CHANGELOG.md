# Journal des versions

Les changements notables suivent [Semantic Versioning](https://semver.org/lang/fr/). Les images
promues sont identifiées dans le manifeste de release et ne sont jamais reconstruites entre les
environnements.

## v1.0.0 — 2026-09-03

Première version de Transaction Risk Gate, promue sans reconstruction depuis l'intégration jusqu'à
la production (digests `transaction-risk-gate-api@sha256:878ba795…` et
`transaction-risk-gate-web@sha256:a4b2975c…`) :

- moteur explicable à cinq règles et décisions `APPROVED`, `REVIEW` ou `REJECTED` ;
- vélocité et idempotence distribuées dans Redis, avec politique fail-safe en cas de panne ;
- API Fastify privée et interface Nginx publique, toutes deux exécutées sans privilège root ;
- logs JSON, métriques Prometheus, health, readiness et arrêt gracieux ;
- couverture supérieure à 80 %, cible métier supérieure à 90 % et quality gates bloquants ;
- SonarCloud, Snyk, Gitleaks, Trivy, hooks locaux et gouvernance Git automatisée ;
- images immuables, déploiement Azure Container Apps par OIDC, smoke test et rollback ;
- profils k6 `baseline`, `scale` et `stress` avec cohérence Redis observée sous autoscaling ;
- contrat OpenAPI, collection Postman et documentation française complète.

Limites assumées : règles heuristiques, EUR uniquement, aucune authentification utilisateur ni
persistance métier durable, Redis mono-replica et environnement Azure Container Apps mutualisé.
