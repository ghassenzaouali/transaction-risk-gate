#!/usr/bin/env bash
#
# Supprime toute l'infrastructure : le groupe de ressources et son contenu.
# Usage : bash infra/teardown.sh
#
# Pratique avec un crédit étudiant — rien ne continue de tourner par oubli.

set -euo pipefail

# az fraîchement installé n'est pas sur le PATH d'un shell déjà ouvert (Windows).
command -v az >/dev/null 2>&1 || PATH="$PATH:/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin"

RG="${AZURE_RESOURCE_GROUP:-${RG:-rg-transaction-risk-gate}}"

read -rp "Supprimer le groupe « $RG » et TOUT son contenu ? (tape « oui ») " confirm
[ "$confirm" = "oui" ] || { echo "Annulé."; exit 1; }

az group delete --name "$RG" --yes --no-wait
echo "Suppression lancée en arrière-plan."
