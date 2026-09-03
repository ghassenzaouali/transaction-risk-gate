# Stratégie de tests

## Objectif

Les tests cherchent à prouver le comportement métier, les frontières de sécurité et la capacité à
exploiter le service. Un pourcentage seul ne suffit pas : chaque risque important possède un niveau
de test adapté.

## Pyramide appliquée

| Niveau                 | Exemples                                                      |
| ---------------------- | ------------------------------------------------------------- |
| domaine unitaire       | cinq règles, bornes 29/30 et 59/60, score maximal, EUR        |
| application            | compteur de vélocité injecté, mode fail-safe                  |
| API par injection      | validation, auth, idempotence, concurrence, headers, limites  |
| intégration Redis réel | Lua atomique, TTL, HMAC, single-flight, rate limiting partagé |
| web                    | scénarios, rendu, historique de session, suivi des replicas   |
| cycle de vie           | readiness, métriques, redaction, SIGTERM et drainage          |
| conteneur              | non-root, read-only, health checks, Compose                   |
| cloud                  | smoke, promotion par digest, charge, panne et rollback        |

## Couverture

La CI impose au moins 80 % pour l’API et le web, en incluant tous les fichiers de production. Le
domaine métier possède une cible renforcée de 90 %. Les exclusions Sonar sont limitées aux points de
composition et serveurs locaux sans logique métier.

Dernière mesure locale vérifiée avant TRG-9 :

| Périmètre |  Lignes | Branches |
| --------- | ------: | -------: |
| API       | 95,29 % |  89,93 % |
| domaine   | 99,20 % |  96,42 % |
| web       | 99,51 % |  86,23 % |

Les quality gates ne sont jamais assouplis pour accepter un changement. Une baisse exige du code
testé ou une justification d’exclusion ciblée et revue.

## Contrôles négatifs

Les suites couvrent notamment : devise autre que EUR, champs supplémentaires, content type
incorrect, payload trop grand, clé API absente, mauvais request id, conflit d’idempotence, requêtes
concurrentes, Redis lent ou indisponible, circuit ouvert, fuite dans les logs et arrêt forcé.

## Preuves externes

- SonarCloud vérifie bugs, vulnérabilités, hotspots, duplication et couverture ;
- Snyk Open Source et Code bloquent les risques `HIGH` ou supérieurs ;
- Gitleaks refuse les secrets ;
- Trivy refuse les vulnérabilités `HIGH` et `CRITICAL` des images ;
- smoke tests vérifient santé, Redis, règles, décision et rejeu après déploiement ;
- k6 produit un résumé JSON et une preuve des replicas/vélocité comme artefacts GitHub.

Les résultats de charge ne sont consignés qu’après une exécution réelle, jamais estimés depuis le
code.
