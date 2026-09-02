###############################################################################
#
# Project : Tomcat Diagnostic Service
# File    : Containerfile
#
# Tujuan
# -------
# Membentuk OCI application image dari immutable local Node.js runtime. Image
# hanya membawa production dependency, runtime source, schema, dan migration;
# configuration serta secret tetap diberikan melalui mounted files.
#
###############################################################################
ARG BASE_IMAGE=localhost/nodejs@sha256:76b1444d507be3398f3196f37bd20f7a97a703871ed2716fa91a1a9520fc482d
FROM ${BASE_IMAGE}

# ARG sebelum FROM hanya tersedia untuk pemilihan base. Deklarasi ulang membuat
# exact reference tersedia bagi OCI label pada build stage yang sama.
ARG BASE_IMAGE
ARG IMAGE_PROJECT=tomcat-diagnostic-service
ARG IMAGE_VERSION=0.1.1
ARG BASE_IMAGE_ID

ENV NODE_ENV=production

LABEL org.opencontainers.image.title="${IMAGE_PROJECT}" \
      org.opencontainers.image.description="Bounded Tomcat Diagnostic Service" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.base.name="${BASE_IMAGE}" \
      io.tomcat-diagnostic.base.image.id="${BASE_IMAGE_ID}"

COPY --chown=node:node package.json package-lock.json /app/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

COPY --chown=node:node src /app/src
COPY --chown=node:node config /app/config
COPY --chown=node:node migrations /app/migrations

USER node
EXPOSE 8443

CMD ["node", "src/main.js", "--config", "/run/tomcat-diagnostic/application.json"]
