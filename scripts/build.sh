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
# Pseudocode Alur Eksekusi:
# ------------------------
# 1. Inisialisasi path direktori skrip dan direktori root proyek (PROJECT_ROOT).
# 2. Muat variabel konfigurasi statis dari berkas CONFIG.
# 3. Baca nama proyek (PROJECT) dan nomor versi semantik (VERSION).
# 4. Baca parameter lingkungan: REGISTRY_HOST, IMAGE_TAG, dan PUSH_IMAGE.
# 5. Periksa ketersediaan base image immutable lokal pada runtime Podman.
# 6. Validasi ID digest base image lokal agar presisi sama dengan BASE_IMAGE_ID.
# 7. Eksekusi `podman build` dengan Containerfile, menyematkan tag versi dan :latest.
# 8. Jika PUSH_IMAGE=true, dorong (push) image ke target container registry.
#
# Penggunaan
# ----------
# ./scripts/build.sh
# REGISTRY_HOST=harbor.internal IMAGE_TAG=0.1.8 PUSH_IMAGE=true ./scripts/build.sh
#
# Batasan & Kontrak
# -----------------
# - Mengharuskan Podman lokal terpasang.
# - Tidak melakukan penarikan remote image saat build (network-free build contract).
#
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

# shellcheck source=../CONFIG
source "${PROJECT_ROOT}/CONFIG"

project_name="$(<"${PROJECT_ROOT}/PROJECT")"
project_version="$(<"${PROJECT_ROOT}/VERSION")"

REGISTRY_HOST="${REGISTRY_HOST:-localhost}"
IMAGE_TAG="${IMAGE_TAG:-${project_version}}"
PUSH_IMAGE="${PUSH_IMAGE:-false}"

TARGET_IMAGE="${REGISTRY_HOST}/${project_name}:${IMAGE_TAG}"
LATEST_IMAGE="${REGISTRY_HOST}/${project_name}:latest"

podman image exists "${BASE_IMAGE}" \
    || { echo "Base image immutable tidak tersedia: ${BASE_IMAGE}" >&2; exit 1; }

actual_base_id="$(podman image inspect "${BASE_IMAGE}" --format '{{.Id}}')"
[[ "${actual_base_id}" == "${BASE_IMAGE_ID}" ]] \
    || { echo "Base image ID tidak cocok dengan CONFIG" >&2; exit 1; }

podman build \
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
    podman push "${TARGET_IMAGE}"
    podman push "${LATEST_IMAGE}"
fi
