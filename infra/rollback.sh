#!/usr/bin/env bash
# Replace 100 % du trafic API et web vers deux révisions connues. Sans révision
# explicite, sélectionne la révision immédiatement antérieure de chaque app.

set -euo pipefail

command -v az >/dev/null 2>&1 || PATH="$PATH:/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin"
command -v az >/dev/null 2>&1 || { echo "Azure CLI (az) est requis." >&2; exit 1; }
export MSYS_NO_PATHCONV=1

STAGE="${STAGE:?STAGE est requis}"
RG="${AZURE_RESOURCE_GROUP:-${RG:-rg-transaction-risk-gate}}"
API_BASE_NAME="${AZURE_API_APP_NAME:-api}"
WEB_BASE_NAME="${AZURE_WEB_APP_NAME:-web}"

case "$STAGE" in
  integration|preproduction) suffix="-$STAGE" ;;
  production) suffix='' ;;
  *) echo "STAGE invalide: $STAGE" >&2; exit 1 ;;
esac

API_APP="$API_BASE_NAME$suffix"
WEB_APP="$WEB_BASE_NAME$suffix"

previous_revision() {
  local app="$1"
  az containerapp revision list --all --resource-group "$RG" --name "$app" \
    --query 'sort_by(@,&properties.createdTime)[-2].name' --output tsv
}

API_REVISION="${API_REVISION:-$(previous_revision "$API_APP")}"
WEB_REVISION="${WEB_REVISION:-$(previous_revision "$WEB_APP")}"

for revision in "$API_REVISION" "$WEB_REVISION"; do
  [ -n "$revision" ] && [ "$revision" != "None" ] || {
    echo "Aucune révision précédente disponible ; rollback impossible." >&2
    exit 1
  }
done

az containerapp ingress traffic set --resource-group "$RG" --name "$API_APP" \
  --revision-weight "$API_REVISION=100" --output none
az containerapp ingress traffic set --resource-group "$RG" --name "$WEB_APP" \
  --revision-weight "$WEB_REVISION=100" --output none

echo "✓ Rollback $STAGE : API=$API_REVISION WEB=$WEB_REVISION"
