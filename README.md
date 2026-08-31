# Tomcat Diagnostic Service

Repository ini memiliki aplikasi Diagnostic Service untuk pilot Tomcat
Monitoring. Service akan menerima alert `TomcatDown`, melakukan korelasi
evidence yang dibatasi, menyimpan lifecycle diagnosis pada SQLite, dan
membentuk notification content. Service tidak melakukan automatic remediation
atau mengendalikan container Tomcat.

Baseline saat ini hanya menyediakan governance, metadata dependency-free, dan
static validation. HTTP ingestion, persistence, diagnostic engine, evidence
adapter, notification renderer, image lifecycle, dan runtime belum
diimplementasikan atau diverifikasi.

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

Exact JSON Schema validator dan SMTP client belum dipilih. Baseline ini tidak
memasang dependency aplikasi dan tidak memerlukan akses network.

## Struktur Baseline

```text
tomcat-diagnostic-service/
├── AGENTS.md          Governance dan repository boundary
├── CONFIG             Metadata toolchain non-secret
├── PROJECT            Identitas project yang dapat dibaca script
├── README.md          Contract dan status implementasi
├── VERSION            Versi aplikasi baseline
├── package.json       Contract package ESM dependency-free
├── package-lock.json  Dependency lock baseline
└── scripts/
    └── validate.sh    Static validation tanpa network atau container
```

Direktori `config/schemas`, `migrations`, `src`, dan `test` dibuat pada TN
implementasi pemiliknya ketika sudah memiliki artifact nyata. Placeholder
directory tidak digunakan hanya untuk merepresentasikan rencana.

## Static Validation

Jalankan dari root repository:

```bash
./scripts/validate.sh
```

Validator memeriksa file wajib, metadata project dan package, exact Node.js
engine, dependency baseline, shell syntax, larangan framework/ORM/host-control
dependency, serta pola assignment secret yang tidak boleh masuk source.
Validator tidak membuktikan application behavior, SQLite durability, image
build, HTTPS, authentication, runtime health, atau monitoring integration.

## Status Implementasi

| Capability | Status |
| --- | --- |
| Repository governance | Implemented in source; not committed |
| Project and package metadata | Implemented in source; dependency-free |
| Static validation interface | Implemented in source |
| Application source and tests | Not implemented |
| SQLite migrations and persistence | Not implemented |
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
