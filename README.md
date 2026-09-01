# Tomcat Diagnostic Service

Repository ini memiliki aplikasi Diagnostic Service untuk pilot Tomcat
Monitoring. Service akan menerima alert `TomcatDown`, melakukan korelasi
evidence yang dibatasi, menyimpan lifecycle diagnosis pada SQLite, dan
membentuk notification content. Service tidak melakukan automatic remediation
atau mengendalikan container Tomcat.

Source saat ini menyediakan schema webhook Alertmanager v4, migration SQLite,
durable event ingestion, deduplication, serta queue persisten berkapasitas 50.
Target registry, bounded evidence adapters, deterministic `TomcatDown` decision
table, single worker, canonical-result persistence, health/metrics model, dan
seven-section renderers juga tersedia. HTTPS request boundary dan SMTP adapter
telah lulus ephemeral socket component tests. Versioned application
configuration, mounted-file secret loading, startup lifecycle, single worker
loop, dan Prometheus text serialization tersedia pada source.
Application image lifecycle memakai immutable local Node.js base digest pada
TN-010. Persistent runtime, Mailpit integration, dan end-to-end flow belum
diverifikasi.

## Batas Tanggung Jawab

Repository ini akan memiliki source aplikasi, dependency lock, JSON Schema,
migration, SQLite adapter, diagnostic engine, renderer, image lifecycle, unit
test, dan component test. Integration configuration, target allowlist,
certificate serta secret injection, deployment orchestration, dan end-to-end
verification tetap dimiliki repository `tomcat-monitoring`.

Restricted Event Collector tidak berada di repository ini. Diagnostic Service
tidak boleh menjalankan arbitrary shell command, restart, kill, configuration
change, atau tindakan pemulihan otomatis.

## Toolchain yang Diterima

- Node.js `24.18.0` dengan ESM JavaScript;
- built-in `node:test` untuk test runner;
- isolated built-in `node:sqlite` untuk pilot setelah persistence
  diimplementasikan; dan
- reusable base image `localhost/nodejs:24.18.0`, dengan immutable build
  identity ditetapkan sebelum image build dijalankan.

JSON Schema memakai exact-pinned `ajv@8.20.0`; SMTP memakai exact-pinned
`nodemailer@9.0.6`.

## Struktur Source

```text
tomcat-diagnostic-service/
├── AGENTS.md          Governance dan repository boundary
├── CONFIG             Metadata toolchain non-secret
├── Containerfile      Digest-pinned application image
├── PROJECT            Identitas project yang dapat dibaca script
├── README.md          Contract dan status implementasi
├── VERSION            Versi aplikasi baseline
├── package.json       Contract package ESM dan Ajv
├── package-lock.json  Dependency lock
├── config/schemas/    Versioned webhook dan application configuration schema
├── migrations/        Forward-only SQLite migration
├── src/               Ingestion, queue, dan SQLite adapter
├── test/              Unit dan temporary-SQLite integration test
└── scripts/
    ├── build.sh       Build versioned dan latest local image
    ├── test-image.sh  Static runtime/image contract probes
    ├── test-image-component.sh  Disposable HTTPS/SQLite/signal test
    └── validate.sh    Static validation tanpa network atau container
```

## Static Validation

Jalankan dari root repository:

```bash
./scripts/validate.sh
```

Validator memeriksa file wajib, metadata project dan package, exact Node.js
engine dan Ajv, shell syntax, larangan framework/ORM/host-control dependency,
serta pola assignment secret yang tidak boleh masuk source.
Validator tidak membuktikan application behavior, SQLite durability, image
build, HTTPS, authentication, runtime health, atau monitoring integration.

## Application Configuration dan Startup

Jalankan aplikasi dengan satu absolute configuration path:

```bash
npm start -- --config /run/tomcat-diagnostic/application.json
```

`application-config-v1.schema.json` menentukan database path, listen address,
TLS certificate/private-key file, bearer-token file, target-allowlist file,
SMTP endpoint dan optional credential files, queue, timeout, serta request
limit. JSON application configuration tidak boleh berisi token, password,
certificate, atau private key. Nilai sensitif dibaca saat startup dari mounted
file yang direferensikan menggunakan absolute normalized path.

Startup memvalidasi seluruh input, membuka SQLite dan menjalankan forward-only
migration, memulai HTTPS, mengubah readiness menjadi ready, lalu menjalankan
tepat satu sequential diagnostic worker loop. `SIGTERM` dan `SIGINT`
menghentikan request acceptance dan readiness sebelum server/worker dihentikan;
database ditutup terakhir.

## Image Lifecycle

