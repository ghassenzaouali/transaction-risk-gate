#!/usr/bin/env bash
# Provisionne uniquement la plateforme partagée : resource group, Log Analytics,
# ACR, identité AcrPull et environnement Container Apps. Aucun build, tag mutable
# ou secret applicatif n'est manipulé ici.

set -euo pipefail

command -v az >/dev/null 2>&1 || PATH="$PATH:/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin"
command -v az >/dev/null 2>&1 || { echo "Azure CLI (az) est requis." >&2; exit 1; }
export MSYS_NO_PATHCONV=1

cd "$(dirname "${BASH_SOURCE[0]}")/.."

LOCATION="${AZURE_LOCATION:-${LOCATION:-swedencentral}}"
RG="${AZURE_RESOURCE_GROUP:-${RG:-rg-transaction-risk-gate}}"
ENVIRONMENT="${AZURE_CONTAINERAPPS_ENVIRONMENT:-${ENVIRONMENT:-cae-transaction-risk-gate}}"
LOG_WORKSPACE="${AZURE_LOG_WORKSPACE:-${LOG_WORKSPACE:-log-transaction-risk-gate}}"
RUNTIME_IDENTITY="${AZURE_RUNTIME_IDENTITY:-${RUNTIME_IDENTITY:-id-transaction-risk-gate-runtime}}"
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-30}"
PROVISION_MODE="${PROVISION_MODE:-apply}"

case "$PROVISION_MODE" in
  apply|what-if) ;;
  *) echo "PROVISION_MODE doit valoir apply ou what-if." >&2; exit 1 ;;
esac

az config set extension.use_dynamic_install=yes_without_prompt --only-show-errors

for namespace in \
  Microsoft.App \
  Microsoft.ContainerRegistry \
  Microsoft.ManagedIdentity \
  Microsoft.OperationalInsights; do
  state="$(az provider show --namespace "$namespace" --query registrationState -o tsv 2>/dev/null || true)"
  if [ "$state" != "Registered" ]; then
    az provider register --namespace "$namespace" --wait --output none
  fi
done

az group create --name "$RG" --location "$LOCATION" --output none

SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
ACR_NAME="${AZURE_CONTAINER_REGISTRY:-${ACR_NAME:-trgghz$(printf '%s' "$SUBSCRIPTION_ID" | tr -d '-' | cut -c1-12)}}"

# La préparation peut déjà avoir créé une attribution AcrPull pendant la
# préparation. ARM refuserait un doublon portant un autre UUID : on l'adopte au
# lieu de la recréer. Une plateforme neuve conserve le rôle déclaratif Bicep.
CREATE_ACR_PULL_ROLE_ASSIGNMENT=true
if az acr show --name "$ACR_NAME" --resource-group "$RG" --output none 2>/dev/null \
  && az identity show --name "$RUNTIME_IDENTITY" --resource-group "$RG" --output none 2>/dev/null; then
  identity_principal="$(az identity show -g "$RG" -n "$RUNTIME_IDENTITY" --query principalId -o tsv)"
  acr_scope="$(az acr show -g "$RG" -n "$ACR_NAME" --query id -o tsv)"
  role_count="$(az role assignment list --assignee-object-id "$identity_principal" --fill-principal-name false --scope "$acr_scope" --role AcrPull --query 'length(@)' -o tsv)"
  [ "$role_count" = "0" ] || CREATE_ACR_PULL_ROLE_ASSIGNMENT=false
fi

az bicep build --file infra/platform.bicep --stdout >/dev/null

deployment_arguments=(
  --resource-group "$RG"
  --name trg-platform
  --template-file infra/platform.bicep
  --parameters
  location="$LOCATION"
  containerRegistryName="$ACR_NAME"
  containerAppsEnvironmentName="$ENVIRONMENT"
  logAnalyticsWorkspaceName="$LOG_WORKSPACE"
  runtimeIdentityName="$RUNTIME_IDENTITY"
  logRetentionDays="$LOG_RETENTION_DAYS"
  createAcrPullRoleAssignment="$CREATE_ACR_PULL_ROLE_ASSIGNMENT"
)

if [ "$PROVISION_MODE" = "what-if" ]; then
  az deployment group what-if "${deployment_arguments[@]}"
  exit 0
fi

az deployment group create "${deployment_arguments[@]}" --output none

echo "✓ Plateforme Azure provisionnée de façon idempotente"
echo "  resource group : $RG"
echo "  environnement  : $ENVIRONMENT"
echo "  registre       : $ACR_NAME.azurecr.io"
