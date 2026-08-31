import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { BoundedWorkQueue, QueueCapacityError } from "../../src/application/bounded-queue.js";
import { ingestAlertmanager, targetKey } from "../../src/application/ingest-alertmanager.js";
import { MigrationError, SqliteRepository } from "../../src/adapters/sqlite-repository.js";
import { createWebhookValidator } from "../../src/server/webhook-schema.js";
import { webhook } from "../fixtures/alertmanager-webhook.js";

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(capacity = 50) {
  const directory = mkdtempSync(join(tmpdir(), "diagnostic-ingestion-"));
  directories.push(directory);
  const path = join(directory, "diagnostic.db");
  const repository = new SqliteRepository(path, { migrationsDirectory: resolve("migrations") });
  const queue = new BoundedWorkQueue(repository, { capacity });
  const validate = createWebhookValidator(resolve("config/schemas/alertmanager-webhook-v4.schema.json"));
  const allowedTargets = new Set([targetKey({ environment: "lab", host: "tomcat-01", tomcat_instance: "default" })]);
  return { path, repository, queue, validate, allowedTargets };
}

test("commits before acceptance and suppresses duplicate work across reopen", () => {
  const item = fixture();
  const options = { ...item, now: () => new Date("2026-08-31T01:01:00Z") };
  const accepted = ingestAlertmanager(webhook(), options);
  assert.equal(accepted.events[0].duplicate, false);
  item.repository.close();

  const reopened = new SqliteRepository(item.path, { migrationsDirectory: resolve("migrations") });
  item.repository = reopened;
  item.queue = new BoundedWorkQueue(reopened);
  const duplicate = ingestAlertmanager(webhook(), { ...options, queue: item.queue });
  assert.equal(duplicate.events[0].duplicate, true);
  assert.equal(item.queue.claim().event_id, 1);
  assert.equal(item.queue.claim(), null);
  reopened.close();
});

test("rolls back the request when queue capacity is exhausted", () => {
  const item = fixture(1);
  const options = { ...item, now: () => new Date("2026-08-31T01:01:00Z") };
  ingestAlertmanager(webhook(), options);
  const next = webhook({ alert: { fingerprint: "def456", startsAt: "2026-08-31T01:02:00Z" } });
  assert.throws(() => ingestAlertmanager(next, options), QueueCapacityError);
  assert.equal(item.repository.database.prepare("SELECT count(*) AS count FROM requests").get().count, 1);
  item.repository.close();
});

test("correlates firing and resolved events to one incident", () => {
  const item = fixture();
  const options = { ...item, now: () => new Date("2026-08-31T01:01:00Z") };
  ingestAlertmanager(webhook(), options);
  const resolved = webhook({ alert: { status: "resolved", endsAt: "2026-08-31T01:03:00Z" } });
  ingestAlertmanager(resolved, options);
  const incident = item.repository.database.prepare("SELECT state, resolved_at FROM incidents WHERE fingerprint = ?").get("abc123");
  assert.equal(incident.state, "resolved");
  assert.equal(incident.resolved_at, "2026-08-31T01:03:00.000Z");
  item.repository.close();
});

test("rolls back a failed forward migration", () => {
  const directory = mkdtempSync(join(tmpdir(), "diagnostic-migration-"));
  directories.push(directory);
  const migrations = join(directory, "migrations");
  mkdirSync(migrations);
  writeFileSync(join(migrations, "001-broken.sql"), "CREATE TABLE incomplete (");
  assert.throws(
    () => new SqliteRepository(join(directory, "diagnostic.db"), { migrationsDirectory: migrations }),
    MigrationError
  );
});
