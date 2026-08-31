# Repository Instructions

## Repository Purpose

Repository ini memiliki source aplikasi, dependency lock, image lifecycle,
migration, dan component test Diagnostic Service untuk Tomcat Monitoring.
Service menerima alert `TomcatDown`, menyimpan state secara durable, membentuk
diagnosis deterministik dari evidence yang dibatasi, dan menghasilkan
notification content tanpa melakukan automatic remediation.

## Source of Truth

- Gunakan dokumentasi Diagnostic MVP pada DevOps Engineering Handbook sebagai
  source contract architecture, security, persistence, evidence, result, dan
  notification.
- Gunakan `PROJECT`, `VERSION`, `CONFIG`, `package.json`, dan `package-lock.json`
  bersama untuk menentukan identitas aplikasi dan dependency baseline.
- Gunakan repository `nodejs` sebagai contract reusable base runtime; jangan
  menyalin source atau lifecycle script runtime generik ke repository ini.
- Gunakan repository `tomcat-monitoring` untuk integration configuration,
  target allowlist, deployment orchestration, dan end-to-end verification.

## Repository Boundaries

- Repository memiliki source Diagnostic Service, schema aplikasi, migration,
  SQLite adapter, diagnostic engine, renderer, application image lifecycle,
  serta unit dan component test.
- Repository tidak memiliki Prometheus atau Alertmanager configuration,
  environment-specific target allowlist, deployment inventory, certificate,
  token, SMTP credential, application WAR, maupun collector host-privileged.
- Restricted Event Collector memiliki repository dan lifecycle terpisah.
- Jangan menambahkan container control, restart, kill, configuration mutation,
  shell execution umum, atau automatic remediation.

## Working Rules

- Mulai dengan memeriksa Git status, Engineering Journal aktif, accepted ADR,
  current-state contract, dan perubahan pengguna yang beririsan.
- Kerjakan hanya approved Technical Note scope dan pertahankan unrelated user
  changes.
- Gunakan `rg` atau `rg --files` untuk pencarian dan `apply_patch` untuk edit
  manual.
- Pertahankan Node.js `24.18.0` ESM JavaScript baseline sampai perubahan
  toolchain diterima melalui decision record baru.
- Isolasi `node:sqlite` pada adapter dan pertahankan satu logical writer;
  jangan melakukan evidence collection atau SMTP delivery di dalam transaction.
- Ambil target identity dan filesystem path hanya dari validated local
  configuration; jangan mempercayai nilai target atau path dari webhook.

## Approval Requirements

- Read-only inspection yang relevan dapat dilakukan tanpa approval tambahan.
- Source, dependency, schema, migration, configuration, atau documentation
  change memerlukan approved implementation plan dan explicit scope.
- Dependency installation, image build, component test, container, network,
  volume, database mutation, dan integration test memerlukan authorization
  eksplisit sesuai targetnya.
- Cleanup container, image, volume, database, fixture, atau generated artifact
  memerlukan exact target dan destructive-action approval.

## Verification

- Jalankan `./scripts/validate.sh` setelah contract atau source baseline berubah.
- Jalankan `npm test` setelah unit atau local integration implementation tersedia.
- Setelah shell script berubah, jalankan `bash -n scripts/*.sh`.
- Bedakan static validation, unit test, local integration test, image build,
  component test, dan end-to-end monitoring verification.
- Jangan menyatakan runtime sehat, persistence verified, atau notification
  berhasil berdasarkan static validation atau evidence Technical Note lama.
- Catat expected result, actual result, environment, artifact identity, dan
  evidence untuk setiap klaim teknis.

## Git and External State

- Jangan commit, push, membuat tag atau release, memublikasikan image, atau
  deploy tanpa authorization terpisah.
- Izin mengedit tidak mengizinkan build, test runtime, cleanup, commit, atau
  push secara otomatis.
- Jangan reset, checkout, atau menimpa perubahan pengguna.
- Perlakukan registry, container runtime, certificate store, monitoring stack,
  Mailpit, dan production host sebagai external state terpisah.

## Secrets and Sensitive Data

- Jangan menyimpan password, token, private key, certificate, credential,
  environment-specific target, atau unsanitized evidence di source, image,
  Git, output command, test fixture, maupun log.
- Gunakan placeholder dan secret reference. Jangan mencetak bearer token,
  SMTP credential, request body mentah, arbitrary log tail, atau sensitive
  metric label.
- Hentikan pekerjaan jika diagnostic output atau build context berisiko
  memasukkan sensitive material.

## Documentation Handoff

- Perbarui `README.md` bila public application atau operator contract berubah.
- Catat aktivitas dan evidence pada Engineering Journal Tomcat Monitoring.
- Buat atau tautkan ADR jika perubahan mengubah architecture, security,
  persistence, ownership, atau downstream integration contract secara
  signifikan.
- Konsolidasikan kondisi yang berlaku ke current-state project documentation;
  jangan menggandakan histori panjang pada README.

## Stop Conditions

Berhenti dan minta direction jika accepted contract bertentangan, scope perlu
diperluas, dependency belum direview, immutable base identity dibutuhkan namun
belum diterima, target atau cleanup ambigu, perubahan pengguna beririsan,
secret berisiko terekspos, atau evidence tidak cukup untuk klaim keberhasilan.
