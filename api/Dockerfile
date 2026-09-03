# syntax=docker/dockerfile:1

# --- étape build : TypeScript -> JavaScript -------------------------------
# npm ci installe TOUTES les dépendances (tsx, typescript) ; cette étape est
# jetée, rien de tout ça n'atteint l'image finale.
FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS build
ARG VCS_REF=local
ARG VERSION=dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# --- étape runtime : l'image de production -------------------------------
FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS runtime
ARG VCS_REF=local
ARG VERSION=dev
ENV NODE_ENV=production
WORKDIR /app

LABEL org.opencontainers.image.title="Transaction Risk Gate API" \
      org.opencontainers.image.source="https://github.com/ghassenzaouali/transaction-risk-gate" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.version="$VERSION"

# Applique les correctifs de sécurité Alpine publiés après la création de
# l’image de base ; Trivy bloque ensuite toute vulnérabilité fixable résiduelle.
RUN apk upgrade --no-cache

# Seulement les dépendances de production, réinstallées à froid. Les manifests,
# npm et Corepack sont supprimés ensuite : ils ne sont pas nécessaires pour
# exécuter le JavaScript compilé et ne doivent pas agrandir la surface d’attaque.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && rm -f package.json package-lock.json /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack

# Le JavaScript compilé, sans les *.test.js (exclus par tsconfig.build.json).
COPY --from=build /app/dist ./dist

# Utilisateur non-root fourni par l'image (uid 1000).
USER node

EXPOSE 3000

# `node` directement, pas `npm start` : npm ne relaie pas SIGTERM à son enfant,
# ce qui casserait l'arrêt gracieux (registerGracefulShutdown, brique 1).
CMD ["node", "dist/server.js"]
