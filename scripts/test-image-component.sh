#!/bin/bash
###############################################################################
#
# Project : Tomcat Diagnostic Service
# File    : scripts/test-image-component.sh
#
# Tujuan
# -------
# Menjalankan disposable image-level HTTPS, SQLite, dan SIGTERM verification.
# Caller menyediakan exact temporary directory yang sudah berisi certificate;
# script membuat fixture non-secret, container exact, dan selalu menghapus
# container tersebut. Directory tetap dimiliki caller untuk evidence/cleanup.
#
# Penggunaan
# ----------
# ./scripts/test-image-component.sh /tmp/tomcat-diagnostic-tn010-component
#
###############################################################################
set -euo pipefail

[[ "$#" -eq 1 ]] || { echo "Usage: $0 <absolute-component-directory>" >&2; exit 2; }
component_directory="$1"
[[ "${component_directory}" == /* && -d "${component_directory}" ]] \
    || { echo "Component directory harus absolute dan tersedia" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
# shellcheck source=../CONFIG
source "${PROJECT_ROOT}/CONFIG"
version="$(<"${PROJECT_ROOT}/VERSION")"
image="${IMAGE_NAME}:${version}"
container_name="tomcat-diagnostic-tn010-component"

cleanup_container() {
    if podman container exists "${container_name}"; then
        podman rm --force "${container_name}" >/dev/null
    fi
}
trap cleanup_container EXIT

podman container exists "${container_name}" \
    && { echo "Container target sudah ada: ${container_name}" >&2; exit 1; }

podman run --rm \
    --userns=keep-id \
    --volume "${PROJECT_ROOT}:/app:ro,Z" \
    --volume "${component_directory}:/runtime:Z" \
    --workdir /app \
    localhost/nodejs:24.18.0 \
    node test/component/image-runtime-fixture.js /runtime

podman run --detach \
    --userns=keep-id \
    --name "${container_name}" \
    --publish 127.0.0.1::8443 \
    --volume "${component_directory}:/run/tomcat-diagnostic:Z" \
    "${image}" >/dev/null

host_port="$(podman port "${container_name}" 8443/tcp | sed -n '1s/.*://p')"
[[ "${host_port}" =~ ^[0-9]+$ ]]

podman run --rm \
    --userns=keep-id \
    --network host \
    --volume "${PROJECT_ROOT}:/app:ro,Z" \
    --volume "${component_directory}:/runtime:ro,Z" \
    --workdir /app \
    --env "TN010_HTTPS_PORT=${host_port}" \
    localhost/nodejs:24.18.0 \
    node test/component/image-runtime-probe.js /runtime/server.crt

podman stop --time 5 "${container_name}" >/dev/null
[[ "$(podman inspect "${container_name}" --format '{{.State.ExitCode}}')" == "0" ]]

podman run --rm \
    --userns=keep-id \
    --volume "${PROJECT_ROOT}:/app:ro,Z" \
    --volume "${component_directory}:/runtime:Z" \
    --workdir /app \
    localhost/nodejs:24.18.0 \
    node test/component/image-runtime-database-probe.js /runtime/diagnostic.sqlite
