#!/usr/bin/env bash
# Bootstrap administrateur, à exécuter une fois hors de la fenêtre de code.
# Il fédère les trois GitHub Environments avec une identité managée dédiée au dépôt
# et lui attribue Owner sur le seul groupe de ressources, jamais sur l'abonnement.

set -euo pipefail

command -v az >/dev/null 2>&1 || PATH="$PATH:/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin"
command -v az >/dev/null 2>&1 || { echo "Azure CLI (az) est requis." >&2; exit 1; }
export MSYS_NO_PATHCONV=1

LOCATION="${AZURE_LOCATION:-${LOCATION:-swedencentral}}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-ghassenzaouali/transaction-risk-gate}"
GITHUB_ORGANIZATION_ID="${GITHUB_ORGANIZATION_ID:-139699856}"
GITHUB_REPOSITORY_ID="${GITHUB_REPOSITORY_ID:-1352445451}"
RG="${AZURE_RESOURCE_GROUP:-${RG:-rg-transaction-risk-gate}}"
IDENTITY_NAME="${AZURE_GITHUB_IDENTITY_NAME:-id-transaction-risk-gate-github-oidc}"

[[ "$GITHUB_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  echo "GITHUB_REPOSITORY invalide." >&2
  exit 1
}

[[ "$GITHUB_ORGANIZATION_ID" =~ ^[0-9]+$ && "$GITHUB_REPOSITORY_ID" =~ ^[0-9]+$ ]] || {
  echo "Les identifiants GitHub immuables doivent être numériques." >&2
  exit 1
}

az group show --name "$RG" --output none 2>/dev/null ||
  az group create --name "$RG" --location "$LOCATION" --output none

az identity show --resource-group "$RG" --name "$IDENTITY_NAME" --output none 2>/dev/null ||
  az identity create --resource-group "$RG" --name "$IDENTITY_NAME" --location "$LOCATION" --output none

AZURE_CLIENT_ID="$(az identity show -g "$RG" -n "$IDENTITY_NAME" --query clientId -o tsv)"
SERVICE_PRINCIPAL_ID="$(az identity show -g "$RG" -n "$IDENTITY_NAME" --query principalId -o tsv)"
owner="${GITHUB_REPOSITORY%%/*}"
repository="${GITHUB_REPOSITORY#*/}"
subject_prefix="repo:${owner}@${GITHUB_ORGANIZATION_ID}/${repository}@${GITHUB_REPOSITORY_ID}:environment:"

for stage in integration preproduction production; do
  credential_name="github-$stage"
  expected_subject="${subject_prefix}${stage}"
  current_subject="$(az identity federated-credential list -g "$RG" --identity-name "$IDENTITY_NAME" --query "[?name=='$credential_name'] | [0].subject" -o tsv)"
  if [ -z "$current_subject" ]; then
    az identity federated-credential create \
      --resource-group "$RG" \
      --identity-name "$IDENTITY_NAME" \
      --name "$credential_name" \
      --issuer "https://token.actions.githubusercontent.com" \
      --subject "$expected_subject" \
      --audiences "api://AzureADTokenExchange" \
      --output none
  elif [ "$current_subject" != "$expected_subject" ]; then
    echo "$credential_name existe avec un sujet inattendu : $current_subject" >&2
    exit 1
  fi
  echo "✓ Fédération OIDC : $stage"
done

# Owner sur le seul groupe de ressources : le pipeline provisionne la plateforme
# (ACR, Log Analytics, environnement Container Apps) et crée l'attribution AcrPull
# de l'identité runtime, ce qui exige la gestion des attributions de rôle à ce
# périmètre. En production, RBAC Administrator avec une condition limitant les
# rôles assignables à AcrPull remplacerait Owner.
RG_ID="$(az group show --name "$RG" --query id -o tsv)"
existing="$(az role assignment list --assignee-object-id "$SERVICE_PRINCIPAL_ID" --fill-principal-name false --scope "$RG_ID" --role Owner --query 'length(@)' -o tsv)"
if [ "$existing" = "0" ]; then
  az role assignment create \
    --assignee-object-id "$SERVICE_PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role Owner --scope "$RG_ID" --output none
fi

echo "✓ OIDC prêt sans client secret permanent"
echo "  identité : $IDENTITY_NAME"
echo "  client id : $AZURE_CLIENT_ID"
