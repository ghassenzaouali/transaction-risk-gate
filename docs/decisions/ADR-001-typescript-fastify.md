# ADR-001 — TypeScript strict et Fastify

## Statut

Acceptée. Mise en œuvre progressive à partir de `TRG-2`.

## Contexte

Le projet doit démontrer une petite application cloud compréhensible, testable et observable. La
candidature n’impose aucune stack. Le portefeuille contient déjà une référence Java/Spring plus
lourde ; ce projet doit montrer que les pratiques d’architecture et de livraison sont indépendantes
du langage.

## Décision

L’API utilise Node.js, TypeScript en mode strict et Fastify. Le web reste léger en HTML, CSS et
JavaScript, servi par Nginx.

Fastify est retenu pour sa faible surcharge, ses performances, son cycle de vie explicite, sa
journalisation structurée et son intégration naturelle avec une validation de schéma. TypeScript
strict réduit les états implicites et rend les contrats du domaine visibles sans introduire un
framework applicatif massif.

Le domaine de risque reste indépendant des routes et de Redis afin d’être testé sans serveur ni
réseau.

## Conséquences

Positives :

- démarrage et image rapides ;
- tests unitaires simples avec le runner Node ;
- validation et sérialisation proches du contrat ;
- code adapté à une démonstration cloud multi-replica.

Contraintes :

- la discipline d’architecture doit être imposée par la structure et les tests ;
- les versions Node, npm et dépendances doivent être épinglées ;
- les erreurs asynchrones et l’arrêt du serveur nécessitent des tests dédiés.

## Alternatives écartées

| Option           | Motif                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Java/Spring Boot | excellente option, mais déjà démontrée dans un autre projet et plus lourde ici           |
| Express          | écosystème large, mais davantage de composition manuelle pour validation et cycle de vie |
| NestJS           | structure complète mais disproportionnée pour ce périmètre                               |

## Vérification attendue

Compilation TypeScript stricte, tests du domaine sans Fastify, tests d’injection HTTP, couverture
bloquante et image exécutée sans privilège.
