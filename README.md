# Tomcat Diagnostic Service

Repository ini berisi aplikasi core **Tomcat Diagnostic Service** untuk platform Tomcat Monitoring & Diagnostics. Layanan ini bertindak sebagai *Autonomous Diagnostic Engine & Decision Authority* yang menerima webhook alert insiden dan anomali ketersediaan runtime dari Alertmanager, melakukan korelasi bukti log (*catalina.out*), artefak crash (*fatal JVM crash / OOM dump*), snapshot container, dan telemetri runtime secara deterministik, mengevaluasi basis aturan terstruktur (*Declarative Rulepack Engine*), mengelola persistensi siklus hidup diagnosis pada database SQLite, serta menerbitkan laporan diagnosis terstruktur 7 seksi dengan rekomendasi SOP tindakan operator via SMTP (Mailpit/Email).

Layanan ini dirancang berdasarkan prinsip **Deterministic Honesty** dan **Human-in-the-Loop Governance** — sistem tidak melakukan *automatic remediation* atau manipulasi proses container Tomcat secara sewenang-wenang (TM-ADR-0014).

---

## 🏛️ Fitur & Kapabilitas Utama

1. **Durable Alert Ingestion & Queue:** Ingestion webhook Alertmanager v4 melalui HTTPS TLS dengan deduplikasi persisten dan antrean berkapasitas 50 event (TM-ADR-0015).
2. **Target Isolation & Bounded Evidence Adapters:** Registri target terisolasi berbasis allowlist (`targets.json`), pengurungan path absolut ternormalisasi (anti-path traversal `../` dan anti-symlink), pembatasan kuota baca log (`catalina.out` maks 500 baris / 512 KiB) dengan sensor redaksi data sensitif (password/token/credential), pembatasan spool collector atomik (maks 200 berkas / 16 KiB per record), Prometheus API query (one-attempt timeout 5s), dan HTTPS application health probe (timeout 3s tanpa menyimpan response body).
3. **Deterministic Multi-Domain Diagnostic Engine & Dispatcher:** Arsitektur dispatcher modular berbasis Strategy Pattern yang mengevaluasi peringatan ke 4 engine domain resmi dengan total **20 Built-in Decision Branches** (TM-ADR-0023):
   - **Tomcat Down Engine (`TD-01` s/d `TD-08`):** Scrape unavailable, Cgroup OOM killer (exit 137), Fatal JVM crash (`hs_err`), Port bind conflict, Clean shutdown, Uncorrelated container exit, Probable unresponsive pause, dan Undetermined state.
   - **Application Health Engine (`AH-01` s/d `AH-05`):** Servlet HTTP 5xx errors, HTTP health check timeout, Health metrics missing, Database connectivity failure, dan Upstream dependency failure.
   - **JVM Workload & Memory Engine (`GC-01` s/d `GC-04`):** GC pause duration high (> 1.5s), GC overhead / CPU thrashing (> 85%), Old Gen heap pressure (> 90%), dan Class metadata / Metaspace exhaustion.
   - **Concurrency & Threading Engine (`TH-01` s/d `TH-03`):** Connector thread pool saturation (100% busy), Thread deadlock detected, dan High concurrency queue starvation.
   - **10 Curated Custom Branches (`TD-09` s/d `TD-18`):** Database pool exhaustion, Thread pool exhaustion, Heap OOM, Metaspace OOM, SSL Handshake failure, HikariCP timeout, Context init failure, Thread deadlock, Socket read timeout, dan SQL timeout.
4. **Formal Rule Categorization (*Failure Domains*):** Pengelompokan aturan diagnosis berbasis 8 enum kategori resmi (`jvm_memory`, `concurrency_threading`, `database_persistence`, `network_integration`, `application_lifecycle`, `storage_os_limits`, `security_session`, `general`) pada skema JSON, SQLite, dan laporan email.
5. **Rule ID Fidelity & Dynamic Severity:** Preservasi nama alert Prometheus asli secara transparan dan perenderan severity dinamis (`[WARNING]` / `[CRITICAL]`) pada subjek email serta laporan investigasi.
6. **Safe Hot-Reload Rules API (`/api/v1/rules`):**
   - Ingestion aturan baru secara *live* tanpa *restart container* (*zero-downtime hot-reload*).
   - Ekspor dan filtering katalog aturan berbasis domain query parameter (`GET /api/v1/rules?category=<name>`).
   - Dilindungi oleh **5-Layer Ingestion Defense-in-Depth** (Auth Guard, Schema Guard, Collision Guard, Payload Size Guard, dan Append-Only Immutability Guard).
