/**
 * @file test/unit/stale-lock-and-retention.test.js
 * @project Tomcat Diagnostic Service
 * @description Pengujian unit untuk mekanisme Stale Lock Recovery dan SQLite Retention Pruning (TASK-TM-004, TASK-TM-005).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { SqliteRepository } from "../../src/adapters/sqlite-repository.js";
import { BoundedWorkQueue } from "../../src/application/bounded-queue.js";
import { ingestAlertmanager, targetKey } from "../../src/application/ingest-alertmanager.js";
import { createWebhookValidator } from "../../src/server/webhook-schema.js";
import { webhook } from "../fixtures/alertmanager-webhook.js";

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(capacity = 50) {
  const directory = mkdtempSync(join(tmpdir(), "diagnostic-resilience-"));
  directories.push(directory);
  const path = join(directory, "diagnostic.db");
  const repository = new SqliteRepository(path, { migrationsDirectory: resolve("migrations") });
  const queue = new BoundedWorkQueue(repository, { capacity });
  const validate = createWebhookValidator(resolve("config/schemas/alertmanager-webhook-v4.schema.json"));
  const allowedTargets = new Set([targetKey({ environment: "lab", host: "tomcat-01", tomcat_instance: "default" })]);
  return { path, repository, queue, validate, allowedTargets };
}

test("claimNext sets lease_expires_at and started_at properly", () => {
  const { repository, queue, validate, allowedTargets } = fixture();
  const options = { queue, validate, allowedTargets, now: () => new Date("2026-09-10T10:00:00Z") };
  ingestAlertmanager(webhook(), options);

  const claimTime = new Date("2026-09-10T10:05:00Z");
  const claimed = repository.claimNext({ timeoutMs: 60000, now: claimTime });
  assert.ok(claimed);
  assert.equal(claimed.id, 1);

  const row = repository.database.prepare("SELECT state, started_at, lease_expires_at, retry_count FROM work_queue WHERE id = 1").get();
  assert.equal(row.state, "processing");
  assert.equal(row.started_at, "2026-09-10T10:05:00.000Z");
  assert.equal(row.lease_expires_at, "2026-09-10T10:06:00.000Z");
  assert.equal(row.retry_count, 0);

  repository.close();
});

test("recoverStaleLocks re-queues expired processing items and increments retry_count", () => {
  const { repository, queue, validate, allowedTargets } = fixture();
  const options = { queue, validate, allowedTargets, now: () => new Date("2026-09-10T10:00:00Z") };
  ingestAlertmanager(webhook(), options);

  // Claim at 10:00 with 60s timeout -> expires at 10:01
  repository.claimNext({ timeoutMs: 60000, now: new Date("2026-09-10T10:00:00Z") });

  // Check at 10:00:30 (not expired yet)
  const earlyRecovery = repository.recoverStaleLocks({ timeoutMs: 60000, maxRetries: 3, now: new Date("2026-09-10T10:00:30Z") });
  assert.equal(earlyRecovery.recoveredCount, 0);
  assert.equal(earlyRecovery.exhaustedCount, 0);

  // Check at 10:02:00 (expired!)
  const staleRecovery = repository.recoverStaleLocks({ timeoutMs: 60000, maxRetries: 3, now: new Date("2026-09-10T10:02:00Z") });
  assert.equal(staleRecovery.recoveredCount, 1);
  assert.equal(staleRecovery.exhaustedCount, 0);

  const row = repository.database.prepare("SELECT state, started_at, lease_expires_at, retry_count FROM work_queue WHERE id = 1").get();
  assert.equal(row.state, "queued");
  assert.equal(row.started_at, null);
  assert.equal(row.lease_expires_at, null);
  assert.equal(row.retry_count, 1);

  // Can be claimed again
  const reclaimed = repository.claimNext({ timeoutMs: 60000, now: new Date("2026-09-10T10:03:00Z") });
  assert.ok(reclaimed);
  assert.equal(reclaimed.id, 1);

  repository.close();
});

test("recoverStaleLocks marks item as failed when maxRetries is reached", () => {
  const { repository, queue, validate, allowedTargets } = fixture();
  const options = { queue, validate, allowedTargets, now: () => new Date("2026-09-10T10:00:00Z") };
  ingestAlertmanager(webhook(), options);

  // Simulate retry_count = 2 and maxRetries = 2
  repository.database.prepare("UPDATE work_queue SET state = 'processing', started_at = '2026-09-10T09:00:00.000Z', lease_expires_at = '2026-09-10T09:05:00.000Z', retry_count = 2 WHERE id = 1").run();

  const recovery = repository.recoverStaleLocks({ timeoutMs: 60000, maxRetries: 2, now: new Date("2026-09-10T10:00:00Z") });
  assert.equal(recovery.recoveredCount, 0);
  assert.equal(recovery.exhaustedCount, 1);

  const row = repository.database.prepare("SELECT state, completed_at FROM work_queue WHERE id = 1").get();
  assert.equal(row.state, "failed");
  assert.equal(row.completed_at, "2026-09-10T10:00:00.000Z");

  // Should not be claimable
  assert.equal(repository.claimNext(), null);

  repository.close();
});

test("pruneHistoricalRecords removes expired records in foreign key order and preserves active ones", () => {
  const { repository, queue, validate, allowedTargets } = fixture();
  
  // 1. Ingest old resolved incident (40 days ago)
  const oldDate = "2026-08-01T00:00:00.000Z";
  const optionsOld = { queue, validate, allowedTargets, now: () => new Date(oldDate) };
  ingestAlertmanager(webhook({ alert: { fingerprint: "old-incident-1", startsAt: oldDate, endsAt: oldDate, status: "resolved" } }), optionsOld);

  // Claim and complete old item
  const oldItem = repository.claimNext({ now: new Date(oldDate) });
  assert.ok(oldItem);
  repository.saveCanonicalResult(oldItem.id, {
    diagnosticId: "diag-old-1",
    schemaVersion: 1,
    processingStatus: "completed",
    assessment: { classification: "orderly_shutdown", confidence: "high", ruleId: "TD-01" },
    resultHash: "hash-old-1",
    evidence: [{ evidenceId: "ev-1", source: "test", status: "collected" }],
    timing: { completedAt: oldDate }
  });
  repository.complete(oldItem.id, true);

  // 2. Ingest recent firing incident (1 day ago)
  const recentDate = "2026-09-09T00:00:00.000Z";
  const optionsRecent = { queue, validate, allowedTargets, now: () => new Date(recentDate) };
  ingestAlertmanager(webhook({ alert: { fingerprint: "recent-incident-1", startsAt: recentDate, status: "firing" } }), optionsRecent);

  // Run pruning with retentionDays = 30 at 2026-09-10
  const pruneResult = repository.pruneHistoricalRecords({ retentionDays: 30, now: new Date("2026-09-10T00:00:00.000Z") });
  assert.equal(pruneResult.prunedEvents, 1);
  assert.equal(pruneResult.prunedResults, 1);
  assert.equal(pruneResult.prunedRequests, 1);
  assert.equal(pruneResult.prunedIncidents, 1);

  // Verify recent incident is still intact
  const remainingEvents = repository.database.prepare("SELECT count(*) AS count FROM events").get().count;
  assert.equal(remainingEvents, 1);
  const remainingIncidents = repository.database.prepare("SELECT count(*) AS count FROM incidents WHERE fingerprint = 'recent-incident-1'").get().count;
  assert.equal(remainingIncidents, 1);

  // Check getDatabaseSizeBytes returns valid byte count
  const sizeBytes = repository.getDatabaseSizeBytes();
  assert.ok(sizeBytes > 0);

  repository.close();
});
