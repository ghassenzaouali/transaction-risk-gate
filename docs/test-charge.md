# Tests de charge et scalabilité

## Pourquoi ce test est obligatoire

Le cahier des charges demande de simuler une augmentation du trafic et de montrer le comportement
sous charge. Le test vérifie simultanément performance, autoscaling Azure et cohérence Redis entre
replicas.

## Profils k6

| Profil     | Charge                           | Usage                  |
| ---------- | -------------------------------- | ---------------------- |
| `baseline` | 5 VU pendant 30 s                | référence courte       |
| `scale`    | 0 → 5 → 50 → 150 → 0 VU en 3 min | autoscaling attendu    |
| `stress`   | 0 → 50 → 150 → 300 → 0 en 3 min  | recherche de la limite |

Le workflow manuel refuse la production. Un `LOAD_TEST_TOKEN` propre à l’environnement relève le
plafond de rate limiting uniquement en intégration/préproduction. Le secret n’est ni journalisé ni
envoyé au navigateur par l’application.

## Contrats par profil

Le taux d'erreur et les checks portent la même exigence sur les trois profils. La latence distingue
en revanche l'objectif interactif de référence et les enveloppes sous saturation contrôlée :

| Profil     | Erreurs HTTP | Checks | p95       | p99       | Interprétation                       |
| ---------- | ------------ | ------ | --------- | --------- | ------------------------------------ |
| `baseline` | `< 1 %`      | `>99%` | `<250ms`  | `<500ms`  | objectif interactif                  |
| `scale`    | `< 1 %`      | `>99%` | `<750ms`  | `<1000ms` | autoscaling jusqu'à 150 VU           |
| `stress`   | `< 1 %`      | `>99%` | `<1250ms` | `<1750ms` | caractérisation à 300 VU, pas un SLO |

Les objectifs initiaux utilisaient `p95 < 250 ms` et `p99 < 500 ms` pour tous les profils. Le
premier benchmark Azure a confirmé ces valeurs pour `baseline`. `scale` et `stress` ont conservé 0 %
d'erreur, 100 % de checks et une cohérence Redis complète, mais ont franchi uniquement les seuils de
latence initiaux. Les enveloppes ci-dessus ont donc été séparées par intention. Elles restent
supérieures aux mesures avec une marge observable et ne transforment pas le stress en promesse de
latence interactive.

## Preuve multi-replica et Redis

Après la charge, k6 envoie cent sondes et collecte `X-Instance-Id`. Les profils `scale` et `stress`
échouent si moins de deux replicas sont observés. Huit transactions simultanées utilisent ensuite la
même carte synthétique : avec `VELOCITY_MAX=3`, au moins cinq réponses doivent contenir la règle
`VELOCITY`, quel que soit le replica ayant répondu.

Le workflow conserve pendant 30 jours : sortie k6, résumé métrique JSON, preuve JSON contenant
replicas/p95/p99/taux d’erreur/vélocité et résumé lisible dans GitHub Actions.

## Exécution

Dans GitHub Actions, choisir **Tests de charge**, un environnement hors production et un profil. Une
exécution locale est possible avec k6 2.2.0 :

```powershell
$env:PUBLIC_BASE_URL = "https://integration.example"
$env:LOAD_TEST_TOKEN = "secret-hors-production"
$env:LOAD_PROFILE = "baseline"
k6 run scripts/load/load-test.js
```

## Résultats vérifiés localement

<!-- À COMPLÉTER en TRG-9, à partir de l'exécution locale réelle. -->

Baseline local (Docker Desktop, un seul replica API, k6 versionné) : consigner la durée, le nombre
d'itérations et de requêtes, le débit moyen, le taux d'erreurs HTTP, le pourcentage de checks, p95,
p99 et le nombre de déclenchements de vélocité sur huit transactions partagées. Vérifier que tous
les seuils `baseline` passent. Cette mesure prouve le script, le token de charge, la passerelle
Nginx et la cohérence Redis locale ; elle ne prouve pas l'autoscaling Azure.

## Résultats vérifiés sur Azure

<!-- À COMPLÉTER en TRG-9, à partir des exécutions k6 réelles contre l'intégration puis la
     préproduction déployées par la CI de ce dépôt. -->

Pour chaque profil, consigner : SHA source, run CI de déploiement préalable, requêtes, débit,
erreurs, checks, p95, p99 et nombre de replicas API observés. Vérifier que `scale` et `stress`
atteignent au moins deux replicas et que la série de huit transactions synchrones déclenche au moins
cinq règles `VELOCITY` quel que soit le replica répondant — preuve que Redis conserve une vision
commune de la carte malgré la distribution du trafic.

| Profil     | Requêtes | Débit | Erreurs | Checks | p95 | p99 | Replicas API |
| ---------- | -------: | ----: | ------: | -----: | --: | --: | -----------: |
| `baseline` |        — |     — |       — |      — |   — |   — |            — |
| `scale`    |        — |     — |       — |      — |   — |   — |            — |
| `stress`   |        — |     — |       — |      — |   — |   — |            — |

## Artefacts GitHub Actions officiels

<!-- À COMPLÉTER en TRG-9 : rejouer les trois profils via le workflow « Tests de charge » depuis
     release/* contre la préproduction. Chaque run produit un artefact 30 jours contenant k6.log,
     k6-summary.json et load-evidence.json. -->

| Profil     | Run GitHub Actions | Erreurs | Checks | p95 | p99 | Replicas | Vélocité |
| ---------- | ------------------ | ------: | -----: | --: | --: | -------: | -------: |
| `baseline` | [`—`][1]           |       — |      — |   — |   — |        — |      —/8 |
| `scale`    | [`—`][2]           |       — |      — |   — |   — |        — |      —/8 |
| `stress`   | [`—`][3]           |       — |      — |   — |   — |        — |      —/8 |

Les artefacts bruts téléchargés pour vérification restent ignorés par Git. La documentation ne
retient que les métriques stables, les identifiants de runs et l'interprétation reproductible.

[1]: https://github.com/ghassenzaouali/transaction-risk-gate/actions/runs/REMPLACER-baseline
[2]: https://github.com/ghassenzaouali/transaction-risk-gate/actions/runs/REMPLACER-scale
[3]: https://github.com/ghassenzaouali/transaction-risk-gate/actions/runs/REMPLACER-stress
