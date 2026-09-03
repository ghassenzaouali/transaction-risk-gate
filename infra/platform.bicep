targetScope = 'resourceGroup'

@description('Région Azure commune à la plateforme.')
param location string = resourceGroup().location

@description('Nom globalement unique du registre Azure Container Registry.')
param containerRegistryName string

@description('Nom de l’environnement Azure Container Apps partagé.')
param containerAppsEnvironmentName string

@description('Nom du workspace qui centralise les logs structurés.')
param logAnalyticsWorkspaceName string = 'log-transaction-risk-gate'

@description('Identité utilisée uniquement pour tirer les images privées depuis ACR.')
param runtimeIdentityName string = 'id-transaction-risk-gate-runtime'

@minValue(30)
@maxValue(730)
@description('Rétention des logs de la plateforme en jours.')
param logRetentionDays int = 30

@description('Désactivé uniquement pour adopter une attribution AcrPull déjà préparée.')
param createAcrPullRoleAssignment bool = true

var acrPullRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)

resource logs 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  properties: {
    retentionInDays: logRetentionDays
    sku: {
      name: 'PerGB2018'
    }
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

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

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppsEnvironmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    zoneRedundant: false
  }
}

output registryLoginServer string = registry.properties.loginServer
output containerAppsEnvironmentId string = environment.id
output runtimeIdentityId string = runtimeIdentity.id
output logAnalyticsWorkspaceId string = logs.id
