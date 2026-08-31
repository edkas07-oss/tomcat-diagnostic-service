# Tomcat Diagnostic Service

Repository ini memiliki aplikasi Diagnostic Service untuk pilot Tomcat
Monitoring. Service akan menerima alert `TomcatDown`, melakukan korelasi
evidence yang dibatasi, menyimpan lifecycle diagnosis pada SQLite, dan
membentuk notification content. Service tidak melakukan automatic remediation
atau mengendalikan container Tomcat.

Source saat ini menyediakan schema webhook Alertmanager v4, migration SQLite,
durable event ingestion, deduplication, serta queue persisten berkapasitas 50.
Target registry, bounded evidence adapters, dan deterministic `TomcatDown`
decision table juga tersedia. HTTP/TLS server, notification renderer, image
lifecycle, dan runtime belum diimplementasikan atau diverifikasi.

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

JSON Schema memakai exact-pinned `ajv@8.20.0`. SMTP client belum dipilih.

## Struktur Source

```text
tomcat-diagnostic-service/
├── AGENTS.md          Governance dan repository boundary
├── CONFIG             Metadata toolchain non-secret
├── PROJECT            Identitas project yang dapat dibaca script
├── README.md          Contract dan status implementasi
├── VERSION            Versi aplikasi baseline
├── package.json       Contract package ESM dan Ajv
├── package-lock.json  Dependency lock
├── config/schemas/    Versioned webhook schema
├── migrations/        Forward-only SQLite migration
├── src/               Ingestion, queue, dan SQLite adapter
├── test/              Unit dan temporary-SQLite integration test
└── scripts/
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
| HTTP server and diagnostic orchestration | Not implemented |
| Image build and component runtime | Not implemented |
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
