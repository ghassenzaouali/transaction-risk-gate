# Definition of Done

Un élément est terminé seulement si toutes les exigences applicables possèdent une preuve.
`Non applicable` nécessite une justification dans la PR.

## Prêt à développer

- [ ] L’issue `TRG-N`, le périmètre, le risque et la release sont identifiés.
- [ ] La branche et les chemins concernés sont connus.
- [ ] Les critères couvrent réussite, rejet et panne applicables.
- [ ] Les décisions d’architecture bloquantes sont fermées ou documentées.
- [ ] Les impacts sécurité, données et exploitation sont classifiés.
- [ ] Le changement est assez petit pour être relu, testé et récupéré seul.

## Toute pull request

- [ ] Issue, branche, commits et titre utilisent le même `TRG-N`.
- [ ] La branche suit la politique et possède un upstream de même nom.
- [ ] Les labels `type`, `risk`, `area` et `release` sont complets.
- [ ] Le diff est cohérent et ne contient aucun fichier local ou généré.
- [ ] Les hooks locaux et les contrôles ciblés ont réussi.
- [ ] La CI obligatoire a réussi sans skip caché ni tolérance d’échec.
- [ ] Une review facultative demandée pour un changement sensible est terminée.
- [ ] Toutes les discussions ouvertes sont résolues.
- [ ] Documentation et stratégie de récupération sont à jour.

## Code et architecture

- [ ] Les limites domaine, application et infrastructure restent explicites.
- [ ] Les tests prouvent les règles et les cas limites, pas seulement des lignes.
- [ ] Les chemins négatifs de sécurité sont testés.
- [ ] Concurrence, idempotence, panne et redémarrage sont testés si concernés.
- [ ] La couverture globale reste au moins à 80 %.
- [ ] Le domaine métier vise une couverture supérieure à 90 %.
- [ ] Sonar, Snyk, Gitleaks et Trivy respectent leurs seuils applicables.
- [ ] Le comportement public est documenté tel qu’implémenté.

## API ou contrat

- [ ] OpenAPI est modifié avec le comportement.
- [ ] Headers, erreurs, idempotence et exemples synthétiques sont représentés.
- [ ] Validation et compatibilité du contrat réussissent.
- [ ] Une rupture possède une version et une stratégie de migration explicites.

## Sécurité

- [ ] Les frontières de confiance et scénarios d’abus sont à jour.
- [ ] Authentification incorrecte, replay et élévation de privilèges sont évalués.
- [ ] Les secrets et identifiants sont expurgés des réponses et de la télémétrie.
- [ ] Une dépendance indisponible échoue de façon sûre.
- [ ] Aucune vulnérabilité Critical ou High exploitable ne reste ouverte.

## Documentation

- [ ] Le document canonique est modifié sans créer une source concurrente.
- [ ] Les diagrammes Mermaid correspondent aux frontières réelles.
- [ ] Les liens et blocs de code sont valides.
- [ ] Aucun chemin de poste, token, URL privée ou donnée réelle n’est présent.

## CI, conteneur ou livraison

- [ ] Les permissions suivent le moindre privilège.
- [ ] Les Actions, outils et images sont épinglés.
- [ ] Aucun contrôle obligatoire n’est devenu optionnel.
- [ ] Les images s’exécutent sans privilège et ne sont pas promues par `latest`.
- [ ] Commit, image, digest et environnement restent traçables.
- [ ] Le déploiement échoué laisse la version précédente récupérable.

## Release

- [ ] Un même digest traverse validation et production sans reconstruction.
- [ ] Régression, sécurité, smoke, charge et panne applicables sont validés.
- [ ] Documentation, limites et runbooks sont à jour.
- [ ] Le tag SemVer pointe vers le commit accepté et reste immuable.
- [ ] Les preuves identifient commit, digests, environnement et date.

## Conditions « non terminé »

Le travail n’est pas terminé si un test ne passe qu’après un retry inexpliqué, si un scanner
obligatoire est absent, si la couverture est contournée, si un comportement n’est pas documenté, si
une vulnérabilité bloquante reste ouverte ou si un artefact différent de celui testé est promu.
