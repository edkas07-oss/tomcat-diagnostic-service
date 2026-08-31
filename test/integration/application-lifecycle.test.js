import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { DiagnosticApplication } from "../../src/application/application.js";
import { TargetRegistry } from "../../src/application/target-registry.js";

const config = () => ({
  listen: { host: "127.0.0.1", port: 0 }, databasePath: ":memory:", tls: {}, bearerToken: "token",
  targetRegistry: new TargetRegistry([{ identity: { environment: "lab", host: "tomcat-01", tomcat_instance: "default" } }]),
  queue: { capacity: 50, pollIntervalMs: 60000 }, timeouts: { diagnosticMs: 1000, shutdownMs: 1000 }, requestLimitBytes: 262144
});

class FakeServer extends EventEmitter {
  constructor(events, { fail = false } = {}) { super(); this.events = events; this.fail = fail; this.listening = false; }
  listen() { queueMicrotask(() => { if (this.fail) this.emit("error", new Error("bind failed")); else { this.listening = true; this.emit("listening"); } }); }
  address() { return { address: "127.0.0.1", port: 9443 }; }
  close() { this.events.push("acceptance-stopped"); this.listening = false; queueMicrotask(() => this.emit("close")); }
}

test("startup failure keeps readiness false and closes the migrated database", async () => {
  const events = [];
  const repository = { close: () => events.push("database-closed") };
  const application = new DiagnosticApplication(config(), { repository, queue: {}, webhookValidator: () => true, worker: {}, server: new FakeServer(events, { fail: true }) });
  await assert.rejects(() => application.start(), /bind failed/);
  assert.equal(application.health.health().ready, false);
  assert.deepEqual(events, ["database-closed"]);
});

test("one worker loop stops before database close during graceful shutdown", async () => {
  const events = []; let calls = 0;
  const repository = { close: () => events.push("database-closed") };
  const worker = { async runOnce() { calls += 1; events.push("worker-idle"); return null; } };
  const application = new DiagnosticApplication(config(), { repository, queue: {}, webhookValidator: () => true, worker, server: new FakeServer(events) });
  await application.start();
  assert.equal(application.health.health().ready, true);
  await application.shutdown();
  assert.equal(application.accepting, false);
  assert.equal(application.health.health().ready, false);
  assert.equal(calls, 1);
  assert.deepEqual(events, ["worker-idle", "acceptance-stopped", "database-closed"]);
});
