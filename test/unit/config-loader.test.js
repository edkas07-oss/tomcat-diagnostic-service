/**
 * @file test/unit/config-loader.test.js
 * @project Tomcat Diagnostic Service
 * @description Pengujian unit pemuat konfigurasi aplikasi dan isolasi rahasia file mounted.
 *
 * Pseudocode Alur Pengujian:
 * --------------------------
 * 1. Test "loads versioned non-secret configuration and mounted files":
 *    - Buat berkas-berkas mounted fixture (server.crt, bearer-token, targets.json, application.json).
 *    - Muat konfigurasi via `loadApplicationConfig()`.
 *    - Verifikasi schemaVersion = 1, bearerToken ter-trim rapi, dan targetRegistry terinisialisasi.
 * 2. Test "rejects invalid configuration without exposing mounted secret":
 *    - Buat konfigurasi dengan nilai tidak valid (`requestLimitBytes: 1`).
 *    - Verifikasi lemparan `ConfigurationError` tanpa membeberkan isi rahasia `do-not-print-this` pada pesan error.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { ConfigurationError, loadApplicationConfig } from "../../src/application/config-loader.js";

let directory;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined; });

function fixture(overrides = {}) {
  directory = mkdtempSync(join(tmpdir(), "diagnostic-config-"));
  const file = (name, value) => { const path = join(directory, name); writeFileSync(path, value); return path; };
  const config = {
    schemaVersion: 1, listen: { host: "127.0.0.1", port: 0 }, databasePath: join(directory, "diagnostic.sqlite"),
    tls: { certificateFile: file("server.crt", "certificate"), privateKeyFile: file("server.key", "private-key") },
    bearerTokenFile: file("bearer-token", "mounted-token\n"),
    targetAllowlistFile: file("targets.json", JSON.stringify([{ identity: { environment: "lab", host: "tomcat-01", tomcat_instance: "default" } }])),
    smtp: { host: "127.0.0.1", port: 2525, secure: false, from: "diagnostic@example.invalid", to: "operator@example.invalid" },
    queue: { capacity: 50, pollIntervalMs: 10 }, timeouts: { diagnosticMs: 1000, smtpMs: 1000, shutdownMs: 1000 }, requestLimitBytes: 262144,
    ...overrides
  };
  const configPath = file("application.json", JSON.stringify(config));
  return { configPath, config };
}

test("loads versioned non-secret configuration and mounted files", () => {
  const { configPath } = fixture({
    prometheus: { baseUrl: "http://prometheus.local:9090" },
    timeouts: { diagnosticMs: 1000, smtpMs: 1000, shutdownMs: 1000, prometheusMs: 5000 }
  });
  const loaded = loadApplicationConfig(configPath, { schemaPath: resolve("config/schemas/application-config-v1.schema.json") });
  assert.equal(loaded.schemaVersion, 1);
  assert.equal(loaded.bearerToken, "mounted-token");
  assert.equal(loaded.tls.cert.toString(), "certificate");
  assert.equal(loaded.targetRegistry.require("lab/tomcat-01/default").identity.host, "tomcat-01");
  assert.equal(loaded.prometheus.baseUrl, "http://prometheus.local:9090");
  assert.equal(loaded.timeouts.prometheusMs, 5000);
});

test("rejects invalid configuration without exposing mounted secret", () => {
  const { configPath, config } = fixture({ requestLimitBytes: 1 });
  writeFileSync(config.bearerTokenFile, "do-not-print-this");
  assert.throws(() => loadApplicationConfig(configPath), (error) => error instanceof ConfigurationError && !String(error).includes("do-not-print-this"));
});
