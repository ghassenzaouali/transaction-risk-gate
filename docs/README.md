# Documentation

Cette documentation décrit le comportement livré, les preuves exécutées et les limites. Une preuve
cloud n’est déclarée acquise qu’après un workflow vert associé à un SHA.

## Architecture et décisions

- [Architecture générale](architecture.md)
- [Modèle métier et règles de décision](metier.md)
- [Résilience et cohérence Redis](redis.md)
- [Sécurité de l'API](securite.md)
- [Exploitation et observabilité](exploitation.md)
- [Plateforme conteneurisée et Azure](plateforme-azure.md)
- [Livraison, promotion et rollback](livraison.md)
- [Interface web de démonstration](interface-web.md)
- [Contrat OpenAPI](api/openapi.yaml)
- [Collection Postman](postman/transaction-risk-gate.postman_collection.json)
- [Stratégie de tests](tests.md)
- [Tests de charge](test-charge.md)
- [Tests de panne](test-panne.md)
- [Limites et améliorations](limites.md)
- [ADR-001 — TypeScript et Fastify](decisions/ADR-001-typescript-fastify.md)
- [ADR-002 — Cohérence distribuée avec Redis](decisions/ADR-002-coherence-redis.md)
- [ADR-003 — Hébergement Azure](decisions/ADR-003-hebergement-azure.md)

## Gouvernance

- [Politique Git](governance/git-policy.md)
- [Definition of Done](governance/definition-of-done.md)
- [Quality gates](governance/quality-security-gates.md)
- [Politique de release](governance/release-policy.md)

## Preuves

- déploiement intégration par OIDC et smoke test verts (run `33759252435`, SHA `4b6a27de`) ;
- baseline k6 local : 0 % d'erreur HTTP, 100 % de checks, cinq déclenchements de vélocité sur huit
  transactions ; `scale` et `stress` Azure rejoués par le workflow depuis `release/*` ;
- panne Redis Compose : `redis_failure_recovery_passed` — `REVIEW` dégradé puis `APPROVED` rétabli ;
- promotion du même digest jusqu'à la release taguée via `.release/manifest.json`.