7. **Resilient Notification Delivery & Lifecycle Orchestration:** Single worker loop dengan batasan deadline 60 detik, retry berbatas (*exponential backoff* 1s & 5s, maks 3 percobaan), proteksi *material update guard*, penekanan duplikasi identik (*identical-result suppression*), dan korelasi *resolved state* (TM-ADR-0016).
8. **SQLite Persistence & State Resilience:** Migrasi schema forward-only (`001` s/d `007`), tabel `events`, `incidents`, `canonical_results`, `evidence_summaries`, `delivery_attempts`, `notification_attempts`, dan `custom_rules`, dilengkapi mekanisme **Stale Lock Recovery** (pemulihan otomatis antrean terinterupsi pasca-restart), **Bounded Retries** (pencegahan crash loop), serta **Foreign-Key Safe Retention Pruning & Incremental Vacuum** (TM-ADR-0013, TM-ADR-0015, TN-007).
9. **Observability & Health Probing:** Endpoint `/health`, `/health/live`, `/health/ready`, dan `/metrics` (Prometheus text format) mengekspos metrik liveness, antrean, kegagalan worker, stale locks recovered/exhausted, siklus housekeeping, dan ukuran database (`diagnostic_db_size_bytes`).

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

## 📊 Anatomi 7-Seksi Laporan Diagnosis (Incident Report Anatomy)

Laporan diagnosis insiden diterbitkan dalam format *HTML multi-part* dan *Plain Text* terstruktur 7 seksi kanonikal (TN-007):

1. **Section 1: Incident Header & Target Context** — Identitas insiden, nama alert asli (*Rule ID Fidelity* / `alertname`), tingkat keparahan dinamis (`[WARNING]` / `[CRITICAL]`), target instance (`environment`, `host`, `tomcat_instance`), status alert (`FIRING` / `RESOLVED`), dan stempel waktu UTC/lokal.
2. **Section 2: Primary Root Cause & Decision Branch** — Klasifikasi cabang keputusan deterministik (`TD-xx`, `AH-xx`, `GC-xx`, `TH-xx`, atau custom rulepack) beserta deskripsi ringkas akar masalah.
3. **Section 3: Failure Domain Classification** — Klasifikasi kategori domain kegagalan resmi (`jvm_memory`, `database_persistence`, dll.) untuk memandu eskalasi on-call.
4. **Section 4: Diagnostic Confidence Score & Evaluation Matrix** — Tingkat kepastian hasil diagnosis (`HIGH`, `MEDIUM`, `LOW`) berdasarkan kelengkapan bukti pendukung.
5. **Section 5: Correlated Evidence Summary** — Ringkasan bukti terkorelasi:
   - Cuplikan log terkorelasikan dari `catalina.out` (dengan sensor data sensitif).
   - Snapshot status container dan indikator OOM dari Restricted Collector Spool.
   - Hasil telemetri Prometheus scrape dan HTTP application health probe.
6. **Section 6: Actionable Operator SOP Steps** — Panduan langkah perbaikan manual (*runbook SOP*) yang wajib dijalankan operator/SRE (*Zero Automatic Remediation*).
7. **Section 7: System Metadata & Verification Audit Trail** — Metadata audit transaksi: ID event SQLite, trace fingerprint, versi engine diagnosis, dan checksum rulepack.

---

## 🌐 Matriks Referensi REST API (Consolidated REST API Reference)

Diagnostic Service menyediakan antarmuka HTTPS internal terenkripsi (Port 8443) untuk kebutuhan observabilitas, ingest webhook alert otomatis, dan manajemen aturan deklaratif secara *live*.

### 📋 Matriks Endpoint Terpadu

