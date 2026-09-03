# Pull Request

## Résultat attendu

<!-- Décrire le résultat d’ingénierie ou utilisateur, pas seulement les fichiers. -->

## Travail et périmètre

- Issue : `TRG-N` / `#N`
- Branche source :
- Branche cible : `develop`, `release/*` ou `main`
- Reviewer facultatif :
- Labels `type`, `risk`, `area`, `release` :
- Inclus :
- Explicitement exclu :

## Risques et compatibilité

- Niveau de risque : low / medium / high
- Impact sécurité ou données sensibles :
- Impact API, configuration ou infrastructure :
- Compatibilité et migration :
- Rollback ou forward-fix :

## Architecture et documentation

- Documents canoniques mis à jour :
- ADR ajouté ou remplacé :
- Diagrammes Mermaid mis à jour :
- Décisions différées :

## Vérification

- Format et lint :
- Tests unitaires :
- Tests d’intégration :
- Couverture :
- SonarCloud :
- Snyk / Gitleaks / Trivy :
- Smoke ou vérification manuelle :

## Checklist

- [ ] La branche, les commits, la PR et l’issue utilisent le même `TRG-N`.
- [ ] Le titre suit `[TRG-N] résumé commençant par un verbe en minuscule`.
- [ ] La PR possède exactement un label `type`, `risk`, `release` et au moins un `area`.
- [ ] Le diff ne contient aucun changement sans rapport, fichier généré ou secret.
- [ ] Les cas positifs, négatifs, de concurrence et de panne applicables sont testés.
- [ ] La couverture reste supérieure ou égale à 80 % sans exclusion artificielle.
- [ ] La documentation et les contrats correspondent au comportement livré.
- [ ] Tous les contrôles obligatoires sont verts, sans contournement.
- [ ] Toutes les discussions ouvertes sont résolues.
- [ ] La stratégie de récupération est explicite.

## Notes pour le reviewer

<!-- Signaler les décisions et preuves les plus importantes à vérifier. -->
