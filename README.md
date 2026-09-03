# Tomcat Diagnostic Service

Repository ini berisi aplikasi core **Tomcat Diagnostic Service** untuk platform Tomcat Monitoring & Diagnostics. Layanan ini bertindak sebagai *Autonomous Diagnostic Engine* yang menerima webhook alert `TomcatDown` dari Alertmanager, melakukan korelasi bukti log, artefak crash, dan telemetri runtime secara deterministik, mengevaluasi basis aturan (*Declarative Rulepack Engine*), mengelola persistensi siklus hidup diagnosis pada SQLite, serta menerbitkan laporan diagnosis terstruktur 7 seksi dengan rekomendasi SOP operator via SMTP (Mailpit/Email).

Layanan ini dirancang berdasarkan prinsip **Deterministic Honesty** dan **Human-in-the-Loop Governance** — sistem tidak melakukan *automatic remediation* atau manipulasi proses container Tomcat secara sewenang-wenang.

---

## 🏛️ Fitur & Kapabilitas Utama

1. **Durable Alert Ingestion & Queue:** Ingestion webhook Alertmanager v4 melalui HTTPS TLS dengan deduplikasi persisten dan antrean berkapasitas 50 event.
2. **Deterministic & Declarative Rulepack Engine:** Pohon keputusan deterministik 18 cabang:
   - **8 Built-in Branches (`TD-01` s/d `TD-08`):** TLS scrape unavailable, OOM Killed, JVM Crash, Port bind conflict, Orderly shutdown, Container exited unknown, Contradicting state, dan Undetermined evidence.
   - **10 Curated Custom Branches (`TD-09` s/d `TD-18`):** Database pool exhaustion, Thread pool exhaustion, Heap OOM, Metaspace OOM, SSL Handshake failure, HikariCP timeout, Context init failure, Thread deadlock, Socket read timeout, dan SQL timeout.
3. **Formal Rule Categorization (*Failure Domains*):** Pengelompokan aturan diagnosis berbasis 8 enum kategori resmi (`jvm_memory`, `concurrency_threading`, `database_persistence`, `network_integration`, `application_lifecycle`, `storage_os_limits`, `security_session`, `general`) pada skema JSON, SQLite, dan laporan email.
4. **Safe Hot-Reload Rules API (`/api/v1/rules`):**
   - Ingestion aturan baru secara *live* tanpa *restart container* (*zero-downtime hot-reload*).
   - Ekspor dan filtering katalog aturan berbasis domain query parameter (`GET /api/v1/rules?category=<name>`).
   - Dilindungi oleh **5-Layer Ingestion Defense-in-Depth** (Auth Guard, Schema Guard, Collision Guard, Payload Size Guard, dan Append-Only Immutability Guard).
5. **Resilient Notification Delivery:** Single worker loop dengan retry berbatas (*exponential backoff* 1s & 5s, maks 3 percobaan) dan korelasi *resolved state*.
6. **SQLite Persistence:** Migrasi schema forward-only (`001` s/d `006`), tabel `events`, `incidents`, `canonical_results`, `evidence_summaries`, `delivery_attempts`, `notification_attempts`, dan `custom_rules` (termasuk kolom `category`).
7. **Observability:** Endpoint `/health/live`, `/health/ready`, dan `/metrics` (Prometheus text format).

---

## 📑 Taksonomi Kategori Domain Kegagalan (Failure Domains)

Sistem mengadopsi taksonomi **8 Kategori Domain Kegagalan** untuk menstrukturkan basis pengetahuan diagnosis dan mempermudah perutean eskalasi:

