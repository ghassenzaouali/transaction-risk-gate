targetScope = 'resourceGroup'

@allowed([
  'integration'
  'preproduction'
  'production'
])
@description('Environnement logique associé à la branche Git durable.')
param stage string

@description('ID complet de l’environnement Azure Container Apps partagé (mutualisé, cross-RG).')
param containerAppsEnvironmentId string

@description('Nom du registre ACR existant.')
param containerRegistryName string

@description('Nom de l’identité disposant uniquement du rôle AcrPull.')
param runtimeIdentityName string = 'id-transaction-risk-gate-runtime'

@description('Nom de base de l’API ; un suffixe est ajouté hors production.')
param apiBaseName string = 'api'

@description('Nom de base du web ; un suffixe est ajouté hors production.')
param webBaseName string = 'web'

@description('Nom de base de Redis ; un suffixe est ajouté hors production.')
param redisBaseName string = 'redis'

@description('Image API complète et immuable : registre/dépôt@sha256:digest.')
param apiImage string

@description('Image web complète et immuable : registre/dépôt@sha256:digest.')
param webImage string

@description('SHA Git ou version SemVer injecté dans les logs et labels OCI.')
param appVersion string

@secure()
@minLength(32)
@maxLength(256)
@description('Secret interservice partagé entre Nginx et l’API.')
param apiKey string

@secure()
@minLength(32)
@maxLength(256)
@description('Secret HMAC qui pseudonymise les identifiants avant Redis.')
param redisHmacSecret string

@secure()
@minLength(32)
@maxLength(256)
@description('Mot de passe Redis, idéalement 64 caractères hexadécimaux.')
param redisPassword string

@secure()
@description('Token de charge hors production ; vide en production.')
param loadTestToken string = ''

@minValue(1)
@maxValue(1000000000)
param amountThreshold int = 1000

@minValue(1)
@maxValue(10000)
param velocityMax int = 3

@minValue(1)
@maxValue(3600)
param velocityWindowSeconds int = 60

param allowedCountries string = 'FR,DE,ES,IT,BE'
param highRiskMerchantCategories string = 'gambling,crypto,jewelry,money_transfer'

var suffix = stage == 'production' ? '' : '-${stage}'
var apiName = '${apiBaseName}${suffix}'
var webName = '${webBaseName}${suffix}'
var redisName = '${redisBaseName}${suffix}'
var redisImage = 'docker.io/library/redis:8.10.1-alpine3.23@sha256:becdda6c7f4b3fb42e42fd7f120bbf5c54c4caaaf16f26da24e4563d2c1f0576'
var redisUrl = 'redis://:${redisPassword}@${redisName}:6379'
var runtimeIdentityId = resourceId(
  'Microsoft.ManagedIdentity/userAssignedIdentities',
  runtimeIdentityName
)
var registryLoginServer = '${containerRegistryName}.azurecr.io'
var nonProductionSecrets = stage == 'production'
  ? []
  : [
      {
        name: 'load-test-token'
        value: loadTestToken
      }
    ]
var nonProductionEnvironment = stage == 'production'
  ? []
  : [
      {
        name: 'LOAD_TEST_TOKEN'
        secretRef: 'load-test-token'
      }
      {
        // Le profil privilégié doit mesurer la capacité, pas la limite publique.
        // Il reste inaccessible sans le secret propre à l'environnement.
        name: 'RATE_LIMIT_LOAD_MAX'
        value: '1000000'
      }
    ]

