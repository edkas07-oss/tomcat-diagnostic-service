/**
 * @file test/component/image-runtime-fixture.js
 * @project Tomcat Diagnostic Service
 * @description Generator fixture konfigurasi non-secret untuk pengujian container image runtime.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. Ambil path direktori runtime dari argumen baris perintah.
 * 2. Tulis berkas bearer-token dengan izin 0600.
 * 3. Tulis berkas targets.json allowlist untuk target component.
 * 4. Tulis berkas application.json lengkap dengan skema listen 8443, path database, TLS, dan SMTP.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2];
if (!directory) throw new TypeError("component directory is required");

writeFileSync(join(directory, "bearer-token"), "tn010-component-token\n", { mode: 0o600 });
writeFileSync(join(directory, "targets.json"), JSON.stringify([
  { identity: { environment: "component", host: "tomcat-01", tomcat_instance: "default" } }
]));
writeFileSync(join(directory, "application.json"), JSON.stringify({
  schemaVersion: 1,
  listen: { host: "0.0.0.0", port: 8443 },
  databasePath: "/run/tomcat-diagnostic/diagnostic.sqlite",
  tls: { certificateFile: "/run/tomcat-diagnostic/server.crt", privateKeyFile: "/run/tomcat-diagnostic/server.key" },
  bearerTokenFile: "/run/tomcat-diagnostic/bearer-token",
  targetAllowlistFile: "/run/tomcat-diagnostic/targets.json",
  smtp: { host: "127.0.0.1", port: 2525, secure: false, from: "diagnostic@example.invalid", to: "operator@example.invalid" },
  queue: { capacity: 50, pollIntervalMs: 25 },
  timeouts: { diagnosticMs: 1000, smtpMs: 1000, shutdownMs: 2000 },
  requestLimitBytes: 262144
}));
