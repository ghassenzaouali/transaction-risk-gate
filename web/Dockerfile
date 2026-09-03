# syntax=docker/dockerfile:1

# Pas d'étape de build : le HTML, le CSS et les modules ES sont déjà l'artefact.
# Cette variante officielle Nginx écoute sans privilège ; son digest multi-arch
# rend la base reproductible sur le poste et dans GitHub Actions.
FROM nginxinc/nginx-unprivileged:1.31.4-alpine@sha256:d9083fe47768377ef55dedafd67d4da7c2f2bc2bece7554954f29359deb0dce9

ARG VCS_REF=local
ARG VERSION=dev

LABEL org.opencontainers.image.title="Transaction Risk Gate Web" \
      org.opencontainers.image.source="https://github.com/ghassenzaouali/transaction-risk-gate" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.version="$VERSION"

# Applique les correctifs de sécurité Alpine avant le scan de l’image finale.
USER root
RUN apk upgrade --no-cache

# nginx.conf.template est un gabarit. L'entrypoint de l'image lance envsubst au
# démarrage ; on l'oriente vers /etc/nginx pour qu'il produise nginx.conf lui-même
# (le gabarit est une configuration complète, pas un fragment de conf.d).
ENV NGINX_ENVSUBST_OUTPUT_DIR=/tmp

# Borne la substitution à nos trois variables. Sans ça, envsubst viderait aussi
# $host, $uri… — les variables propres de nginx.
ENV NGINX_ENVSUBST_FILTER="^(API_KEY|API_UPSTREAM|API_UPSTREAM_SCHEME)$"

COPY nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY index.html style.css app.mjs replica-tracker.mjs transaction-simulator.mjs /usr/share/nginx/html/

USER 101:101

EXPOSE 8080

CMD ["nginx", "-c", "/tmp/nginx.conf", "-g", "daemon off;"]
