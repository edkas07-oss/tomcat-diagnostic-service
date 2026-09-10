#!/bin/bash
###############################################################################
#
# Project : Tomcat Diagnostic Service
# File    : scripts/validate.sh
#
# Tujuan
# ------
# Memverifikasi governance dan metadata source baseline tanpa memasang
# dependency, mengakses network, membangun image, atau menjalankan container.
#
# Pseudocode Alur Eksekusi:
# ------------------------
# 1. Inisialisasi konstanta path direktori skrip dan root proyek.
# 2. Definisikan fungsi assertion `fail`, `require_command`, dan `require_file`.
# 3. Verifikasi dependensi host wajib: python3 dan rg (ripgrep).
# 4. Verifikasi keberadaan seluruh daftar berkas wajib (required_files).
# 5. Validasi konsistensi identitas proyek, semantic version, engine Node.js, dan base image ID.
# 6. Jalankan skrip embedded Python untuk memvalidasi isi package.json dan package-lock.json.
# 7. Jalankan skrip embedded Python untuk memvalidasi isi Containerfile dan .containerignore.
# 8. Periksa sintaksis seluruh file skrip shell via `bash -n`.
# 9. Jalankan pemindaian regex ripgrep untuk mencegah unapproved dependencies, forbidden imports, dan secret leaks.
#
# Penggunaan
# ---------
# ./scripts/validate.sh
#
# Kontrak
# -------
# Validator memerlukan Bash, Python 3, dan ripgrep lokal. Ia hanya membaca
# working tree dan tidak membuat atau menghapus artifact.
#
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

readonly SCRIPT_DIR PROJECT_ROOT

fail() {
    echo "Validasi gagal: $*" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "command wajib tidak tersedia: $1"
}

require_file() {
    [[ -f "${PROJECT_ROOT}/$1" ]] || fail "file wajib tidak tersedia: $1"
}

require_command python3
require_command rg

required_files=(
    AGENTS.md
    .containerignore
    Containerfile
    LICENSE
    README.md
    PROJECT
    VERSION
    CONFIG
    package.json
    package-lock.json
    config/schemas/alertmanager-webhook-v4.schema.json
    config/schemas/application-config-v1.schema.json
    config/schemas/rulepack-v1.schema.json
    migrations/001-initial.sql
    migrations/002-canonical-results.sql
    migrations/003-delivery-attempts.sql
    migrations/004-notification-lifecycle.sql
    migrations/005-custom-rules.sql
    migrations/006-rule-category.sql
    migrations/007-stale-lock-recovery-and-retention.sql
    src/adapters/application-health-adapter.js
    src/adapters/bounded-file-reader.js
    src/adapters/collector-spool-adapter.js
    src/adapters/local-file-evidence-adapter.js
    src/adapters/prometheus-adapter.js
    src/adapters/sqlite-repository.js
    src/adapters/smtp-adapter.js
    src/application/bounded-queue.js
    src/application/application.js
    src/application/config-loader.js
    src/application/ingest-alertmanager.js
    src/application/diagnostic-worker.js
    src/application/health-metrics.js
    src/application/notification-delivery.js
    src/application/result-renderer.js
    src/application/target-registry.js
    src/domain/evidence.js
    src/domain/canonical-result.js
    src/domain/rulepack-loader.js
    src/domain/tomcat-down-engine.js
    src/domain/application-health-engine.js
    src/domain/jvm-workload-engine.js
    src/domain/concurrency-engine.js
    src/server/webhook-schema.js
    src/server/rulepack-schema.js
    src/server/http-service.js
    src/main.js
    scripts/build.sh
    scripts/test-image.sh
    scripts/test-image-component.sh
    scripts/validate.sh
)

for required_file in "${required_files[@]}"; do
    require_file "${required_file}"
done

# shellcheck source=../CONFIG
source "${PROJECT_ROOT}/CONFIG"

project_name="$(<"${PROJECT_ROOT}/PROJECT")"
project_version="$(<"${PROJECT_ROOT}/VERSION")"

[[ "${project_name}" == "tomcat-diagnostic-service" ]] \
    || fail "PROJECT harus bernilai tomcat-diagnostic-service"