resource redis 'Microsoft.App/containerApps@2024-03-01' = {
  name: redisName
  location: resourceGroup().location
  properties: {
    managedEnvironmentId: containerAppsEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        exposedPort: 6379
        targetPort: 6379
        transport: 'tcp'
      }
      secrets: [
        {
          name: 'redis-password'
          value: redisPassword
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'redis'
          image: redisImage
          command: [
            '/bin/sh'
          ]
          args: [
            '-c'
            'umask 077; printf "save \\"\\"\\nappendonly no\\nrequirepass %s\\n" "$REDIS_PASSWORD" > /tmp/redis.conf; chown redis:redis /tmp/redis.conf; unset REDIS_PASSWORD; exec /usr/local/bin/docker-entrypoint.sh redis-server /tmp/redis.conf'
          ]
          env: [
            {
              name: 'REDIS_PASSWORD'
              secretRef: 'redis-password'
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          probes: [
            {
              type: 'Liveness'
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 3
              tcpSocket: {
                port: 6379
              }
            }
            {
              type: 'Readiness'
              initialDelaySeconds: 2
              periodSeconds: 5
              timeoutSeconds: 3
              failureThreshold: 3
              tcpSocket: {
                port: 6379
              }
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiName
  location: resourceGroup().location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironmentId
    configuration: {
      activeRevisionsMode: 'Multiple'
      maxInactiveRevisions: 5
      ingress: {
        external: false
        allowInsecure: false
        targetPort: 3000
        transport: 'auto'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: registryLoginServer
          identity: runtimeIdentityId
        }
      ]
      secrets: concat([
        {
          name: 'api-key'
          value: apiKey
        }
        {
          name: 'redis-url'
          value: redisUrl
        }
        {
          name: 'redis-hmac-secret'
          value: redisHmacSecret
        }
      ], nonProductionSecrets)
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          env: concat([
            {
              name: 'APP_ENVIRONMENT'
              value: stage
            }
            {
              name: 'APP_VERSION'
              value: appVersion
            }
            {
              name: 'API_KEY'
              secretRef: 'api-key'
            }
            {
              name: 'REDIS_URL'
              secretRef: 'redis-url'
            }
            {
              name: 'REDIS_HMAC_SECRET'
              secretRef: 'redis-hmac-secret'
            }
            {
              name: 'AMOUNT_THRESHOLD'
              value: string(amountThreshold)
            }
            {
              name: 'VELOCITY_MAX'
              value: string(velocityMax)
            }
            {
              name: 'VELOCITY_WINDOW_SECONDS'
              value: string(velocityWindowSeconds)
            }
            {
              name: 'ALLOWED_COUNTRIES'
              value: allowedCountries
            }
            {
              name: 'HIGH_RISK_MERCHANT_CATEGORIES'
              value: highRiskMerchantCategories
            }
            {
              name: 'TRUST_PROXY_HOPS'
              value: '1'
            }
            {
              name: 'SHUTDOWN_DELAY_MS'
              value: '5000'
            }
            {
              name: 'SHUTDOWN_TIMEOUT_MS'
              value: '10000'
            }
          ], nonProductionEnvironment)
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          probes: [
            {
              type: 'Liveness'
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 3
              httpGet: {
                path: '/health'
                port: 3000
                scheme: 'HTTP'
              }
            }
            {
              type: 'Readiness'
              initialDelaySeconds: 3
              periodSeconds: 5
              timeoutSeconds: 3
              failureThreshold: 3
              httpGet: {
                path: '/ready'
                port: 3000
                scheme: 'HTTP'
              }
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 10
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
      terminationGracePeriodSeconds: 30
    }
  }
  dependsOn: [
    redis
  ]
}

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: webName
  location: resourceGroup().location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironmentId
    configuration: {
      activeRevisionsMode: 'Multiple'
      maxInactiveRevisions: 5
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 8080
        transport: 'auto'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: registryLoginServer
          identity: runtimeIdentityId
        }
      ]
      secrets: [
        {
          name: 'api-key'
          value: apiKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          env: [
            {
              name: 'APP_VERSION'
              value: appVersion
            }
            {
              name: 'API_KEY'
              secretRef: 'api-key'
            }
            {
              name: 'API_UPSTREAM'
              value: api.properties.configuration.ingress.fqdn
            }
            {
              name: 'API_UPSTREAM_SCHEME'
              value: 'https'
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          probes: [
            {
              type: 'Liveness'
              initialDelaySeconds: 3
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 3
              httpGet: {
                path: '/healthz'
                port: 8080
                scheme: 'HTTP'
              }
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
      terminationGracePeriodSeconds: 30
    }
  }
}

output stageName string = stage
output apiName string = api.name
output redisName string = redis.name
output webName string = web.name
output publicBaseUrl string = 'https://${web.properties.configuration.ingress.fqdn}'
