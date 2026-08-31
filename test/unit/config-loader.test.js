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
  const { configPath } = fixture();
  const loaded = loadApplicationConfig(configPath, { schemaPath: resolve("config/schemas/application-config-v1.schema.json") });
  assert.equal(loaded.schemaVersion, 1);
  assert.equal(loaded.bearerToken, "mounted-token");
  assert.equal(loaded.tls.cert.toString(), "certificate");
  assert.equal(loaded.targetRegistry.require("lab/tomcat-01/default").identity.host, "tomcat-01");
});

test("rejects invalid configuration without exposing mounted secret", () => {
  const { configPath, config } = fixture({ requestLimitBytes: 1 });
  writeFileSync(config.bearerTokenFile, "do-not-print-this");
  assert.throws(() => loadApplicationConfig(configPath), (error) => error instanceof ConfigurationError && !String(error).includes("do-not-print-this"));
});
