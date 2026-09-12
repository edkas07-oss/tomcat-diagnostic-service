pipeline {

    /**************************************************************************
     * Build Agent
     *
     * Seluruh proses CI dijalankan pada Jenkins Dedicated Agent dengan label
     * "builder" menggunakan Rootless Podman socket (DooD pattern).
     **************************************************************************/

    agent {
        label 'builder'
    }

    /**************************************************************************
     * Parameterized Pipeline
     *
     * Mendukung portabilitas deployment ke Local Podman storage maupun
     * Enterprise Container Registry internal (Harbor / Nexus) sesuai
     * 6 Pilar Kesiapan Produksi Enterprise.
     **************************************************************************/

    parameters {
        string(
            name: 'REGISTRY_HOST',
            defaultValue: 'localhost',
            description: 'Enterprise Container Registry host (e.g. localhost, harbor.internal, nexus.internal:8443)'
        )
        string(
            name: 'IMAGE_TAG',
            defaultValue: '',
            description: 'Custom OCI Image Tag (kosongkan untuk menggunakan versi semantik pada berkas VERSION)'
        )
        booleanParam(
            name: 'PUSH_IMAGE',
            defaultValue: false,
            description: 'Mendorong (push) OCI image yang telah dibangun ke Enterprise Container Registry'
        )
    }

    /**************************************************************************
     * Environment Variables
     **************************************************************************/

    environment {
        PROJECT_NAME = 'tomcat-diagnostic-service'
        NODE_RUNNER_IMAGE = 'localhost/nodejs:24.18.0'
    }

    stages {

        /**********************************************************************
         * Stage 1: Checkout Source Code
         **********************************************************************/

        stage('Checkout Source Code') {
            steps {
                checkout scm

                sh '''
                    set -euo pipefail
                    echo "========================================"
                    echo "STAGE 1: CHECKOUT SOURCE CODE"
                    echo "========================================"
                    echo "Branch   : ${GIT_BRANCH:-HEAD}"
                    echo "Commit   : ${GIT_COMMIT:-unknown}"
                    echo "Workspace: ${WORKSPACE}"
                    test -f package.json
                    test -f VERSION
                    test -f CONFIG
                    test -f Containerfile
                '''
            }
        }

        /**********************************************************************
         * Stage 2: Verify Build Agent Environment
         **********************************************************************/

        stage('Verify Build Agent') {
            steps {
                sh '''
                    set -euo pipefail
                    echo "========================================"
                    echo "STAGE 2: VERIFY BUILD AGENT"
                    echo "========================================"
                    echo "Hostname : $(hostname)"
                    echo "User     : $(whoami)"
                    echo "Podman   : $(podman --version)"

                    # Verifikasi mode rootless Podman pada agent
                    is_rootless="$(podman info --format '{{.Host.Security.Rootless}}')"
                    echo "Rootless : ${is_rootless}"
                    test "${is_rootless}" = 'true'
                '''
            }
        }

        /**********************************************************************
         * Stage 3: Static Lint & Governance Validation
         **********************************************************************/

        stage('Static Lint & Governance Validation') {
            steps {
                sh '''
                    set -euo pipefail
                    echo "========================================"
                    echo "STAGE 3: STATIC LINT & GOVERNANCE VALIDATION"
                    echo "========================================"
                    bash scripts/validate.sh
                '''
            }
        }

        /**********************************************************************
         * Stage 4: Automated Unit & Schema Testing
         **********************************************************************/

        stage('Unit & Schema Testing') {
            steps {
                sh '''
                    set -euo pipefail
                    echo "========================================"
                    echo "STAGE 4: AUTOMATED UNIT & SCHEMA TESTING (62 SUITES)"
                    echo "========================================"
                    podman run --rm \
                        --userns=keep-id \
                        --volume "${WORKSPACE}:/app:ro,Z" \
                        --workdir /app \
                        "${NODE_RUNNER_IMAGE}" \
                        npm test
                '''
            }
        }

        /**********************************************************************
         * Stage 5: Build & Pin OCI Image
         **********************************************************************/

        stage('Build & Pin OCI Image') {
            steps {
                sh '''
                    set -euo pipefail
                    echo "========================================"
                    echo "STAGE 5: BUILD & PIN OCI IMAGE"
                    echo "========================================"

                    export REGISTRY_HOST="${params.REGISTRY_HOST}"
                    if [ -n "${params.IMAGE_TAG}" ]; then
                        export IMAGE_TAG="${params.IMAGE_TAG}"
                    fi
                    export PUSH_IMAGE="false"

                    bash scripts/build.sh
                '''
            }
        }

        /**********************************************************************
         * Stage 6: Ephemeral Container Smoke Test
         **********************************************************************/

        stage('Ephemeral Smoke Test') {
            steps {
                sh '''
                    set -euo pipefail
                    echo "========================================"
                    echo "STAGE 6: EPHEMERAL CONTAINER SMOKE TEST"
                    echo "========================================"

                    export REGISTRY_HOST="${params.REGISTRY_HOST}"
                    if [ -n "${params.IMAGE_TAG}" ]; then
                        export IMAGE_TAG="${params.IMAGE_TAG}"
                    fi

                    bash scripts/test-image.sh
                '''
            }
        }

        /**********************************************************************
         * Stage 7: Publish Image to Container Registry
         **********************************************************************/

        stage('Publish Image to Registry') {
            when {
                expression { return params.PUSH_IMAGE == true }
            }
            steps {
                sh '''
                    set -euo pipefail
                    echo "========================================"
                    echo "STAGE 7: PUBLISH IMAGE TO REGISTRY"
                    echo "========================================"

                    version="$(<VERSION)"
                    tag="${params.IMAGE_TAG:-${version}}"
                    target_image="${params.REGISTRY_HOST}/${PROJECT_NAME}:${tag}"
                    latest_image="${params.REGISTRY_HOST}/${PROJECT_NAME}:latest"

                    echo "Mendorong image ke registry: ${target_image} & ${latest_image}"
                    podman push "${target_image}"
                    podman push "${latest_image}"
                '''
            }
        }
    }

    /**************************************************************************
     * Post Actions
     **************************************************************************/

    post {
        always {
            cleanWs deleteDirs: true, notFailBuild: true
        }
        success {
            echo "✔ DIAGNOSTIC SERVICE CI PIPELINE BERHASIL DISELESAIKAN DENGAN SUKSES!"
        }
        failure {
            echo "✘ DIAGNOSTIC SERVICE CI PIPELINE GAGAL PADA SALAH SATU QUALITY GATE."
        }
    }
}
