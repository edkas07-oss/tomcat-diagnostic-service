#!/bin/bash
###############################################################################
#
# Project : Tomcat Diagnostic Service
# File    : scripts/build.sh
#
# Tujuan
# -------
# Membangun versioned dan latest application image dari exact base digest.
# Mendukung penandaan dan dorongan ke Enterprise Container Registry (Harbor/Nexus).
#
# Pseudocode Alur Eksekusi:
# ------------------------
# 1. Inisialisasi path direktori skrip dan direktori root proyek (PROJECT_ROOT).
# 2. Muat variabel konfigurasi statis dari berkas CONFIG.
# 3. Baca nama proyek (PROJECT) dan nomor versi semantik (VERSION).
# 4. Baca parameter lingkungan: REGISTRY_URL / REGISTRY_HOST, REGISTRY_NAMESPACE,
#    REGISTRY_TLS_VERIFY, REGISTRY_AUTH_FILE, IMAGE_TAG, dan PUSH_IMAGE.
# 5. Periksa ketersediaan base image immutable lokal pada runtime Podman/Docker.
# 6. Validasi ID digest base image lokal agar presisi sama dengan BASE_IMAGE_ID.
# 7. Eksekusi build dengan Containerfile, menyematkan tag versi dan :latest.
# 8. Jika PUSH_IMAGE=true, dorong (push) image ke target container registry.
#
# Penggunaan
# ----------
# ./scripts/build.sh
# REGISTRY_URL=harbor.internal REGISTRY_NAMESPACE=monitoring IMAGE_TAG=0.1.8 PUSH_IMAGE=true ./scripts/build.sh
#
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

# shellcheck source=../CONFIG
source "${PROJECT_ROOT}/CONFIG"
source "${SCRIPT_DIR}/container-runtime-helper.sh"

project_name="$(<"${PROJECT_ROOT}/PROJECT")"
project_version="$(<"${PROJECT_ROOT}/VERSION")"

REGISTRY_TARGET="${REGISTRY_URL:-${REGISTRY_HOST:-localhost}}"
REGISTRY_NS="${REGISTRY_NAMESPACE:-}"
REGISTRY_TLS="${REGISTRY_TLS_VERIFY:-true}"
REGISTRY_AUTH="${REGISTRY_AUTH_FILE:-}"
IMAGE_TAG="${IMAGE_TAG:-${project_version}}"
PUSH_IMAGE="${PUSH_IMAGE:-false}"

if [[ -n "${REGISTRY_NS}" ]]; then
    TARGET_IMAGE="${REGISTRY_TARGET}/${REGISTRY_NS}/${project_name}:${IMAGE_TAG}"
    LATEST_IMAGE="${REGISTRY_TARGET}/${REGISTRY_NS}/${project_name}:latest"
else
    TARGET_IMAGE="${REGISTRY_TARGET}/${project_name}:${IMAGE_TAG}"
    LATEST_IMAGE="${REGISTRY_TARGET}/${project_name}:latest"
fi

image_exists "${BASE_IMAGE}" \
    || { echo "Base image immutable tidak tersedia: ${BASE_IMAGE}" >&2; exit 1; }

actual_base_id="$("${CONTAINER_ENGINE}" image inspect "${BASE_IMAGE}" --format '{{.Id}}')"
[[ "${actual_base_id}" == "${BASE_IMAGE_ID}" ]] \
    || { echo "Base image ID tidak cocok dengan CONFIG" >&2; exit 1; }

"${CONTAINER_ENGINE}" build \
    --file "${PROJECT_ROOT}/Containerfile" \
    --tag "${TARGET_IMAGE}" \
    --tag "${LATEST_IMAGE}" \
    --build-arg "BASE_IMAGE=${BASE_IMAGE}" \
    --build-arg "BASE_IMAGE_ID=${BASE_IMAGE_ID}" \
    --build-arg "IMAGE_PROJECT=${project_name}" \
    --build-arg "IMAGE_VERSION=${project_version}" \
    "${PROJECT_ROOT}"

if [[ "${PUSH_IMAGE}" == "true" ]]; then
    echo "Mendorong image ke container registry: ${TARGET_IMAGE} & ${LATEST_IMAGE}"
    push_opts=()
    if [[ "${CONTAINER_ENGINE}" == "podman" ]]; then
        if [[ "${REGISTRY_TLS}" == "false" ]]; then
            push_opts+=(--tls-verify=false)
        elif [[ "${REGISTRY_TLS}" != "true" && -f "${REGISTRY_TLS}" ]]; then
            push_opts+=(--cert-dir="$(dirname "${REGISTRY_TLS}")")
        fi
        if [[ -n "${REGISTRY_AUTH}" && -f "${REGISTRY_AUTH}" ]]; then
            push_opts+=(--authfile="${REGISTRY_AUTH}")
        fi
    fi
    "${CONTAINER_ENGINE}" push "${push_opts[@]}" "${TARGET_IMAGE}"
    "${CONTAINER_ENGINE}" push "${push_opts[@]}" "${LATEST_IMAGE}"
fi
