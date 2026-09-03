# Contribuer à Transaction Risk Gate

Toute contribution passe par une issue `TRG-N`, une branche courte et une pull request validée par
les contrôles automatiques. La politique canonique se trouve dans le
[guide Git](docs/governance/git-policy.md).

## Préparer le poste

Prérequis : Git, Node.js 22 ou plus récent, npm, Python 3.11 ou plus récent et Docker.

Sous PowerShell :

```powershell
./scripts/dev/bootstrap-hooks.ps1
npm ci --prefix api
```

Sous Linux ou Git Bash :

```bash
./scripts/dev/bootstrap-hooks.sh
npm ci --prefix api
```

Le bootstrap installe une version locale et épinglée de `pre-commit`, prépare ses environnements et
configure `core.hooksPath=.githooks`. Aucun outil Python n’est installé globalement.

## Cycle d’une contribution

1. Choisir une issue et synchroniser `develop`.
2. Créer `<classe>/TRG-<numéro>-<description-kebab-case>`.
3. Modifier ensemble code, tests, contrats et documentation concernés.
4. Exécuter les contrôles locaux puis relire `git diff`.
5. Créer des commits `[TRG-N] verbe à l’infinitif`.
6. Pousser vers une branche distante de même nom.
7. Ouvrir une PR vers `develop`, résoudre les discussions et attendre les checks obligatoires.

Exemple :

```powershell
git fetch origin
git checkout develop
git pull --ff-only origin develop
git checkout -b feat/TRG-2-risk-engine
```

Les branches sources sont conservées après fusion pour cet exercice. Les pushes directs et les
force-pushes vers les références protégées sont interdits.

## Vérification locale

Contrôles rapides :

```powershell
node --test scripts/governance/tests/git-policy.test.mjs
node scripts/governance/validate-repository.mjs
npm run build --prefix api
npm test --prefix api
npm test --prefix web
```

La CI répète ces contrôles dans un environnement propre et reste l’autorité. Un hook contourné pour
diagnostiquer le poste ne constitue jamais une preuve de qualité et doit être signalé dans la PR.

## Documentation

La documentation évolue dans la même PR que le comportement. Mermaid reste la source des diagrammes
et OpenAPI deviendra la source du contrat HTTP. Le README complet sera finalisé lorsque le produit
et ses preuves opérationnelles seront stables.