| Method | Endpoint Path | Autentikasi | Request / Response Format | Batas Payload (*Size Limit*) | Deskripsi Fungsional & Status Code |
| :---: | :--- | :---: | :---: | :---: | :--- |
| `GET` | `/health/live` | Public | `-` / `application/json` | - | **Liveness Probe:** Memverifikasi proses Node.js aktif dan berjalan normal (`200 {"status":"UP"}`). Digunakan oleh container orchestrator (Podman/K8s). |
| `GET` | `/health/ready` | Public | `-` / `application/json` | - | **Readiness Probe:** Mengembalikan status kesiapan antrean dan migrasi SQLite (`200` jika siap melayani trafik, `503` jika startup gagal/shutting down). |
| `GET` | `/health` | Public | `-` / `text/plain` | - | **Self-Monitoring Scrape:** Mengekspos metrik kesehatan internal format Prometheus text format untuk pemantauan ketersediaan via Prometheus (`up{job="tomcat-diagnostic-service"}`). |
| `GET` | `/metrics` | Public | `-` / `text/plain` | - | **Operational Metrics:** Mengekspos seluruh metrik operasional internal format Prometheus text format (`diagnostic_db_size_bytes`, `diagnostic_stale_locks_recovered_total`, dll.). |
| `POST` | `/api/v1/alerts/alertmanager` | Bearer Token | `application/json` / `application/json` | 256 KiB | **Webhook Ingestion:** Menerima payload alert Alertmanager v4, melakukan deduplikasi event atomik, dan enqueue ke `work_queue` SQLite (`202 Accepted` / `400` / `401` / `413` / `415` / `429`). |
| `GET` | `/api/v1/rules` | Bearer Token | `-` / `application/json` | - | **Rules Catalog Export:** Mengambil seluruh daftar aturan aktif (gabungan built-in TD-01..08 dan custom rules). Mendukung query filter `?category=<enum>` (`200 OK` / `401`). |
| `POST` | `/api/v1/rules` | Bearer Token | `application/json` / `application/json` | 64 KiB | **Declarative Rule Ingestion:** Mendaftarkan aturan baru ke database SQLite `custom_rules` dan melakukan *hot-reloading* instan ke RAM evaluator (`201 Created` / `400` / `401` / `409` / `413` / `415`). |
| `GET` | `/api/v1/rules/:id_or_branch` | Bearer Token | `-` / `application/json` | - | **Single Rule Detail:** Mengambil detail aturan spesifik berdasarkan nama branch (misal: `TD-01`, `TD-09`) atau database ID (`200 OK` / `401` / `404 Not Found`). |
| `PUT`, `DELETE`, `PATCH` | `/api/v1/rules/*` | - | - | - | **Append-Only Immutability Guard:** Seluruh operasi mutasi atau penghapusan aturan dilarang secara mutlak (`405 Method Not Allowed`). |

---

### 🔌 Detail Spesifikasi & Contoh Interaksi API

#### 1. Webhook Ingestion (`POST /api/v1/alerts/alertmanager`)
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Payload Max:** `256 KiB` (TN-008)
- **Skema Label Wajib:** `config/schemas/alertmanager-webhook-v4.schema.json` (`alertname`, `environment`, `host`, `tomcat_instance`, `check`, `severity`).

```bash
curl -k -s -X POST https://127.0.0.1:8443/api/v1/alerts/alertmanager \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "receiver": "lab-diagnostic-service",
    "status": "firing",
    "groupKey": "{}:{alertname=\"TomcatDown\"}",
    "alerts": [{
      "status": "firing",
      "labels": {
        "alertname": "TomcatDown",
        "environment": "lab",
        "host": "edkas-pc1",
        "tomcat_instance": "default",
        "check": "runtime-availability",
        "severity": "critical"
      },
      "annotations": {
        "summary": "Tomcat runtime is unreachable"
      },
      "startsAt": "2026-09-11T12:00:00Z"
    }]
  }'
```

#### 2. Declarative Rule Ingestion (`POST /api/v1/rules`)
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Payload Max:** `64 KiB`
- **Skema Validasi:** `config/schemas/rulepack-v1.schema.json` (Validasi Ajv Draft 2020-12, Anti-Collision, ReDoS-Safe Regex, Kategori Domain Resmi).

```bash
curl -k -s -X POST https://127.0.0.1:8443/api/v1/rules \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "ruleId": "TomcatDown",
    "branch": "TD-09",
    "ruleName": "DatabaseConnectionPoolExhausted",
    "category": "database_persistence",
    "targetSource": "local_file",
    "pattern": "CannotGetJdbcConnectionException|HikariPool.*Connection is not available",
    "assessment": "Koneksi ke database backend habis atau mengalami deadlock pool",
    "classification": "DATABASE_POOL_EXHAUSTION",
    "confidence": "HIGH",
    "recommendedActions": [
      "Periksa metrik connection pool database",
      "Periksa status database server backend"
    ]
  }'
```

