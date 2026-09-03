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

Baseline local du 3 septembre 2026 (Docker Desktop, un seul replica API, k6 2.2.0, passerelle Nginx
et Redis Compose) :

- durée : 30 s avec 5 utilisateurs virtuels ;
- 8 213 itérations et 8 323 requêtes ;
- débit moyen : 275,2 requêtes/s ;
- erreurs HTTP : 0 % ; checks : 100 % (32 857/32 857) ;
- p95 : 34,4 ms ; p99 : 50,7 ms ;
- un replica local attendu ;
- cinq déclenchements de vélocité sur huit transactions partagées.

Tous les seuils `baseline` passent. Cette mesure prouve le script, le token de charge, la passerelle
Nginx et la cohérence Redis locale ; elle ne prouve pas l'autoscaling Azure.

## Résultats vérifiés sur Azure

Le 3 septembre 2026, les trois profils ont été exécutés depuis `release/v1.0.0` contre la
préproduction (SHA source `4b6a27de`, digests du manifeste `v1.0.0`, aucune reconstruction). `scale`
et `stress` atteignent le maximum configuré de dix replicas et déclenchent cinq règles `VELOCITY`
réparties sur plusieurs replicas distincts — Redis conserve une vision commune de la carte malgré la
distribution du trafic.

| Profil     | Requêtes | Débit     | Erreurs | Checks | p95    | p99      | Replicas API |
| ---------- | -------: | --------- | ------: | -----: | ------ | -------- | -----------: |
| `baseline` |    1 187 | 36 req/s  |     0 % |  100 % | 153 ms | 167 ms   |            1 |
| `scale`    |   50 269 | 275 req/s |     0 % |  100 % | 451 ms | 595 ms   |           10 |
| `stress`   |   66 079 | 361 req/s |     0 % |  100 % | 843 ms | 1 102 ms |           10 |

Les enveloppes de latence par profil (`250/500`, `750/1000`, `1250/1750` ms) sont respectées avec
marge. `baseline` reste volontairement mono-replica : son objectif est la latence interactive, pas
l'autoscaling.

## Artefacts GitHub Actions officiels

Chaque run du workflow **Tests de charge** conserve 30 jours un artefact contenant `k6.log`,
`k6-summary.json` et `load-evidence.json`.

| Profil     | Run GitHub Actions | Erreurs | Checks | p95    | p99      | Replicas | Vélocité |
| ---------- | ------------------ | ------: | -----: | ------ | -------- | -------: | -------: |
| `baseline` | [`33769001273`][1] |     0 % |  100 % | 153 ms | 167 ms   |        1 |      5/8 |
| `scale`    | [`33769498092`][2] |     0 % |  100 % | 451 ms | 595 ms   |       10 |      5/8 |
| `stress`   | [`33769016355`][3] |     0 % |  100 % | 843 ms | 1 102 ms |       10 |      5/8 |

Sous `scale`, les cinq déclenchements de vélocité ont traversé cinq replicas distincts ; sous
`stress`, sept. Les artefacts bruts téléchargés pour vérification restent ignorés par Git.

[1]: https://github.com/ghassenzaouali/transaction-risk-gate/actions/runs/33769001273
[2]: https://github.com/ghassenzaouali/transaction-risk-gate/actions/runs/33769498092
[3]: https://github.com/ghassenzaouali/transaction-risk-gate/actions/runs/33769016355