`CONFIG` mem-pin reusable local base menggunakan OCI digest dan image ID.
Build menolak base dengan identity berbeda, memasang dependency dari
`package-lock.json`, dan menghasilkan dua tag lokal:

```bash
./scripts/build.sh
./scripts/test-image.sh
```

Image menggunakan user `node`, working directory `/app`, port deklaratif
`8443`, serta startup command yang membaca
`/run/tomcat-diagnostic/application.json`. Certificate, private key, bearer
token, allowlist, dan SQLite database tidak berada di image; seluruhnya harus
diberikan melalui mount runtime.

Disposable image-level verification memerlukan exact temporary directory yang
berisi `server.crt` dan `server.key`:

```bash
./scripts/test-image-component.sh /tmp/tomcat-diagnostic-component
```

Script menghapus exact test container melalui trap, tetapi caller tetap
bertanggung jawab menghapus temporary directory setelah evidence dicatat.

## Runtime Consumption Contract

Integration runtime harus mengonsumsi image menggunakan exact digest, bukan
tag mutable:

```text
localhost/tomcat-diagnostic-service@sha256:a849a9e39a49ffcacb11733b0ad19e5e5f29c10451f8fd284f2b218f71c2dff1
```

Application JSON dipasang read-only pada
`/run/tomcat-diagnostic/application.json`. File tersebut menunjuk exact
container paths berikut:

| Artifact | Container path | Access |
| --- | --- | --- |
| Target allowlist | `/run/tomcat-diagnostic/config/targets.json` | Read-only |
| TLS certificate | `/run/tomcat-diagnostic/tls/server.crt` | Read-only |
| TLS private key | `/run/tomcat-diagnostic/tls/server.key` | Read-only |
| Bearer token | `/run/tomcat-diagnostic/secrets/bearer-token` | Read-only |
| Optional SMTP username/password | `/run/tomcat-diagnostic/secrets/smtp-username` and `smtp-password` | Read-only |
| SQLite directory | `/var/lib/tomcat-diagnostic` | Read-write |
| SQLite database | `/var/lib/tomcat-diagnostic/diagnostic.db` | Runtime-created |

Image berjalan sebagai user `node`. Runtime owner wajib membuktikan user
tersebut dapat membaca mounted inputs dan membuat serta mengunci SQLite pada
exact image digest. Configuration, allowlist, certificate, dan secret tetap
dimiliki integration/non-Git storage; repository ini hanya memiliki schema,
loader, migration, dan application lifecycle.

Exact values, host modes, ownership, disposable multi-component topology, dan
cleanup gate berada pada handbook
`diagnostic-mvp/runtime-configuration-and-verification-contract.md`.

Source terbaru menghubungkan canonical result, renderer, SQLite attempt state,
dan SMTP adapter melalui satu worker. Policy pilot memakai maksimum tiga
attempts, backoff 1 dan 5 detik, maximum age 60 detik, serta existing queue
berkapasitas 50 tanpa queue kedua. Source dan ephemeral SMTP socket tests telah
lulus; image digest di atas masih artifact TN-010 dan belum membawa perubahan
source TN-012. Mailpit serta persistent runtime tetap belum diverifikasi.

## Status Implementasi

| Capability | Status |
| --- | --- |
| Repository governance | Committed baseline |
| Project and package metadata | Implemented; exact-pinned Ajv |
| Static validation interface | Implemented in source |
| Schema, durable ingestion, and queue | Implemented in source |
| SQLite migration and restart deduplication tests | Implemented in source |
| Target isolation and bounded evidence adapters | Implemented in source |
| `TomcatDown` TD-01 through TD-08 engine | Implemented in source |
| Versioned application configuration | Implemented in source |
| HTTP server and diagnostic orchestration | Implemented in source; persistent runtime not verified |
| Notification lifecycle and bounded SMTP retry | Implemented in source; Mailpit/runtime not verified |
| Application image build and disposable component runtime | Verified in source; image digest `sha256:a849a9e39a49ffcacb11733b0ad19e5e5f29c10451f8fd284f2b218f71c2dff1` |
| Monitoring integration and end-to-end flow | Not implemented |

## Keamanan

Jangan menyimpan bearer token, SMTP credential, certificate, private key,
environment-specific target, atau unsanitized diagnostic evidence di
repository. Configuration sensitif harus diberikan melalui mekanisme secret
injection yang disetujui oleh integration owner.

## Dokumentasi Terkait

Contract arsitektur dan perjalanan implementation tersedia pada DevOps
Engineering Handbook di `docs/projects/tomcat-monitoring/diagnostic-mvp/` dan
`docs/projects/tomcat-monitoring/engineering-journal/diagnostic-mvp-pilot/`.