#### 3. Rules Catalog Export & Filtering (`GET /api/v1/rules`)
- **Headers:** `Authorization: Bearer <token>`
- **Filter Query Opsional:** `?category=jvm_memory`, `?category=concurrency_threading`, `?category=database_persistence`, dll.

```bash
# Export seluruh aturan aktif
curl -k -s -H "Authorization: Bearer <token>" https://127.0.0.1:8443/api/v1/rules

# Filter berdasarkan kategori kegagalan database
curl -k -s -H "Authorization: Bearer <token>" "https://127.0.0.1:8443/api/v1/rules?category=database_persistence"
```

---

## 🔄 Siklus Hidup Notifikasi & Bounded Delivery (Notification Lifecycle)

Layanan menerapkan mesin status (*state machine*) orkestrasi notifikasi kanonikal yang persisten pada tabel SQLite `notification_attempts` (TN-012, TM-ADR-0016):

```text
[Webhook Ingestion] ──> [Atomic SQLite Ingest] ──> [Single Work Queue (50)]
                                                            │
                                                            ▼
                                                [Deterministic Diagnosis]
                                                            │
                     ┌──────────────────────────────────────┴──────────────────────────────────────┐
                     ▼                                                                             ▼
            [Status: FIRING]                                                              [Status: RESOLVED]
                     │                                                                             │
       ┌─────────────┴─────────────┐                                                 ┌─────────────┴─────────────┐
       ▼                           ▼                                                 ▼                           ▼
[Initial Firing]        [Subsequent Firing]                                   [Known Firing]            [Unknown Context]
(Send Report)           ┌──────────┴──────────┐                               (Send Resolved)           (Silent Discard)
                        ▼                     ▼                                      │
               [Identical Result]     [Material Update]                              ▼
               (Suppress Email)       (Send Update Report,                           [Done]
                                       Max 1 per Incident)
```

### Kebijakan Pengiriman & Retry Berbatas (*Bounded Retry Policy*)

1. **Initial Firing Delivery:** Dikirimkan tepat satu kali saat alert insiden pertama kali diterima.
2. **Identical-Result Suppression:** Menekan pengiriman email jika alert firing berulang menghasilkan pohon keputusan dan bukti yang identik.
3. **Material Update Guard:** Maksimal 1 kali pengiriman laporan pembaruan jika ditemukan akar masalah baru atau perubahan cabang diagnosis material.
4. **Resolved Notification Delivery:** Dikirimkan tepat satu kali saat notifikasi pemulihan (`status: resolved`) diterima, mengaitkan context insiden firing awal.
5. **Resolved Without Firing:** Dibuang secara aman (*silent discard / audit-only*) jika event resolved datang tanpa riwayat firing sebelumnya.
6. **Bounded Retry & Sanitized Error:**
   - Maksimal 3 kali percobaan pengiriman SMTP.
   - Interval backoff deterministik: Percobaan 1 (1 detik), Percobaan 2 (5 detik).
   - Batas usia notifikasi (*maximum age*): 60 detik (melewati 60 detik ditandai sebagai `failed` permanen untuk mencegah notifikasi basi).
7. **Single Work Queue Invariant:** Seluruh pemrosesan berjalan pada satu worker loop antrean persisten berkapasitas 50 item tanpa thread/queue sekunder.

---

## ⚙️ Kontrak Konfigurasi & Runtime Parameters

### Konfigurasi Baseline & Metadata (`CONFIG`)

Repository ini menggunakan berkas `CONFIG` sebagai deklarasi konfigurasi kanonikal non-secret untuk toolchain, base image, dan volume penyimpanan persisten:

```bash
# Toolchain aplikasi (TM-ADR-0013)
NODE_VERSION=24.18.0
MODULE_TYPE=module

# Identitas application image dan immutable local base (TN-010)
IMAGE_NAME=localhost/tomcat-diagnostic-service
BASE_IMAGE=localhost/nodejs@sha256:76b1444d507be3398f3196f37bd20f7a97a703871ed2716fa91a1a9520fc482d
BASE_IMAGE_ID=bccb45bc1e48a07ac6c2cd36f7352bccb555e8b3e6070cbefa727d83d6dee3bc

# Nilai bawaan storage volume runtime lokal
DATA_VOLUME=diagnostic_data
LOG_VOLUME=tomcat_logs
```

