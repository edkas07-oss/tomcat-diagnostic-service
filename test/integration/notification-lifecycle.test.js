/**
 * @file test/integration/notification-lifecycle.test.js
 * @project Tomcat Diagnostic Service
 * @description Pengujian integrasi batas siklus hidup notifikasi email (Initial Firing, Material Update Guard, Resolved Notification).
 *
 * Pseudocode Alur Pengujian:
 * --------------------------
 * 1. Test "worker sends initial, one material update, and resolved notification":
 *    a. Kirim initial alert firing -> verifikasi email notifikasi 1 terkirim (firing).
 *    b. Kirim alert firing tanpa perubahan materiil -> tidak ada email baru yang terkirim.
 *    c. Kirim alert firing dengan perubahan materiil (evidence berubah) -> email notifikasi 2 terkirim (material update).
 *    d. Kirim alert firing materiil berikutnya -> diblokir karena batas `material_update_count` = 1.
 *    e. Kirim alert resolved -> email notifikasi 3 terkirim (resolved).
 *    f. Kirim duplicate alert resolved -> diblokir karena batas `resolved_notification_count` = 1.
 * 2. Test "resolved without stored firing is explicit and still notifies":
 *    - Terima resolved alert tanpa ada histori firing sebelumnya.
 *    - Verifikasi status `resolved_without_previous_firing`, klasifikasi `undetermined`, dan 1 email notifikasi terkirim.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { SqliteRepository } from "../../src/adapters/sqlite-repository.js";
import { BoundedWorkQueue } from "../../src/application/bounded-queue.js";
import { DiagnosticWorker } from "../../src/application/diagnostic-worker.js";
import { NotificationDelivery } from "../../src/application/notification-delivery.js";
import { createEvidence } from "../../src/domain/evidence.js";
import { ingestAlertmanager, targetKey } from "../../src/application/ingest-alertmanager.js";
import { createWebhookValidator } from "../../src/server/webhook-schema.js";
import { webhook } from "../fixtures/alertmanager-webhook.js";

let directory;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = null; });

const validate = createWebhookValidator(resolve("config/schemas/alertmanager-webhook-v4.schema.json"));
const allowedTargets = new Set([targetKey({ environment: "lab", host: "tomcat-01", tomcat_instance: "default" })]);

test("worker sends initial, one material update, and resolved notification", async () => {
  directory = mkdtempSync(join(tmpdir(), "notification-lifecycle-"));
  const repository = new SqliteRepository(join(directory, "db.sqlite"), { migrationsDirectory: resolve("migrations") });
  const queue = new BoundedWorkQueue(repository);
  const sent = [];
  const notification = new NotificationDelivery(repository, { async send(result) { sent.push(result); } });
  let collection = 0;
  const collect = async (event) => {
    collection += 1;
    const unavailable = collection >= 3;
    return [createEvidence({ source: "fixture", type: "container_state", targetId: event.targetId, observedAt: "2026-08-31T01:00:00Z", collectedAt: "2026-08-31T01:01:00Z", status: unavailable ? "unavailable" : "collected", strength: "direct", value: unavailable ? null : { state: "exited" } })];
  };
  const worker = new DiagnosticWorker(repository, collect, { clock: () => new Date("2026-08-31T01:02:00Z"), notification });
  const ingest = (payload) => ingestAlertmanager(payload, { queue, validate, allowedTargets, now: () => new Date("2026-08-31T01:01:00Z") });

  ingest(webhook()); await worker.runOnce();
  ingest(webhook({ alert: { startsAt: "2026-08-31T01:03:00Z" } })); await worker.runOnce();
  ingest(webhook({ alert: { startsAt: "2026-08-31T01:04:00Z" } })); await worker.runOnce();
  ingest(webhook({ alert: { startsAt: "2026-08-31T01:05:00Z" } })); await worker.runOnce();
  const resolved = webhook({ status: "resolved", alert: { status: "resolved", startsAt: "2026-08-31T01:00:00Z", endsAt: "2026-08-31T01:06:00Z" } });
  ingest(resolved); const resolvedResult = await worker.runOnce();
  const duplicateResolved = webhook({ status: "resolved", alert: { status: "resolved", startsAt: "2026-08-31T01:00:00Z", endsAt: "2026-08-31T01:07:00Z" } });
  ingest(duplicateResolved); await worker.runOnce();

  assert.equal(collection, 4);
  assert.equal(sent.length, 3);
  assert.deepEqual(sent.map((result) => result.lifecycleStatus), ["firing", "firing", "resolved"]);
  assert.equal(resolvedResult.startsAt, "2026-08-31T01:00:00.000Z");
  assert.equal(resolvedResult.processingStatus, "partially_completed");
  assert.equal(resolvedResult.assessment.assessment, sent[1].assessment.assessment);
  assert.equal(repository.database.prepare("SELECT count(*) count FROM notification_attempts WHERE status='sent'").get().count, 3);
  assert.equal(repository.database.prepare("SELECT material_update_count FROM incidents WHERE fingerprint='abc123'").get().material_update_count, 1);
  assert.equal(repository.database.prepare("SELECT resolved_notification_count FROM incidents WHERE fingerprint='abc123'").get().resolved_notification_count, 1);
  assert.equal(repository.database.prepare("SELECT count(*) count FROM work_queue WHERE state='completed'").get().count, 6);
  repository.close();
});

test("resolved without stored firing is explicit and still notifies", async () => {
  directory = mkdtempSync(join(tmpdir(), "notification-resolved-"));
  const repository = new SqliteRepository(join(directory, "db.sqlite"), { migrationsDirectory: resolve("migrations") });
  const queue = new BoundedWorkQueue(repository); const sent = [];
  const notification = new NotificationDelivery(repository, { async send(result) { sent.push(result); } });
  const worker = new DiagnosticWorker(repository, async () => assert.fail("resolved must not collect evidence"), { notification });
  const payload = webhook({ status: "resolved", alert: { status: "resolved", endsAt: "2026-08-31T01:06:00Z" } });
  ingestAlertmanager(payload, { queue, validate, allowedTargets, now: () => new Date("2026-08-31T01:07:00Z") });
  const result = await worker.runOnce();
  assert.equal(result.processingStatus, "resolved_without_previous_firing");
  assert.equal(result.assessment.classification, "undetermined");
  assert.equal(sent.length, 1);
  repository.close();
});
