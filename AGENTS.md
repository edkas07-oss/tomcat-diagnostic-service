# AGENTS.md — Developer & AI Agent Guidelines for Tomcat Diagnostic Service

## 🎯 Repository Purpose
This repository contains the application source code, dependency baseline, container image lifecycle, database schema migrations, and component test suites for **Tomcat Diagnostic Service** within the Tomcat Monitoring & Diagnostics platform.

The service functions as the **Autonomous Diagnostic Engine & Decision Authority**. It ingests operational alerts (`TomcatDown`, Application Health, JVM GC/Memory, Concurrency Threading) from Alertmanager, evaluates incidents deterministically via a Multi-Domain Diagnostic Dispatcher, persists incident state in SQLite, and generates structured 7-section incident reports with actionable runbooks—adhering strictly to a **Zero Automatic Remediation** policy ([TM-ADR-0014](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/adr-records/TM-ADR-0014.md), [TM-ADR-0023](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/adr-records/TM-ADR-0023.md)).

## 🏛️ Architecture Rules & Non-Negotiables
1. **Zero Destructive Auto-Remediation:** The service MUST NOT attempt automatic container restarts, kills, configuration mutations, or arbitrary shell executions.
2. **Deterministic Multi-Domain Dispatching:** All alerts must be evaluated through the canonical Multi-Domain Dispatcher strategy across defined decision branches.
3. **5-Layer Ingestion Defense-in-Depth:** Ingestion of dynamic declarative rulepacks via `/api/v1/rules` must enforce Bearer Auth, JSON Schema validation (Ajv Draft 2020-12), Anti-Collision checks, Payload Size Limits (64 KiB), and Append-Only Immutability.
4. **Isolated SQLite Persistence:** SQLite access MUST remain confined to repository adapters, operating on a single logical worker thread with WAL mode enabled.
5. **Bounded Evidence Gathering:** Evidence adapters must strictly bound resource consumption (max 500 lines / 512 KiB for `catalina.out` with credential sanitization, 5s timeout for Prometheus queries).
6. **Two-Tier Storage Standard:** Named volume `diagnostic_data` for SQLite, `tomcat_logs` for Tomcat logs, and host `tm-home` for configuration, secrets, and TLS.

## 🛠️ Build & Validation Commands
- **Static Validation:** `./scripts/validate.sh`
- **Unit Test Suite:** `podman run --rm -v $(pwd):/app:Z -w /app localhost/nodejs:24.18.0 npm test`
- **Build Container Image:** `./scripts/build.sh`
- **Component Smoke Test:** `./scripts/test-image.sh`