Parameter `DATA_VOLUME` dan `LOG_VOLUME` memastikan seluruh state SQLite dan pembacaan bukti log Tomcat beroperasi di atas Podman Named Volume persisten yang terisolasi dan dapat dikonfigurasi melalui environment variable.

### Parameter Konfigurasi (`application.json`)

| Parameter Path | Tipe | Default | Deskripsi & Batasan |
| :--- | :---: | :---: | :--- |
| `schemaVersion` | `integer` | `1` | Versi skema konfigurasi aplikasi |
| `listen.host` | `string` | `0.0.0.0` | Bind host listener HTTPS internal |
| `listen.port` | `integer` | `8443` | Port listener HTTPS internal |
| `databasePath` | `string` | `/var/lib/tomcat-diagnostic/diagnostic.db` | Path berkas database SQLite lokal |
| `tls.certificateFile` | `string` | `/run/tomcat-diagnostic/tls/server.crt` | Path sertifikat publik TLS server |
| `tls.privateKeyFile` | `string` | `/run/tomcat-diagnostic/tls/server.key` | Path private key TLS server |
| `bearerTokenFile` | `string` | `/run/tomcat-diagnostic/secrets/bearer-token` | Path berkas token autentikasi |
| `targetAllowlistFile` | `string` | `/run/tomcat-diagnostic/config/targets.json` | Path registri allowlist target |
| `smtp.host` | `string` | `mailpit` | Hostname SMTP relay / Mailpit |
| `smtp.port` | `integer` | `1025` | Port SMTP service |
| `smtp.secure` | `boolean` | `false` | TLS connection mode untuk SMTP |
| `smtp.from` | `string` | `diagnostic@tomcat-monitoring.invalid` | Alamat pengirim email notifikasi |
| `smtp.to` | `string` | `operator@tomcat-monitoring.invalid` | Alamat penerima email notifikasi |
| `queue.capacity` | `integer` | `50` | Kapasitas buffer antrean SQLite |
| `queue.pollIntervalMs`| `integer` | `250` | Interval polling worker antrean (ms) |
| `timeouts.diagnosticMs`| `integer` | `60000` | Batas waktu evaluasi diagnosis (60 detik) |
| `timeouts.smtpMs` | `integer` | `10000` | Timeout koneksi pengiriman SMTP (10 detik) |
| `timeouts.shutdownMs` | `integer` | `10000` | Timeout graceful shutdown (10 detik) |
| `requestLimitBytes` | `integer` | `262144` | Batas payload HTTP request (256 KiB) |

### Endpoints Observabilitas & Health Probing

| Method | Endpoint | Deskripsi | Respons Status |
| :---: | :--- | :--- | :---: |
| `GET` | `/health` | Pemeriksaan kesehatan umum | `200 OK` (`{"status":"healthy"}`) |
| `GET` | `/health/live` | Liveness probe kontainer | `200 OK` (`{"status":"alive"}`) |
| `GET` | `/health/ready` | Readiness probe (koneksi SQLite & worker aktif) | `200 OK` / `503 Service Unavailable` |
| `GET` | `/metrics` | Eksposisi metrik telemetri format Prometheus | `200 OK` (`text/plain`) |

### Graceful Shutdown Lifecycle

Saat menerima sinyal `SIGTERM` atau `SIGINT`, layanan menjalankan prosedur shutdown teratur (TN-009):
1. Menghentikan penerimaan koneksi HTTP baru.
2. Menyelesaikan pemrosesan item yang sedang dievaluasi pada worker queue aktif.
3. Menutup koneksi database SQLite secara atomik (*commit/wal checkpoint*).
4. Menutup koneksi transporter SMTP.
5. Keluar (*exit 0*) dalam batas toleransi `timeouts.shutdownMs` (10 detik).

---

## 🗄️ Tata Letak Mount Kontainer & Volume Persisten (Runtime Deployment Layout)

Standar tata letak mount path kontainer pada lingkungan lab dan produksi persisten (TN-011, TN-015):

