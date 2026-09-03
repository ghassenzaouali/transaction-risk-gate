# ADR-003 — Hébergement sur Azure Container Apps

## Statut

Acceptée. Infrastructure implémentée dans `TRG-7`; livraison immuable et rollback automatisés dans
`TRG-8`.

## Contexte

Le cahier des charges demande conteneurisation, CI/CD, déploiement cloud et comportement sous
charge. La solution doit pouvoir augmenter le nombre de replicas sans gérer directement un cluster
Kubernetes.

## Décision

Azure Container Apps héberge le web et l’API. Azure Container Registry conserve les images. GitHub
Actions s’authentifie par OIDC, construit une seule fois puis déploie des digests immuables.

Topologie visée :

```text
Internet -> web public -> API privée -> Redis privé
```

Les branches utilisent trois environnements logiques :

| Branche            | Environnement |
| ------------------ | ------------- |
| `develop`          | intégration   |
| `release/*`        | préproduction |
| `main` ou tag `v*` | production    |

Les environnements partagent ACR, Log Analytics et l'environnement Container Apps, mais possèdent
des apps Redis/API/web, des secrets et un état distincts. Cette mutualisation réduit le coût de cet
exercice ; une séparation physique reste une évolution de production.

## Sécurité et exploitation

- HTTPS uniquement sur l’entrée publique ;
- API et Redis sans exposition Internet directe ;
- secrets injectés au runtime ;
- identité OIDC sans secret Azure permanent dans GitHub ;
- images identifiées par SHA et digest, jamais déployées depuis `latest` ;
- health, readiness, métriques, logs structurés et arrêt gracieux ;
- révision précédente conservée pour rollback.

## Conséquences

Container Apps simplifie l’autoscaling et les révisions, mais lie le premier déploiement à Azure.
L’architecture applicative et les conteneurs restent portables ; les scripts d’exploitation Azure ne
le sont pas. Le Redis conteneurisé privé réduit le coût mais n'offre ni SLA managé, ni TLS
applicatif, ni persistance ; Azure Managed Redis est l'évolution de production.

## Alternatives écartées

| Option               | Motif                                                                |
| -------------------- | -------------------------------------------------------------------- |
| machine virtuelle    | trop d’exploitation système pour cet exercice                        |
| AKS                  | contrôle puissant mais disproportionné en coût et complexité         |
| fonctions serverless | cycle de vie et connexion Redis moins lisibles pour la démonstration |

## Vérification attendue

Déploiement OIDC, ingress privé, plusieurs `X-Instance-Id`, smoke tests, montée en charge, panne
Redis et rollback vers une révision antérieure. TRG-8 automatise ces opérations ; une exécution
cloud verte et ses artefacts restent la preuve attendue, pas la seule présence du YAML.
