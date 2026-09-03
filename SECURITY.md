# Politique de sécurité

## Signaler un problème

Ne publiez pas une vulnérabilité, une clé ou une donnée bancaire dans une issue publique. Prévenez
directement les propriétaires du dépôt par un canal privé et indiquez uniquement :

- le composant et la version concernés ;
- les préconditions et l’impact supposé ;
- une reproduction utilisant des données synthétiques ;
- une proposition de correction ou de confinement si elle existe.

Les secrets éventuellement exposés sont révoqués avant l’analyse détaillée. Un rapport public
expurgé peut être ajouté après correction.

## Données protégées

Le projet n’accepte aucune véritable donnée bancaire. Les identifiants de carte des tests sont
synthétiques. Les journaux, traces, métriques, rapports et clés Redis ne doivent contenir ni
identifiant brut, ni secret, ni payload complet.

## Politique de vulnérabilité

- toute vulnérabilité `CRITICAL` bloque la fusion et la release ;
- toute vulnérabilité `HIGH` exploitable bloque la fusion et la release ;
- un report exceptionnel précise propriétaire, justification, compensation et date d’expiration ;
- un scanner indisponible ou non configuré fait échouer un contrôle obligatoire ;
- une correction publiée produit une nouvelle version, jamais la modification d’un tag ou d’une
  image existante.

Les contrôles applicables sont détaillés dans la
[politique qualité et sécurité](docs/governance/quality-security-gates.md).
