#!/usr/bin/env bash
# Met les trois workloads d'un environnement logique à zéro replica.

set -euo pipefail
command -v az >/dev/null 2>&1 || PATH="$PATH:/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin"
export MSYS_NO_PATHCONV=1

STAGE="${STAGE:-integration}"
RG="${AZURE_RESOURCE_GROUP:-${RG:-rg-transaction-risk-gate}}"
API_BASE_NAME="${AZURE_API_APP_NAME:-api}"
WEB_BASE_NAME="${AZURE_WEB_APP_NAME:-web}"
REDIS_BASE_NAME="${AZURE_REDIS_APP_NAME:-redis}"
case "$STAGE" in
  integration|preproduction) suffix="-$STAGE" ;;
  production) suffix='' ;;
  *) echo "STAGE invalide: $STAGE" >&2; exit 1 ;;
esac

for app in "$WEB_BASE_NAME$suffix" "$API_BASE_NAME$suffix" "$REDIS_BASE_NAME$suffix"; do
  az containerapp update -g "$RG" -n "$app" --min-replicas 0 --output none
  echo "✓ $app → 0 replica"
done