| Mount Path di Kontainer | Tipe Mount | Hak Akses | Deskripsi & Tanggung Jawab |
| :--- | :---: | :---: | :--- |
| `/run/tomcat-diagnostic/application.json` | Bind File | `ro` (`0444`) | Konfigurasi runtime aplikasi |
| `/run/tomcat-diagnostic/config/targets.json` | Bind File | `ro` (`0444`) | Allowlist target yang diizinkan untuk didiagnosis |
| `/run/tomcat-diagnostic/secrets/bearer-token` | Bind File | `ro` (`0444`) | Secret token untuk autentikasi API & Webhook |
| `/run/tomcat-diagnostic/tls/server.crt` | Bind File | `ro` (`0444`) | Sertifikat TLS internal server |
| `/run/tomcat-diagnostic/tls/server.key` | Bind File | `ro` (`0400`) | Private key TLS internal server |
| `/run/tomcat-diagnostic/spool` | Bind Dir | `ro,z` | Direktori pembacaan snapshot Restricted Collector |
| `/run/tomcat-diagnostic/logs` | Named Vol | `ro,z` | Volume persisten log Tomcat (`tomcat_logs`) dibaca secara read-only untuk korelasi bukti `catalina.out` (dideklarasikan di `CONFIG`) |
| `/var/lib/tomcat-diagnostic` | Named Vol | `rw,z` | Volume persisten SQLite `diagnostic_data` (`diagnostic.db`, mode `0600`, dideklarasikan di `CONFIG`) |

### Kebijakan Persistensi Data & Isolasi (Zero `/tmp`)
- **Persistent Evidence & State:** Log Tomcat dibaca langsung dari Podman Named Volume `tomcat_logs` (`ro,z`) dan database SQLite disimpan di Named Volume `diagnostic_data` (`rw,z`). Tidak menggunakan direktori volatil `/tmp` agar data diagnosa dan log audit tetap persisten saat container/server direstart.
- **Configurable Storage:** Nama volume default dideklarasikan di `CONFIG` dan script deployment mendukung dynamic override melalui environment variable `DATA_VOLUME` dan `LOG_VOLUME`.

### Contoh Perintah Deployment Podman Persisten (TN-015)

```bash
podman run --detach --pull=never \
    --userns=keep-id \
    --name diagnostic-service \
    --network devops-lab \
    --network-alias diagnostic-service \
    --publish 8443:8443 \
    --restart=on-failure:5 \
    --volume "/path/to/application.json:/run/tomcat-diagnostic/application.json:ro,z" \
    --volume "/path/to/targets.json:/run/tomcat-diagnostic/config/targets.json:ro,z" \
    --volume "/path/to/bearer-token:/run/tomcat-diagnostic/secrets/bearer-token:ro,z" \
    --volume "/path/to/server.crt:/run/tomcat-diagnostic/tls/server.crt:ro,z" \
    --volume "tomcat_logs:/run/tomcat-diagnostic/logs:ro,z" \
    --volume "diagnostic_data:/var/lib/tomcat-diagnostic:z" \
    localhost/tomcat-diagnostic-service:0.1.7
```

---

## 🌐 Rules API Specification (Curated & Custom Rules)

- **Base URL:** `https://diagnostic-service:8443`
- **Header Wajib:** `Authorization: Bearer <token>`

| Method | Endpoint | Deskripsi | Status Code |
| :---: | :--- | :--- | :--- | :---: |
| `POST` | `/api/v1/rules` | Ingest Declarative Rulepack baru (Hot-Reload) | `201 Created` / `400` / `401` / `409` / `413` |
| `GET` | `/api/v1/rules` | Ekspor seluruh katalog aturan aktif di sistem | `200 OK` / `401 Unauthorized` |
| `GET` | `/api/v1/rules?category=<name>` | Ekspor aturan spesifik berdasarkan domain kategori | `200 OK` / `401 Unauthorized` |
| `GET` | `/api/v1/rules/:id` | Ekspor aturan spesifik berdasarkan Branch / ID | `200 OK` / `404 Not Found` |
| `PUT/DELETE` | `/api/v1/rules/*` | Upaya modifikasi/penghapusan (Ditolak) | `405 Method Not Allowed` |

---

## 📦 Toolchain & Standar Lingkungan

