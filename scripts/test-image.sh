#!/bin/bash
###############################################################################
#
# Project : Tomcat Diagnostic Service
# File    : scripts/test-image.sh
#
# Tujuan
# -------
# Memverifikasi metadata dan runtime-static contract image yang telah dibangun.
# Setiap probe memakai disposable `podman run --rm` tanpa port atau volume.
#
# Pseudocode Alur Eksekusi:
# ------------------------
# 1. Inisialisasi variabel environment dan muat konfigurasi CONFIG & VERSION.
# 2. Periksa metadata image melalui `podman image inspect`:
#    - User adalah 'node' (non-root)
#    - Working directory adalah '/app'
#    - Label versi, base name, dan base image ID sesuai standar immutable
#    - Command startup adalah node src/main.js --config ...
# 3. Jalankan container sementara (`podman run --rm`):
#    - Verifikasi versi Node.js sama persis dengan NODE_VERSION
#    - Verifikasi dependensi produksi npm tanpa devDependencies
# 4. Validasi integritas berkas di dalam container image:
#    - Pastikan berkas esensial (src/main.js, schemas, migrations) tersedia
#    - Pastikan direktori pengujian (test), CONFIG, dan README tidak tersalin
#    - Pastikan tidak ada berkas sensitif (*.key, *.crt, *.pem, *.sqlite*)
#
# Penggunaan
# ----------
# ./scripts/test-image.sh
#
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

# shellcheck source=../CONFIG
source "${PROJECT_ROOT}/CONFIG"
version="$(<"${PROJECT_ROOT}/VERSION")"
image="${IMAGE_NAME}:${version}"

[[ "$(podman image inspect "${image}" --format '{{.Config.User}}')" == "node" ]]
[[ "$(podman image inspect "${image}" --format '{{.Config.WorkingDir}}')" == "/app" ]]
[[ "$(podman image inspect "${image}" --format '{{index .Config.Labels "org.opencontainers.image.version"}}')" == "${version}" ]]
[[ "$(podman image inspect "${image}" --format '{{index .Config.Labels "org.opencontainers.image.base.name"}}')" == "${BASE_IMAGE}" ]]
[[ "$(podman image inspect "${image}" --format '{{index .Config.Labels "io.tomcat-diagnostic.base.image.id"}}')" == "${BASE_IMAGE_ID}" ]]
[[ "$(podman image inspect "${image}" --format '{{json .Config.Cmd}}')" == '["node","src/main.js","--config","/run/tomcat-diagnostic/application.json"]' ]]

podman run --rm "${image}" node --version | grep -Fx "v${NODE_VERSION}"
podman run --rm "${image}" npm ls --omit=dev --depth=0
podman run --rm "${image}" sh -eu -c '
    test "$(id -u)" -ne 0
    test -f src/main.js
    test -f config/schemas/application-config-v1.schema.json
    test -f config/schemas/rulepack-v1.schema.json
    test -f migrations/003-delivery-attempts.sql
    test -f migrations/004-notification-lifecycle.sql
    test -f migrations/005-custom-rules.sql
    test ! -e test
    test ! -e CONFIG
    test ! -e README.md
    ! find /app -type f \( -name "*.key" -o -name "*.crt" -o -name "*.pem" -o -name "*.sqlite*" \) -print -quit | grep -q .
'
