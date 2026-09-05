/**
 * @file test/component/application-startup-component.test.js
 * @project Tomcat Diagnostic Service
 * @description Pengujian level komponen startup aplikasi lengkap (HTTPS, SQLite migrasi, Readiness, Shutdown).
 *
 * Pseudocode Alur Pengujian:
 * --------------------------
 * 1. Tulis berkas fixture konfigurasi (bearer-token, targets.json, application.json).
 * 2. Muat konfigurasi aplikasi via `loadApplicationConfig()`.
 * 3. Instansiasi `DiagnosticApplication` dan jalankan `application.start()`.
 * 4. Lakukan pemanggilan HTTPS GET `/health/ready` menggunakan TLS certificate.
 * 5. Verifikasi HTTP status 200 dan payload ready = true.
 * 6. Eksekusi `application.shutdown()` dan verifikasi status accepting = false serta ready = false.
 * 7. Buka database SQLite read-only dan verifikasi seluruh skema migrasi terpasang lengkap.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { DiagnosticApplication } from "../../src/application/application.js";
import { loadApplicationConfig } from "../../src/application/config-loader.js";

const directory = process.env.TN009_COMPONENT_DIR;
function httpsCall(port, ca, path) { return new Promise((resolveCall, reject) => { const request = httpsRequest({ hostname: "127.0.0.1", port, path, ca, servername: "localhost", rejectUnauthorized: true }, (response) => { const chunks = []; response.on("data", (chunk) => chunks.push(chunk)); response.on("end", () => resolveCall({ status: response.statusCode, body: Buffer.concat(chunks).toString() })); }); request.on("error", reject); request.end(); }); }

test("configuration starts HTTPS after SQLite migration and shuts down cleanly", { skip: !directory }, async () => {
  const path = (name) => join(directory, name);
  writeFileSync(path("bearer-token"), "component-token\n", { mode: 0o600 });
  writeFileSync(path("targets.json"), JSON.stringify([{ identity: { environment: "lab", host: "tomcat-01", tomcat_instance: "default" } }]));
  const raw = {
    schemaVersion: 1, listen: { host: "127.0.0.1", port: 0 }, databasePath: path("diagnostic.sqlite"),
    tls: { certificateFile: path("server.crt"), privateKeyFile: path("server.key") }, bearerTokenFile: path("bearer-token"), targetAllowlistFile: path("targets.json"),
    smtp: { host: "127.0.0.1", port: 2525, secure: false, from: "diagnostic@example.invalid", to: "operator@example.invalid" },
    queue: { capacity: 50, pollIntervalMs: 10 }, timeouts: { diagnosticMs: 1000, smtpMs: 1000, shutdownMs: 1000 }, requestLimitBytes: 262144
  };
  writeFileSync(path("application.json"), JSON.stringify(raw));
  const config = loadApplicationConfig(path("application.json"), { schemaPath: resolve("config/schemas/application-config-v1.schema.json") });
  const application = new DiagnosticApplication(config); const address = await application.start();
  const ready = await httpsCall(address.port, config.tls.cert, "/health/ready");
  assert.equal(ready.status, 200); assert.equal(JSON.parse(ready.body).ready, true);
  await application.shutdown();
  assert.equal(application.accepting, false); assert.equal(application.health.health().ready, false);
  const database = new DatabaseSync(raw.databasePath, { readOnly: true });
  assert.deepEqual(database.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map(({ version }) => version), [1, 2, 3, 4]);
  database.close();
});
