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
    README.md
    PROJECT
    VERSION
    CONFIG
    package.json
    package-lock.json
    config/schemas/alertmanager-webhook-v4.schema.json
    migrations/001-initial.sql
    src/adapters/application-health-adapter.js
    src/adapters/bounded-file-reader.js
    src/adapters/collector-spool-adapter.js
    src/adapters/local-file-evidence-adapter.js
    src/adapters/prometheus-adapter.js
    src/adapters/sqlite-repository.js
    src/application/bounded-queue.js
    src/application/ingest-alertmanager.js
    src/application/target-registry.js
    src/domain/evidence.js
    src/domain/tomcat-down-engine.js
    src/server/webhook-schema.js
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
[[ "${BASE_IMAGE}" == "localhost/nodejs:${NODE_VERSION}" ]] \
    || fail "BASE_IMAGE harus mengikuti exact accepted Node.js version"

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
require(package_json.get("scripts", {}).get("test") ==
        "node --test test/unit/*.test.js test/integration/*.test.js",
        "test script tidak konsisten")
require(package_json.get("dependencies") == {"ajv": "8.20.0"},
        "hanya exact-pinned Ajv 8.20.0 yang diizinkan")
require(not package_json.get("devDependencies"), "baseline tidak boleh memiliki devDependency")
require(package_lock.get("lockfileVersion") == 3,
        "package-lock.json harus memakai lockfileVersion 3")
require(package_lock.get("name") == expected_name, "package-lock.json name tidak konsisten")
require(package_lock.get("version") == expected_version,
        "package-lock.json version tidak konsisten")
require(root_lock.get("name") == expected_name, "root lock package name tidak konsisten")
require(root_lock.get("version") == expected_version,
        "root lock package version tidak konsisten")
require(root_lock.get("engines", {}).get("node") == expected_node,
        "root lock Node.js engine tidak konsisten")
require(root_lock.get("dependencies") == {"ajv": "8.20.0"},
        "root lock dependency tidak konsisten")
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