- **Runtime:** Node.js `24.18.0` (ESM JavaScript murni).
- **Test Runner:** Built-in `node:test` dan `node:assert`.
- **Database:** Built-in `node:sqlite` (SQLite 3 synchronous engine).
- **JSON Schema Validator:** Exact-pinned `ajv@8.20.0`.
- **SMTP Client:** Exact-pinned `nodemailer@9.0.6`.
- **Base Container Image:** `localhost/nodejs:24.18.0` (Digest pinned).
- **Kepatuhan Arsitektur (ADR):**
  - [TM-ADR-0013](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/adr-records/TM-ADR-0013.md) — *Node.js 24 ESM & Isolated Built-in `node:sqlite`*
  - [TM-ADR-0014](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/adr-records/TM-ADR-0014.md) — *Enforce Zero Automatic Remediation for Diagnostic Service*
  - [TM-ADR-0015](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/adr-records/TM-ADR-0015.md) — *Asynchronous Webhook Ingestion with Durable SQLite Acceptance Pattern*
  - [TM-ADR-0016](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/adr-records/TM-ADR-0016.md) — *Designate Diagnostic Service as Canonical Incident Notification Authority*
  - [TM-ADR-0017](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/adr-records/TM-ADR-0017.md) — *Adopt Vertical Slice Minimum Viable Product Scoping for Diagnostic Pilot*
  - [TM-ADR-0018](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/adr-records/TM-ADR-0018.md) — *Adopt Declarative Rulepack Engine with Dynamic Hot-Reloading*
  - [TM-ADR-0019](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/adr-records/TM-ADR-0019.md) — *Adopt AI-Augmented Knowledge Enrichment Workflow with Human-in-the-Loop Governance*
  - [TM-ADR-0020](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/adr-records/TM-ADR-0020.md) — *Adopt Diagnostic Service Self-Monitoring and Emergency Fallback Routing*
  - [TM-ADR-0021](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/adr-records/TM-ADR-0021.md) — *Adopt Layered Failure Resilience, Container Auto-Healing, and Monitoring Domain Separation*
  - [TM-ADR-0022](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/adr-records/TM-ADR-0022.md) — *Adopt Multi-Tier Dynamic Diagnostic Routing Architecture*
  - [TM-ADR-0023](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/adr-records/TM-ADR-0023.md) — *Adopt Multi-Domain Diagnostic Dispatcher and Mandatory Per-Alert Decision Engine Governance*

---

## 📂 Struktur Repositori

```text
tomcat-diagnostic-service/
├── AGENTS.md          Tata kelola agen dan batasan repositori
├── CONFIG             Metadata toolchain non-secret
├── Containerfile      Digest-pinned application container image
├── LICENSE            Lisensi eksklusif kepemilikan (Proprietary & Confidential)
├── PROJECT            Identitas project yang dapat dibaca script
├── README.md          Spesifikasi kontrak dan status implementasi
├── VERSION            Versi rilis aplikasi (saat ini: 0.1.5)
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
│   ├── application/   Diagnostic worker, Result renderer, Target registry, & Notification orchestrator
│   ├── domain/        Multi-Domain Dispatcher, 4 Domain Decision Engines, Rulepack loader, & Dynamic evaluator
│   └── server/        HTTPS server, Authentication, Routes, & Schema validators
├── test/              Unit dan temporary-SQLite integration test suites (54 unit tests)
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
PATH="$PATH:/home/eddywiyatno/.cache/opencode/bin" ./scripts/validate.sh
```

### 2. Unit & Integration Tests (54 Tests)
```bash
podman run --rm --userns=keep-id -v $(pwd):/app:Z -w /app localhost/nodejs:24.18.0 npm test
```

### 3. Container Image Build
```bash
./scripts/build.sh
./scripts/test-image.sh
```

---

## 📊 Status Implementasi & Verifikasi

| Komponen & Kapabilitas | Status | Catatan Verifikasi |
| :--- | :---: | :--- |
| **Repository Governance & Boundaries** | ✅ Selesai | Pinned toolchain, ESM, no-framework |
| **Alertmanager Ingestion & Queue** | ✅ Selesai | Webhook v4, deduplikasi, kapasitas 50 |
| **Target Isolation & Evidence Adapters**| ✅ Selesai | Allowlist targets, anti-traversal, bounded log/spool |
| **SQLite Persistence & Migrations** | ✅ Selesai | 6 migration files, zero-data loss |
| **Multi-Domain Dispatcher & Decision Engines** | ✅ Selesai | 20 built-in branches (`TD`, `AH`, `GC`, `TH`), TM-ADR-0023 |
| **Custom Rule Engine (TD-09..TD-18)**| ✅ Selesai | Dynamic rulepack evaluation & hot-reloading |
| **Rule Categorization Engine** | ✅ Selesai | 8 failure domain enums, filtering API, email label |
| **Rules API & 5-Layer Defense** | ✅ Selesai | Auth, schema, collision, size, immutability |
| **Notification Lifecycle & Bounded Retry**| ✅ Selesai | Exponential retry, suppression, material update guard |
| **SMTP Delivery & Resolved Correlation**| ✅ Selesai | Clean HTML/Text 7-section reports, Mailpit integration |
| **Persistent Lab Deployment** | ✅ Selesai | Aktif di `devops-lab` container network (v0.1.5) |
| **Automated Verification Suites** | ✅ Selesai | 100% lulus pada 54 unit test & end-to-end suites |

