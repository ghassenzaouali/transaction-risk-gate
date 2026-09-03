# Limites et améliorations

## Limites assumées

| Limite                                 | Conséquence                                                  |
| -------------------------------------- | ------------------------------------------------------------ |
| heuristiques déterministes             | aucune prétention à détecter une fraude réelle               |
| EUR uniquement                         | aucun taux de change ni politique multidevise                |
| absence d’authentification utilisateur | la clé API protège seulement web → API                       |
| absence de stockage métier durable     | décisions présentes dans la réponse et les logs d’audit      |
| Redis unique par environnement         | état partagé temporaire, mais dépendance centrale            |
| fenêtre de vélocité fixe               | modèle plus simple qu’une fenêtre glissante                  |
| seuils au démarrage                    | modification par configuration et redéploiement              |
| un seul fournisseur cloud              | IaC et runbooks Azure Container Apps                         |
| environnement de charge limité         | résultats non extrapolables à une plateforme bancaire réelle |
| maximum de dix replicas testé          | capacité bornée par l'abonnement étudiant                    |

## Raisons

La taille fonctionnelle reste compatible avec un test technique, tandis que les qualités
d’ingénierie sont démontrables de bout en bout. Ajouter une base métier, un fournisseur d’identité,
un moteur ML ou du multi-cloud masquerait les décisions importantes derrière du volume de code et ne
rendrait pas la démonstration plus honnête.

## Évolutions prioritaires

1. persister une piste métier chiffrée avec politique de rétention et droit d’accès ;
2. intégrer OIDC utilisateur et autorisations par rôle ;
3. versionner dynamiquement les politiques de risque avec approbation et rollback ;
4. utiliser un service Redis managé redondé avec rotation sans interruption ;
5. ajouter WAF, private endpoints et limitation à l’ingress ;
6. calibrer règles/seuils avec des données gouvernées et mesurer les faux positifs/négatifs ;
7. tester régulièrement restauration, rotation, montée de version et reprise de région.

Une amélioration future doit garder les garanties actuelles : explicabilité, idempotence,
observabilité, tests de panne, artefacts immuables et quality gates bloquants.
