import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { SqliteRepository } from "../../src/adapters/sqlite-repository.js";
import { BoundedWorkQueue } from "../../src/application/bounded-queue.js";
import { DiagnosticWorker } from "../../src/application/diagnostic-worker.js";
import { createEvidence } from "../../src/domain/evidence.js";
import { ingestAlertmanager, targetKey } from "../../src/application/ingest-alertmanager.js";
import { createWebhookValidator } from "../../src/server/webhook-schema.js";
import { webhook } from "../fixtures/alertmanager-webhook.js";

let directory; afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = null; });
test("single worker persists canonical result before completing queue item", async () => {
  directory = mkdtempSync(join(tmpdir(), "diagnostic-worker-"));
  const repository = new SqliteRepository(join(directory, "db.sqlite"), { migrationsDirectory: resolve("migrations") });
  const queue = new BoundedWorkQueue(repository);
  ingestAlertmanager(webhook(), { queue, validate: createWebhookValidator(resolve("config/schemas/alertmanager-webhook-v4.schema.json")), allowedTargets: new Set([targetKey({ environment: "lab", host: "tomcat-01", tomcat_instance: "default" })]), now: () => new Date("2026-08-31T01:01:00Z") });
  const collect = async (event) => [createEvidence({ source: "fixture", type: "container_state", targetId: event.targetId, observedAt: "2026-08-31T01:00:00Z", collectedAt: "2026-08-31T01:01:00Z", status: "collected", strength: "direct", value: { state: "exited" } })];
  const worker = new DiagnosticWorker(repository, collect, { clock: () => new Date("2026-08-31T01:02:00Z") });
  const result = await worker.runOnce();
  assert.equal(result.assessment.branch, "TD-06");
  assert.equal(repository.database.prepare("SELECT count(*) count FROM canonical_results").get().count, 1);
  assert.equal(repository.database.prepare("SELECT state FROM work_queue").get().state, "completed");
  assert.equal(repository.reserveMaterialUpdate("abc123"), true);
  assert.equal(repository.reserveMaterialUpdate("abc123"), false);
  repository.close();
});
