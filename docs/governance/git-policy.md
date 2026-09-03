# Politique Git

## But

Cette politique relie une issue, une branche, ses commits et sa pull request. Les hooks donnent un
retour rapide ; GitHub Actions et les rulesets restent l’autorité.

## Branches

Les branches de travail utilisent :

```text
<classe>/TRG-<numéro>-<description-kebab-case>
```

Classes autorisées :

- `feat` : fonctionnalité ;
- `fix` : correction ;
- `security` : durcissement ou vulnérabilité ;
- `test` : tests sans changement métier principal ;
- `docs` : documentation ;
- `refactor` : restructuration sans changement fonctionnel voulu ;
- `ci` : build, livraison ou infrastructure ;
- `chore` : maintenance ;
- `hotfix` : correctif urgent créé depuis `main`.

Exemples valides :

```text
feat/TRG-2-risk-engine
security/TRG-4-api-observability
ci/TRG-8-cicd-release-automation
hotfix/TRG-10-redis-timeout
```

Les branches `feat`, `fix`, `security`, `test`, `docs`, `refactor`, `ci` et `chore` ciblent
`develop`. Une `hotfix` cible `main` puis son changement est réintégré dans `develop`. Une release
utilise `release/v<major>.<minor>.<patch>` et cible `main`.

`main`, `develop` et `release/*` sont protégées : aucun push direct, suppression ou force-push
normal. Les branches sources sont volontairement conservées après fusion pour démontrer le cycle de
livraison.

Dependabot constitue la seule exception de nommage automatisée. Ses PR ciblent `develop`, utilisent
le work item `TRG-6` configuré et restent soumises aux labels et checks. GitHub ajoute
automatiquement un deux-points au préfixe des commits (`[TRG-6]: ...`) : cette variante est acceptée
uniquement sur les branches `dependabot/*`. Les branches humaines conservent strictement le format
`[TRG-N] ...` sans deux-points.

## Commits

Format court :

```text
[TRG-2] implementer le moteur de risque
```

Format long :

```text
[TRG-3] garantir l idempotence distribuee

- reserver atomiquement la cle Redis
- rejouer une reponse pour un payload identique
```

Règles :

- même numéro que la branche ;
- sujet de 72 caractères maximum ;
- verbe à l’infinitif commençant en minuscule ;
- aucun point final ;
- une intention logique par commit ;
- corps optionnel séparé par une ligne vide ;
- chaque ligne non vide du corps commence par `-` suivi d’une espace ;
- aucun secret, rapport généré ou donnée réelle.

Les commits `Merge` et `Revert` générés par Git sont acceptés. Les commits directs sur une branche
protégée sont rejetés.

Les mises à jour Dependabot restent relues avant fusion. Un titre généré trop long est raccourci,
les montées de version majeure sont traitées dans une issue dédiée et les mêmes quality gates que
pour une contribution humaine restent obligatoires.

## Pull requests

Le titre reprend l’identité :

```text
[TRG-2] implementer le moteur de risque explicable
```

Chaque PR :

- cible la branche prévue par sa classe ;
- référence l’issue et décrit inclusions et exclusions ;
- possède exactement un label `type:*`, `risk:*` et `release:*` ;
- possède au moins un label `area:*` ;
- peut demander une review humaine pour un changement sensible ;
- décrit tests, sécurité, documentation et récupération ;
- attend les checks obligatoires et la résolution des discussions.

Le job `Gouvernance` ajoute automatiquement les labels de zone selon les chemins avant de les
contrôler. Le type, le risque et l’impact release restent des décisions explicites de l’auteur.

## Fusions

- travail vers `develop` : merge commit privilégié pour conserver l’histoire ;
- `release/*` vers `main` : merge commit obligatoire ;
- approbation humaine facultative sur ce projet individuel ;
- nouvelle validation des checks après chaque changement de la tête de PR ;
- aucune fusion avec discussion ouverte ou contrôle obligatoire rouge.

La CI réussie doit correspondre au SHA courant de la PR. Une réussite ancienne ne couvre pas un
nouveau push.

## Contrôles exécutables

| Moment     | Contrôles                                                    |
| ---------- | ------------------------------------------------------------ |
| pre-commit | fichiers, secrets, Markdown, politique du dépôt              |
| commit-msg | identité branche/commit et forme du message                  |
| pre-push   | branche, upstream, diff, gouvernance, build et tests rapides |
| PR         | titre, cible, labels, discussions et CI complète applicable  |
| release    | régression, sécurité, charge, smoke et artefact immuable     |

Un contournement local n’affaiblit jamais la CI. Il sert uniquement au diagnostic et doit être
expliqué dans la PR.
