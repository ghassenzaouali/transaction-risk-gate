targetScope = 'resourceGroup'

@description('Région Azure commune à la plateforme.')
param location string = resourceGroup().location

@description('Nom globalement unique du registre Azure Container Registry.')
param containerRegistryName string

@description('''
ID complet de l'environnement Azure Container Apps partagé. L'abonnement « Azure for Students »
n'autorise qu'un seul environnement par région ; il est donc mutualisé et seulement référencé ici.
''')
param sharedContainerAppsEnvironmentId string

@description('Identité utilisée uniquement pour tirer les images privées depuis ACR.')
param runtimeIdentityName string = 'id-transaction-risk-gate-runtime'

@description('Désactivé uniquement pour adopter une attribution AcrPull déjà préparée.')
param createAcrPullRoleAssignment bool = true

var acrPullRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: containerRegistryName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
    dataEndpointEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource runtimeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: runtimeIdentityName
  location: location
}

resource runtimeAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (createAcrPullRoleAssignment) {
  name: guid(registry.id, runtimeIdentity.id, acrPullRoleDefinitionId)
  scope: registry
  properties: {
    principalId: runtimeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRoleDefinitionId
  }
}

output registryLoginServer string = registry.properties.loginServer
output containerAppsEnvironmentId string = sharedContainerAppsEnvironmentId
output runtimeIdentityId string = runtimeIdentity.id
