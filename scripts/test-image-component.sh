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
# Pseudocode Alur Eksekusi:
# ------------------------
# 1. Validasi argumen direktori komponen (harus path absolut dan direktori ada).
# 2. Muat konfigurasi statis CONFIG dan nomor versi VERSION.
# 3. Definisikan fungsi cleanup_container dengan trap EXIT untuk menjamin pembersihan resource.
# 4. Generate konfigurasi fixture runtime via `test/component/image-runtime-fixture.js`.
# 5. Jalankan container aplikasi secara background (detached) dengan volume runtime dan port mapping.
# 6. Dapatkan port HTTPS dinamis pada host.
# 7. Jalankan probe pengujian HTTPS via `test/component/image-runtime-probe.js`.
# 8. Hentikan container dengan graceful shutdown (SIGTERM via `podman stop --time 5`).
# 9. Verifikasi exit code container adalah 0 (shutdown bersih).
# 10. Jalankan probe verifikasi database SQLite via `test/component/image-runtime-database-probe.js`.
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
source "${SCRIPT_DIR}/container-runtime-helper.sh"
version="$(<"${PROJECT_ROOT}/VERSION")"
image="${IMAGE_NAME}:${version}"
container_name="tomcat-diagnostic-tn010-component"

cleanup_container() {
    if container_exists "${container_name}"; then
        "${CONTAINER_ENGINE}" rm --force "${container_name}" >/dev/null
    fi
}
trap cleanup_container EXIT

container_exists "${container_name}" \
    && { echo "Container target sudah ada: ${container_name}" >&2; exit 1; }

userns_flag="$(get_userns_flag)"
vol_ro_z="$(get_volume_flag "ro,Z")"
vol_z="$(get_volume_flag "Z")"

run_base_args=()
if [[ -n "${userns_flag}" ]]; then
    run_base_args+=("${userns_flag}")
fi

"${CONTAINER_ENGINE}" run --rm \
    "${run_base_args[@]}" \
    --volume "${PROJECT_ROOT}:/app${vol_ro_z}" \
    --volume "${component_directory}:/runtime${vol_z}" \
    --workdir /app \
    localhost/nodejs:24.18.0 \
    node test/component/image-runtime-fixture.js /runtime

"${CONTAINER_ENGINE}" run --detach \
    "${run_base_args[@]}" \
    --name "${container_name}" \
    --publish 127.0.0.1::8443 \
    --volume "${component_directory}:/run/tomcat-diagnostic${vol_z}" \
    "${image}" >/dev/null

host_port="$("${CONTAINER_ENGINE}" port "${container_name}" 8443/tcp | sed -n '1s/.*://p')"
[[ "${host_port}" =~ ^[0-9]+$ ]]

"${CONTAINER_ENGINE}" run --rm \
    "${run_base_args[@]}" \
    --network host \
    --volume "${PROJECT_ROOT}:/app${vol_ro_z}" \
    --volume "${component_directory}:/runtime${vol_ro_z}" \
    --workdir /app \
    --env "TN010_HTTPS_PORT=${host_port}" \
    localhost/nodejs:24.18.0 \
    node test/component/image-runtime-probe.js /runtime/server.crt

"${CONTAINER_ENGINE}" stop --time 5 "${container_name}" >/dev/null
[[ "$("${CONTAINER_ENGINE}" inspect "${container_name}" --format '{{.State.ExitCode}}')" == "0" ]]

"${CONTAINER_ENGINE}" run --rm \
    "${run_base_args[@]}" \
    --volume "${PROJECT_ROOT}:/app${vol_ro_z}" \
    --volume "${component_directory}:/runtime${vol_z}" \
    --workdir /app \
    localhost/nodejs:24.18.0 \
    node test/component/image-runtime-database-probe.js /runtime/diagnostic.sqlite