[[ "${project_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || fail "VERSION harus menggunakan semantic version tiga bagian"
[[ "${NODE_VERSION}" == "24.18.0" ]] \
    || fail "NODE_VERSION harus mengikuti accepted baseline 24.18.0"
[[ "${MODULE_TYPE}" == "module" ]] \
    || fail "MODULE_TYPE harus bernilai module"
[[ "${IMAGE_NAME}" == "localhost/tomcat-diagnostic-service" ]] \
    || fail "IMAGE_NAME tidak konsisten dengan project identity"
[[ "${BASE_IMAGE}" == "localhost/nodejs@sha256:76b1444d507be3398f3196f37bd20f7a97a703871ed2716fa91a1a9520fc482d" ]] \
    || fail "BASE_IMAGE harus memakai immutable Node.js digest TN-010"
[[ "${BASE_IMAGE_ID}" == "bccb45bc1e48a07ac6c2cd36f7352bccb555e8b3e6070cbefa727d83d6dee3bc" ]] \
    || fail "BASE_IMAGE_ID tidak konsisten dengan immutable local base"

python3 - "${PROJECT_ROOT}" "${project_name}" "${project_version}" "${NODE_VERSION}" <<'PYTHON'
import json
import pathlib
import sys

project_root = pathlib.Path(sys.argv[1])
expected_name, expected_version, expected_node = sys.argv[2:]
package_json = json.loads((project_root / "package.json").read_text())
package_lock = json.loads((project_root / "package-lock.json").read_text())
root_lock = package_lock.get("packages", {}).get("", {})


def require(condition, message):
    if not condition:
        raise SystemExit(message)


require(package_json.get("name") == expected_name, "package.json name tidak konsisten")
require(package_json.get("version") == expected_version, "package.json version tidak konsisten")
require(package_json.get("private") is True, "package.json harus private")
require(package_json.get("type") == "module", "package.json harus memakai ESM")
require(package_json.get("engines", {}).get("node") == expected_node,
        "package.json Node.js engine tidak konsisten")
require(package_json.get("scripts", {}).get("validate") == "bash scripts/validate.sh",
        "validate script tidak konsisten")
require(package_json.get("scripts", {}).get("start") == "node src/main.js",
        "start script tidak konsisten")
require(package_json.get("scripts", {}).get("test") ==
        "node --test test/unit/*.test.js test/integration/*.test.js",
        "test script tidak konsisten")
require(package_json.get("scripts", {}).get("test:component") ==
        "node --test test/component/*.test.js",
        "component test script tidak konsisten")
require(package_json.get("bin", {}).get("tomcat-diagnostic-service") == "src/main.js",
        "startup entrypoint tidak konsisten")
require(package_json.get("dependencies") == {"ajv": "8.20.0", "nodemailer": "9.0.6"},
        "hanya exact-pinned Ajv dan Nodemailer yang diizinkan")
require(not package_json.get("devDependencies"), "baseline tidak boleh memiliki devDependency")
require(package_lock.get("lockfileVersion") == 3,
        "package-lock.json harus memakai lockfileVersion 3")
require(package_lock.get("name") == expected_name, "package-lock.json name tidak konsisten")
require(package_lock.get("version") == expected_version,
        "package-lock.json version tidak konsisten")
require(root_lock.get("name") == expected_name, "root lock package name tidak konsisten")
require(root_lock.get("version") == expected_version,
        "root lock package version tidak konsisten")
require(root_lock.get("bin", {}).get("tomcat-diagnostic-service") == "src/main.js",
        "root lock startup entrypoint tidak konsisten")
require(root_lock.get("engines", {}).get("node") == expected_node,
        "root lock Node.js engine tidak konsisten")
require(root_lock.get("dependencies") == {"ajv": "8.20.0", "nodemailer": "9.0.6"},
        "root lock dependency tidak konsisten")
PYTHON

python3 - "${PROJECT_ROOT}" "${BASE_IMAGE}" "${BASE_IMAGE_ID}" <<'PYTHON'
import pathlib
import sys

project_root = pathlib.Path(sys.argv[1])
base_image, base_image_id = sys.argv[2:]
containerfile = (project_root / "Containerfile").read_text()
containerignore = (project_root / ".containerignore").read_text().splitlines()


def require(condition, message):
    if not condition:
        raise SystemExit(message)


require(f"ARG BASE_IMAGE={base_image}" in containerfile,
        "Containerfile base digest tidak konsisten")
require("USER node" in containerfile, "Containerfile harus memakai non-root user node")
require('CMD ["node", "src/main.js", "--config", "/run/tomcat-diagnostic/application.json"]' in containerfile,
        "Containerfile startup command tidak konsisten")
require("COPY --chown=node:node src /app/src" in containerfile,
        "Containerfile harus menyalin runtime source sebagai user node")
require("npm ci --omit=dev --ignore-scripts --no-audit --no-fund" in containerfile,
        "Containerfile harus memasang exact locked production dependencies")
for required_pattern in [".git", "test", "node_modules", "*.key", "*.crt", "*.pem", "*.sqlite*"]:
    require(required_pattern in containerignore,
            f".containerignore belum memuat boundary: {required_pattern}")
require(base_image_id in (project_root / "CONFIG").read_text(),
        "CONFIG tidak memuat immutable base image ID")
PYTHON

for shell_script in "${PROJECT_ROOT}"/scripts/*.sh; do
    bash -n "${shell_script}"
done

forbidden_dependencies='"(express|fastify|@nestjs/[^"/]+|sequelize|typeorm|knex|prisma|execa|shelljs)"[[:space:]]*:'
if rg -n --glob 'package*.json' "${forbidden_dependencies}" "${PROJECT_ROOT}"; then
    fail "framework, ORM, atau general-purpose host-control dependency ditemukan"
fi

forbidden_imports='(node:child_process|node:cluster|node:worker_threads|podman|docker\.sock)'
if rg -n --glob '*.js' "${forbidden_imports}" "${PROJECT_ROOT}/src"; then
    fail "host-control atau unapproved concurrency interface ditemukan"
fi

secret_assignment='(password|passwd|secret|token|api[_-]?key|private[_-]?key)[[:space:]]*[:=][[:space:]]*["'"'][^<][^"'"']+["'"']'
if rg -n -i --glob '!AGENTS.md' --glob '!README.md' --glob '!scripts/validate.sh' \
    "${secret_assignment}" "${PROJECT_ROOT}"; then
    fail "kemungkinan secret assignment ditemukan pada source baseline"
fi

echo "Static validation passed: schema, migration, source, and dependency boundaries are consistent."
