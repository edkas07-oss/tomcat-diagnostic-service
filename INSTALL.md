# 📦 Installation & Deployment Guide — Tomcat Diagnostic Service

[![Node.js Version](https://img.shields.io/badge/Node.js-24.18.0_LTS-green.svg)](https://nodejs.org)
[![OCI Container](https://img.shields.io/badge/OCI-Podman%20%7C%20Docker-blue.svg)](Containerfile)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Security](https://img.shields.io/badge/Security-Zero%20Auto--Remediation-purple.svg)](CONFIG)

This guide provides comprehensive instructions for building, deploying, configuring, and verifying the **Tomcat Diagnostic Service** (*Autonomous Diagnostic Engine & Decision Authority*) across local environments, staging clusters, and production container hosts.

---

## 📑 Table of Contents

- [1. System & Container Engine Prerequisites](#1-system--container-engine-prerequisites)
- [2. Building the OCI Container Image](#2-building-the-oci-container-image)
- [3. Standalone Container Execution (Podman / Docker)](#3-standalone-container-execution-podman--docker)
- [4. Automated Fleet Deployment (`tmctl` / Ansible)](#4-automated-fleet-deployment-tmctl--ansible)
- [5. Two-Tier Storage Model & Volume Setup](#5-two-tier-storage-model--volume-setup)
- [6. Configuration Contracts & Secret Injection](#6-configuration-contracts--secret-injection)
- [7. Post-Installation Verification & Health Probes](#7-post-installation-verification--health-probes)

---

## 1. System & Container Engine Prerequisites

### Supported Operating Systems
* **Linux:** Amazon Linux 2023, Ubuntu (20.04 / 22.04 / 24.04 LTS), Debian (11 / 12), RHEL / Rocky Linux (8 / 9).
* **Windows:** Windows Server 2019 / 2022 / 2025 (via Docker Engine / WSL2 / Linux Containers).

### Container Engine Runtimes
* **Podman:** Version 4.0+ (Rootless with `--userns=keep-id` recommended).
* **Docker Engine:** Version 24.0+.

### Network & Port Allocations
* **Port 8443 (HTTPS/TLS):** Internal ingestion endpoint for Alertmanager v4 webhooks and REST rule management.

---

## 2. Building the OCI Container Image

Build the container image using the digest-pinned `Containerfile`:

```bash
# Clone repository
git clone git@github.com:edkas07-oss/tomcat-diagnostic-service.git
cd tomcat-diagnostic-service

# Build versioned and latest local images
./scripts/build.sh
```

This builds:
* `localhost/tomcat-diagnostic-service:latest`
* `localhost/tomcat-diagnostic-service:<VERSION>`

> [!NOTE]
> The build enforces deterministic dependency isolation (`npm ci --omit=dev --ignore-scripts`) and executes strictly as the non-root `node` user (`UID 1000`).

---

## 3. Standalone Container Execution (Podman / Docker)

Run the container in standalone mode binding to host storage mounts:

```bash
podman run -d \
  --name diagnostic-service \
  --net devops-lab \
  --userns keep-id \
  -p 8443:8443 \
  -v /opt/tm-home/config/application.json:/run/tomcat-diagnostic/application.json:ro,z \
  -v /opt/tm-home/config/targets.json:/run/tomcat-diagnostic/config/targets.json:ro,z \
  -v /opt/tm-home/secrets/bearer-token:/run/tomcat-diagnostic/secrets/bearer-token:ro,z \
  -v /opt/tm-home/tls/server.crt:/run/tomcat-diagnostic/tls/server.crt:ro,z \
  -v /opt/tm-home/tls/server.key:/run/tomcat-diagnostic/tls/server.key:ro,z \
  -v /opt/tm-home/tls/postfix-ca.crt:/run/tomcat-diagnostic/tls/postfix-ca.crt:ro,z \
  -v /opt/tm-home/spool:/run/tomcat-diagnostic/spool:ro,z \
  -v tomcat_logs:/run/tomcat-diagnostic/logs:ro,z \
  -v diagnostic_data:/var/lib/tomcat-diagnostic:z \
  -e NODE_EXTRA_CA_CERTS=/run/tomcat-diagnostic/tls/postfix-ca.crt \
  localhost/tomcat-diagnostic-service:latest
```

---

## 4. Automated Fleet Deployment (`tmctl` / Ansible)

In standard production fleets, the service is managed declaratively via `tmctl`:

```bash
# Deploy diagnostic service target
tmctl stack deploy --target diagnostic

# Verify running container state and port bindings
tmctl stack status
```

---

## 5. Two-Tier Storage Model & Volume Setup

The Diagnostic Service strictly adheres to the Two-Tier Storage standard:

```text
Tier 1: High-I/O Named Volumes
├── diagnostic_data   -> /var/lib/tomcat-diagnostic (SQLite diagnostic.db in WAL mode)
└── tomcat_logs       -> /run/tomcat-diagnostic/logs (Shared read-only catalina.out)

Tier 2: Host Workspace (/opt/tm-home or C:\tm-home)
├── config/           -> Application & target configurations (application.json, targets.json)
├── secrets/          -> Authentication tokens (bearer-token, smtp-password)
├── tls/              -> X.509 TLS certificates (server.crt, server.key, postfix-ca.crt)
└── spool/            -> Restricted Event Spool (0700 permissions)
```

Ensure prerequisite named volumes exist before starting:
```bash
podman volume create diagnostic_data
podman volume create tomcat_logs
```

---

## 6. Configuration Contracts & Secret Injection

### Prerequisite Files in `/opt/tm-home/`:

1. **`config/application.json`:** Primary application parameters (bind port, SQLite path, timeouts, SMTP endpoint).
2. **`config/targets.json`:** Registry of monitored Tomcat workloads with path confinement constraints.
3. **`secrets/bearer-token`:** Secret string matching Alertmanager webhook configuration (`Authorization: Bearer <token>`).
4. **`tls/server.crt` & `tls/server.key`:** X.509 certificate and private key for HTTPS TLS termination.

---

## 7. Post-Installation Verification & Health Probes

Verify the service endpoints over TLS:

```bash
# 1. Liveness Probe (HTTP 200 {"status":"UP"})
curl -k https://localhost:8443/health/live

# 2. Readiness Probe (Verifies SQLite connection & worker readiness)
curl -k https://localhost:8443/health/ready

# 3. Scrape Self-Monitoring Prometheus Telemetry
curl -k https://localhost:8443/health

# 4. Test Ingestion with Sample Alert Payload
curl -k -X POST https://localhost:8443/api/v1/alerts/alertmanager \
  -H "Authorization: Bearer $(cat /opt/tm-home/secrets/bearer-token)" \
  -H "Content-Type: application/json" \
  -d @config/schemas/alertmanager-webhook-v4.schema.json
```