| Kategori Domain (*Category Enum*) | Definisi & Cakupan Kegagalan | Pola & Gejala Tipikal (*Typical Patterns*) | Tim Eskalasi / Triage Target |
| :--- | :--- | :--- | :--- |
| **`jvm_memory`** | Kegagalan alokasi memori internal JVM, class metadata, atau batas garbage collector. | `OutOfMemoryError: Java heap space`, `Metaspace`, `GC overhead limit exceeded`, `Direct buffer memory`. | Tim Backend / Java Developer |
| **`concurrency_threading`** | Kejenuhan worker thread pool Tomcat, thread starvation, atau kondisi saling kunci (*deadlock*). | `RejectedExecutionException: Thread pool is exhausted`, `Java-level deadlock`, thread saturation. | Tim Backend / Platform Engineer |
| **`database_persistence`** | Kegagalan konektivitas, exhaustion connection pool database, timeout query, atau deadlock database. | `CannotGetJdbcConnectionException`, `HikariPool timeout`, `SQLTimeoutException`, connection leak. | Tim DBA / Database Administrator |
| **`network_integration`** | Kegagalan jabat tangan TLS/SSL, timeout komunikasi microservice upstream, atau DNS/socket failure. | `SSLHandshakeException`, `SocketTimeoutException: Read timed out`, `ConnectException: Connection refused`. | Tim Network / Cloud Infrastructure |
| **`application_lifecycle`** | Kegagalan startup container, deployment WAR, inisialisasi context aplikasi, atau runtime servlet error. | `LifecycleException: Failed to start component`, `BeanCreationException`, `ClassNotFoundException`. | Tim Application Developer |
| **`storage_os_limits`** | Batasan resource OS host, exhaustion file descriptor / process limit (ulimit), atau kapasitas disk. | `Too many open files`, `No space left on device`, `Read-only file system`, exit code container tanpa dump. | Tim Sysadmin / Infrastructure |
| **`security_session`** | Kegagalan autentikasi eksternal, otorisasi, validasi token, replikasi sesi cluster, atau filter crash. | `LDAPException`, `SessionReplicationException`, `InvalidTokenException`, CORS filter crash. | Tim Security / IAM & Middleware |
| **`general`** | Kondisi cross-domain, telemetri anomali saling bertentangan, atau klasifikasi *fallback* yang belum terpetakan. | `Contradicting state`, `Undetermined evidence`, pola kegagalan baru yang memerlukan analisis AI. | SRE / Incident Commander |

---

## 📦 Toolchain & Standar Lingkungan

- **Runtime:** Node.js `24.18.0` (ESM JavaScript murni).
- **Test Runner:** Built-in `node:test` dan `node:assert`.
- **Database:** Built-in `node:sqlite` (SQLite 3 synchronous engine).
- **JSON Schema Validator:** Exact-pinned `ajv@8.20.0`.
- **SMTP Client:** Exact-pinned `nodemailer@9.0.6`.
- **Base Container Image:** `localhost/nodejs:24.18.0` (Digest pinned).

---

## 📂 Struktur Repositori

```text
tomcat-diagnostic-service/
├── AGENTS.md          Tata kelola agen dan batasan repositori
├── CONFIG             Metadata toolchain non-secret
├── Containerfile      Digest-pinned application container image
├── PROJECT            Identitas project yang dapat dibaca script
├── README.md          Spesifikasi kontrak dan status implementasi
├── VERSION            Versi rilis aplikasi (saat ini: 0.1.4)
├── package.json       Kontrak package ESM dan dependency lock
├── package-lock.json  Dependency lock
├── config/schemas/    Versioned JSON Schemas:
│   ├── alertmanager-webhook-v4.schema.json
│   ├── application-config-v1.schema.json
│   └── rulepack-v1.schema.json (dengan category enum)
├── migrations/        Forward-only SQLite schema migrations:
│   ├── 001-initial.sql
│   ├── 002-canonical-results.sql
│   ├── 003-delivery-attempts.sql
│   ├── 004-notification-lifecycle.sql
│   ├── 005-custom-rules.sql
│   └── 006-rule-category.sql
├── src/               Kode sumber aplikasi:
│   ├── adapters/      SQLite repository, SMTP sender, & Evidence collectors
│   ├── application/   Diagnostic worker, Result renderer, & Notification orchestrator
│   ├── domain/        Deterministic engine, Rulepack loader, & Dynamic evaluator
│   └── server/        HTTPS server, Authentication, Routes, & Schema validators
├── test/              Unit dan temporary-SQLite integration test suites (47 unit tests)
└── scripts/
    ├── build.sh       Build versioned dan latest local image
    ├── test-image.sh  Static runtime & container image contract probes
    ├── test-image-component.sh  Disposable HTTPS/SQLite/signal tests
    └── validate.sh    Static validation tanpa network/container
```

