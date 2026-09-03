# Manifeste de promotion

`manifest.json` est créé sur `release/vX.Y.Z` à partir des digests déjà publiés et validés en
intégration. Les pipelines de préproduction et production lisent ce fichier et refusent tout tag
mutable. Le fichier d’exemple ne constitue pas une preuve de déploiement.

Le manifeste réel contient uniquement la version, le SHA source, les deux références ACR par digest
et la date de création. Aucun secret, URL signée ou résultat généré volumineux n’y entre.
