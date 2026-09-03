#!/usr/bin/env bash
# Déploie un environnement logique depuis deux images déjà publiées par digest.
# La construction/promotion des images appartient à la CI/CD (TRG-8).

set -euo pipefail

command -v az >/dev/null 2>&1 || PATH="$PATH:/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin"
command -v az >/dev/null 2>&1 || { echo "Azure CLI (az) est requis." >&2; exit 1; }
export MSYS_NO_PATHCONV=1

cd "$(dirname "${BASH_SOURCE[0]}")/.."

STAGE="${STAGE:?STAGE est requis: integration, preproduction ou production}"
API_IMAGE="${API_IMAGE:?API_IMAGE est requis sous la forme registre/image@sha256:digest}"
WEB_IMAGE="${WEB_IMAGE:?WEB_IMAGE est requis sous la forme registre/image@sha256:digest}"
API_KEY="${API_KEY:?API_KEY est requis}"
REDIS_HMAC_SECRET="${REDIS_HMAC_SECRET:?REDIS_HMAC_SECRET est requis}"
REDIS_PASSWORD="${REDIS_PASSWORD:?REDIS_PASSWORD est requis}"
LOAD_TEST_TOKEN="${LOAD_TEST_TOKEN:-}"

RG="${AZURE_RESOURCE_GROUP:-${RG:-rg-transaction-risk-gate}}"
ENVIRONMENT="${AZURE_CONTAINERAPPS_ENVIRONMENT:-${ENVIRONMENT:-cae-transaction-risk-gate}}"
ACR_NAME="${AZURE_CONTAINER_REGISTRY:?AZURE_CONTAINER_REGISTRY est requis}"
RUNTIME_IDENTITY="${AZURE_RUNTIME_IDENTITY:-${RUNTIME_IDENTITY:-id-transaction-risk-gate-runtime}}"
API_BASE_NAME="${AZURE_API_APP_NAME:-api}"
WEB_BASE_NAME="${AZURE_WEB_APP_NAME:-web}"
REDIS_BASE_NAME="${AZURE_REDIS_APP_NAME:-redis}"
APP_VERSION="${APP_VERSION:-${GITHUB_SHA:-manual}}"
DEPLOY_MODE="${DEPLOY_MODE:-apply}"
APPS_TEMPLATE_FILE="${APPS_TEMPLATE_FILE:-infra/apps.bicep}"

case "$STAGE" in
  integration|preproduction) [ ${#LOAD_TEST_TOKEN} -ge 32 ] || { echo "LOAD_TEST_TOKEN doit contenir au moins 32 caractères hors production." >&2; exit 1; } ;;
  production) [ -z "$LOAD_TEST_TOKEN" ] || { echo "LOAD_TEST_TOKEN est interdit en production." >&2; exit 1; } ;;
  *) echo "STAGE invalide: $STAGE" >&2; exit 1 ;;
esac

case "$DEPLOY_MODE" in
  apply|what-if) ;;
  *) echo "DEPLOY_MODE doit valoir apply ou what-if." >&2; exit 1 ;;
esac

image_pattern='@sha256:[0-9a-f]{64}$'
for image in "$API_IMAGE" "$WEB_IMAGE"; do
  [[ "$image" =~ $image_pattern ]] || { echo "Image mutable refusée: $image" >&2; exit 1; }
done

for secret_name in API_KEY REDIS_HMAC_SECRET REDIS_PASSWORD; do
  secret_value="${!secret_name}"
  [ ${#secret_value} -ge 32 ] || { echo "$secret_name doit contenir au moins 32 caractères." >&2; exit 1; }
done

[[ "$REDIS_PASSWORD" =~ ^[0-9a-fA-F]{64,128}$ ]] || {
  echo "REDIS_PASSWORD doit contenir 64 à 128 caractères hexadécimaux pour rester sûr dans une URL Redis." >&2
  exit 1
}

case "$APPS_TEMPLATE_FILE" in
  *.bicep) az bicep build --file "$APPS_TEMPLATE_FILE" --stdout >/dev/null ;;
  *.json) command -v jq >/dev/null 2>&1 && jq empty "$APPS_TEMPLATE_FILE" ;;
  *) echo "APPS_TEMPLATE_FILE doit être un template .bicep ou ARM .json." >&2; exit 1 ;;
esac

deployment_arguments=(
  --resource-group "$RG"
  --name "trg-$STAGE"
  --template-file "$APPS_TEMPLATE_FILE"
  --parameters
  stage="$STAGE"
  containerAppsEnvironmentName="$ENVIRONMENT"
  containerRegistryName="$ACR_NAME"
  runtimeIdentityName="$RUNTIME_IDENTITY"
  apiBaseName="$API_BASE_NAME"
  webBaseName="$WEB_BASE_NAME"
  redisBaseName="$REDIS_BASE_NAME"
  apiImage="$API_IMAGE"
  webImage="$WEB_IMAGE"
  appVersion="$APP_VERSION"
  apiKey="$API_KEY"
  redisHmacSecret="$REDIS_HMAC_SECRET"
  redisPassword="$REDIS_PASSWORD"
  loadTestToken="$LOAD_TEST_TOKEN"
)

if [ "$DEPLOY_MODE" = "what-if" ]; then
  az deployment group what-if "${deployment_arguments[@]}"
  exit 0
fi

PUBLIC_BASE_URL="$(az deployment group create "${deployment_arguments[@]}" --query properties.outputs.publicBaseUrl.value -o tsv)"
echo "✓ $STAGE déployé depuis des digests immuables"
echo "  interface : $PUBLIC_BASE_URL"