---

## 🧪 Validasi & Pengujian

### 1. Static Code Validation
```bash
./scripts/validate.sh
```

### 2. Unit & Integration Tests (47 Tests)
```bash
podman run --rm -v $(pwd):/app -w /app localhost/nodejs:latest npm test
```

### 3. Container Image Build
```bash
./scripts/build.sh
./scripts/test-image.sh
```

---

## 🌐 Rules API Specification

Base URL: `https://diagnostic-service:8443`  
Header Wajib: `Authorization: Bearer <token>`

| Method | Endpoint | Deskripsi | Status Code |
| :---: | :--- | :--- | :---: |
| `POST` | `/api/v1/rules` | Ingest Declarative Rulepack baru (Hot-Reload) | `201 Created` / `400` / `401` / `409` / `413` |
| `GET` | `/api/v1/rules` | Ekspor seluruh katalog aturan aktif di sistem | `200 OK` / `401 Unauthorized` |
| `GET` | `/api/v1/rules?category=<name>` | Ekspor aturan spesifik berdasarkan domain kategori | `200 OK` / `401 Unauthorized` |
| `GET` | `/api/v1/rules/:id` | Ekspor aturan spesifik berdasarkan Branch / ID | `200 OK` / `404 Not Found` |
| `PUT/DELETE` | `/api/v1/rules/*` | Upaya modifikasi/penghapusan (Ditolak) | `405 Method Not Allowed` |

---

## 📊 Status Implementasi & Verifikasi

| Komponen & Kapabilitas | Status | Catatan Verifikasi |
| :--- | :---: | :--- |
| **Repository Governance & Boundaries** | ✅ Selesai | Pinned toolchain, ESM, no-framework |
| **Alertmanager Ingestion & Queue** | ✅ Selesai | Webhook v4, deduplikasi, kapasitas 50 |
| **SQLite Persistence & Migrations** | ✅ Selesai | 6 migration files, zero-data loss |
| **Decision Engine (TD-01..TD-08)** | ✅ Selesai | Deterministic honesty, 7-section reports |
| **Custom Rule Engine (TD-09..TD-18)**| ✅ Selesai | Dynamic rulepack evaluation & hot-reloading |
| **Rule Categorization Engine** | ✅ Selesai | 8 failure domain enums, filtering API, email label |
| **Rules API & 5-Layer Defense** | ✅ Selesai | Auth, schema, collision, size, immutability |
| **SMTP Delivery & Resolved Correlation**| ✅ Selesai | Exponential retry, clean HTML/Text reports |
| **Persistent Lab Deployment** | ✅ Selesai | Aktif di `devops-lab` container network |
| **Automated Verification Suites** | ✅ Selesai | 100% lulus pada 47 unit test & end-to-end suites |

---

## 📖 Dokumentasi Terkait

* **DevOps Handbook:** [`devops-handbook/docs/projects/tomcat-monitoring/`](file:///home/eddywiyatno/git/devops-handbook/docs/projects/tomcat-monitoring/)
* **AI Knowledge Runbook:** [`devops-handbook/docs/projects/tomcat-monitoring/operations/ai-knowledge-enrichment-and-rule-management-runbook.md`](file:///home/eddywiyatno/git/devops-handbook/docs/projects/tomcat-monitoring/operations/ai-knowledge-enrichment-and-rule-management-runbook.md)
* **Engineering Journal TN-018 & TN-019:** [`devops-handbook/docs/projects/tomcat-monitoring/engineering-journal/diagnostic-mvp-pilot/`](file:///home/eddywiyatno/git/devops-handbook/docs/projects/tomcat-monitoring/engineering-journal/diagnostic-mvp-pilot/)