---

## 📖 Dokumentasi Terkait

* **Target and Evidence Contract:** [`devops-handbook/docs/projects/tomcat-monitoring/diagnostic-mvp/target-and-evidence-contract.md`](file:///home/eddywiyatno/git/devops-handbook/docs/projects/tomcat-monitoring/diagnostic-mvp/target-and-evidence-contract.md)
* **Rule Specification & Decision Matrix:** [`devops-handbook/docs/projects/tomcat-monitoring/diagnostic-mvp/tomcat-down-rule-specification.md`](file:///home/eddywiyatno/git/devops-handbook/docs/projects/tomcat-monitoring/diagnostic-mvp/tomcat-down-rule-specification.md)
* **Alertmanager Webhook Contract:** [`devops-handbook/docs/projects/tomcat-monitoring/diagnostic-mvp/alertmanager-webhook-contract.md`](file:///home/eddywiyatno/git/devops-handbook/docs/projects/tomcat-monitoring/diagnostic-mvp/alertmanager-webhook-contract.md)
* **Diagnostic Result & Confidence Contract:** [`devops-handbook/docs/projects/tomcat-monitoring/diagnostic-mvp/diagnostic-result-and-confidence-contract.md`](file:///home/eddywiyatno/git/devops-handbook/docs/projects/tomcat-monitoring/diagnostic-mvp/diagnostic-result-and-confidence-contract.md)
* **Non-Functional & Security Contract:** [`devops-handbook/docs/projects/tomcat-monitoring/diagnostic-mvp/non-functional-and-security-contract.md`](file:///home/eddywiyatno/git/devops-handbook/docs/projects/tomcat-monitoring/diagnostic-mvp/non-functional-and-security-contract.md)
* **Engineering Journal Diagnostic MVP Pilot (TN-001 s.d. TN-020):** [`devops-handbook/docs/projects/tomcat-monitoring/engineering-journal/diagnostic-mvp-pilot/`](file:///home/eddywiyatno/git/devops-handbook/docs/projects/tomcat-monitoring/engineering-journal/diagnostic-mvp-pilot/)
* **Architecture Decision Records (ADR):** [`devops-handbook/docs/adr/tomcat-monitoring/`](file:///home/eddywiyatno/git/devops-handbook/docs/adr/tomcat-monitoring/)
* **AI Knowledge Runbook:** [`devops-handbook/docs/projects/tomcat-monitoring/operations/ai-knowledge-enrichment-and-rule-management-runbook.md`](file:///home/eddywiyatno/git/devops-handbook/docs/projects/tomcat-monitoring/operations/ai-knowledge-enrichment-and-rule-management-runbook.md)

---

## 👤 Author & Maintainer

* **Lead Engineer & Creator:** Eddy Wiyatno (<edkas07@gmail.com>)
* **Role:** Senior DevOps & Reliability Engineer
* **Project:** Tomcat Monitoring & Diagnostics Platform

---

## 📄 License & Intellectual Property Notice

**PROPRIETARY AND CONFIDENTIAL**
**Hak Cipta © 2026 Eddy Wiyatno. Seluruh hak dilindungi undang-undang.**

Seluruh ide, diagram, arsitektur sistem, dan spesifikasi teknis dalam repositori ini merupakan hak kekayaan intelektual (HKI) eksklusif milik **Eddy Wiyatno**. Dilarang keras menyalin, merekayasa balik (*reverse-engineering*), menyebarluaskan, atau memanfaatkannya untuk kepentingan pihak ketiga tanpa persetujuan tertulis resmi dari pemilik hak cipta. Lihat berkas [`LICENSE`](LICENSE) untuk pernyataan lengkap.
