#!/bin/bash
###############################################################################
#
# Project : Tomcat Diagnostic Service
# File    : scripts/build.sh
#
# Tujuan
# -------
# Membangun versioned dan latest application image dari exact base digest.
# Script tidak menarik image, menjalankan container, atau menghapus artifact.
#
# Penggunaan
# ----------
# ./scripts/build.sh
#
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

# shellcheck source=../CONFIG
source "${PROJECT_ROOT}/CONFIG"

project_name="$(<"${PROJECT_ROOT}/PROJECT")"
project_version="$(<"${PROJECT_ROOT}/VERSION")"

podman image exists "${BASE_IMAGE}" \
    || { echo "Base image immutable tidak tersedia: ${BASE_IMAGE}" >&2; exit 1; }

actual_base_id="$(podman image inspect "${BASE_IMAGE}" --format '{{.Id}}')"
[[ "${actual_base_id}" == "${BASE_IMAGE_ID}" ]] \
    || { echo "Base image ID tidak cocok dengan CONFIG" >&2; exit 1; }

podman build \
    --file "${PROJECT_ROOT}/Containerfile" \
    --tag "${IMAGE_NAME}:${project_version}" \
    --tag "${IMAGE_NAME}:latest" \
    --build-arg "BASE_IMAGE=${BASE_IMAGE}" \
    --build-arg "BASE_IMAGE_ID=${BASE_IMAGE_ID}" \
    --build-arg "IMAGE_PROJECT=${project_name}" \
    --build-arg "IMAGE_VERSION=${project_version}" \
    "${PROJECT_ROOT}"
