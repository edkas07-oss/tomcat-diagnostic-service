/**
 * @file src/application/application.js
 * @project Tomcat Diagnostic Service
 * @author Eddy Wiyatno <edkas07@gmail.com>
 * @license Proprietary & Confidential
 * @description Komposer siklus hidup aplikasi (Application Lifecycle Composer).
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. createDefaultEvidenceCollector(targetRegistry):
 *    a. Cari target pada targetRegistry; jika tidak ada return `[]`.
 *    b. Hitung jendela observasi insiden `observedAt ± 5 menit`.
 *    c. Kumpulkan bukti dari collector spool (container status, process, port probe).
 *    d. Kumpulkan bukti dari file lokal (catalina log excerpt dengan redaksi secret).
 *    e. Kumpulkan bukti status HTTP /health aplikasi web.
 *    f. Kembalikan array seluruh item bukti yang berhasil dikumpulkan.
 * 2. DiagnosticApplication.constructor(config):
 *    a. Inisialisasi SqliteRepository dan jalankan skema migrasi database.
 *    b. Inisialisasi BoundedWorkQueue, SmtpAdapter, NotificationDelivery, DynamicRuleEvaluator, dan HealthMetrics.
 *    c. Muat custom rules dari database SQLite ke dalam DynamicRuleEvaluator.
 *    d. Inisialisasi DiagnosticWorker dengan concurrency = 1 (single worker).
 *    e. Konfigurasi HTTPS server internal beserta validator webhook dan rulepack.
 * 3. DiagnosticApplication.start():
 *    a. Mulai listen server HTTPS pada port 8443.
 *    b. Mulai background loop worker via `worker.start()`.
 *    c. Set status readiness menjadi true pada HealthMetrics.
 * 4. DiagnosticApplication.shutdown():
 *    a. Tolak request baru (accepting = false) dan set readiness = false.
 *    b. Hentikan worker loop secara elegan via `worker.stop()`.
 *    c. Tutup HTTPS server.
 *    d. Tutup koneksi database SQLite via `repository.close()`.
 *
 * Mengoordinasikan seluruh sub-sistem Diagnostic Service:
 * - Inisialisasi dan migrasi forward-only SQLite repository (isolated single writer).
 * - Bounded work queue (kapasitas 50) dan single diagnostic worker loop.
 * - DynamicRuleEvaluator (Layer 1 Built-in TD-01..08 + Layer 2 Ingested Rules).
 * - Bounded notification delivery via SMTP (Mailpit).
 * - Server HTTPS TLS internal dengan endpoint webhook, health, metrics, dan Rules API.
 * - Penegakan prinsip Zero Automatic Remediation (TM-ADR-0014).
 */

import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteRepository } from "../adapters/sqlite-repository.js";
import { BoundedWorkQueue } from "./bounded-queue.js";
import { DiagnosticWorker } from "./diagnostic-worker.js";
import { NotificationDelivery } from "./notification-delivery.js";
import { HealthMetrics, serializePrometheus } from "./health-metrics.js";
import { targetKey } from "./ingest-alertmanager.js";
import { createHttpsService } from "../server/http-service.js";
import { createWebhookValidator } from "../server/webhook-schema.js";
import { createRulepackValidator } from "../server/rulepack-schema.js";
import { DynamicRuleEvaluator } from "../domain/rulepack-loader.js";
import { SmtpAdapter } from "../adapters/smtp-adapter.js";
import { PrometheusAdapter } from "../adapters/prometheus-adapter.js";
import { readCollectorSpool } from "../adapters/collector-spool-adapter.js";
import { collectLocalFileEvidence } from "../adapters/local-file-evidence-adapter.js";
import { collectApplicationHealth } from "../adapters/application-health-adapter.js";

export function createDefaultEvidenceCollector(targetRegistry, { prometheusAdapter } = {}) {
  return async (event) => {
    const target = targetRegistry.targets.get(event.targetId);
    if (!target) return [];
    const now = new Date();
    const observedAt = event.startsAt ?? now.toISOString();
    const windowStart = new Date(Date.parse(observedAt) - 5 * 60 * 1000).toISOString();
    const windowEnd = new Date(Date.parse(observedAt) + 5 * 60 * 1000).toISOString();
    const window = {
      targetId: target.targetId,
      generation: event.generation,
      from: windowStart,
      to: windowEnd,
      collectedAt: now.toISOString()
    };
    const context = {
      generation: event.generation,
      observedAt,
      collectedAt: now.toISOString()
    };
    const evidence = [];
    if (target.collectorSpool) {
      const spoolEvidence = readCollectorSpool(target, window);
      const latestByType = new Map();
      for (const item of spoolEvidence) {
        const existing = latestByType.get(item.type);
        if (!existing || Date.parse(item.observedAt) >= Date.parse(existing.observedAt)) {
          latestByType.set(item.type, item);
        }
      }
      evidence.push(...latestByType.values());
    }
    if (target.prometheusSelector && prometheusAdapter) {
      try {
        const [upEv, memEv, threadsEv] = await Promise.all([
          prometheusAdapter.query(target, "up", context, { type: "jmx_scrape", strength: "supporting" }),
          prometheusAdapter.query(target, "jvm_memory_pool_used_bytes", context, { type: "jvm_memory_pool", strength: "contextual" }),
          prometheusAdapter.query(target, "tomcat_threads_busy_threads", context, { type: "tomcat_threads_busy", strength: "contextual" })
        ]);
        if (upEv) evidence.push(upEv);
        if (memEv) evidence.push(memEv);
        if (threadsEv) evidence.push(threadsEv);
      } catch {}
    }
    if (target.logDirectory) {
      evidence.push(collectLocalFileEvidence(target, context, { rootField: "logDirectory", relativePath: "catalina.out", type: "orderly_shutdown" }));
    }
    if (target.applicationHealthUrl) {
      evidence.push(await collectApplicationHealth(target, context));
    }
    return evidence;
  };
}

export class DiagnosticApplication {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.dependencies = dependencies;
    this.health = dependencies.health ?? new HealthMetrics();
    this.accepting = false;
    this.stopping = false;
  }

  async start() {
    try {
      const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
      this.repository = this.dependencies.repository ?? new SqliteRepository(this.config.databasePath, { migrationsDirectory: join(projectRoot, "migrations") });
      const staleTimeoutMs = this.config.queue?.staleLockTimeoutMs ?? 300000;
      const maxRetries = this.config.queue?.maxRetries ?? 3;
      const retentionDays = this.config.queue?.retentionDays ?? 30;

      if (typeof this.repository.recoverStaleLocks === "function") {
        const recovery = this.repository.recoverStaleLocks({ timeoutMs: staleTimeoutMs, maxRetries });
        if (recovery.recoveredCount > 0) this.health.increment("diagnostic_stale_locks_recovered_total", {}, recovery.recoveredCount);
        if (recovery.exhaustedCount > 0) this.health.increment("diagnostic_stale_locks_exhausted_total", {}, recovery.exhaustedCount);
      }

      if (typeof this.repository.pruneHistoricalRecords === "function") {
        const pruning = this.repository.pruneHistoricalRecords({ retentionDays });
        if (pruning.prunedEvents > 0) this.health.increment("diagnostic_records_pruned_total", { table: "events" }, pruning.prunedEvents);
        this.health.increment("diagnostic_housekeeping_runs_total");
      }

      if (typeof this.repository.getDatabaseSizeBytes === "function") {
        this.health.setGauge("diagnostic_db_size_bytes", this.repository.getDatabaseSizeBytes());
      }

      const initialRules = typeof this.repository.listCustomRules === "function" ? this.repository.listCustomRules() : [];
      this.ruleEvaluator = this.dependencies.ruleEvaluator ?? new DynamicRuleEvaluator(initialRules);
      const rulesValidator = this.dependencies.rulesValidator ?? createRulepackValidator(join(projectRoot, "config/schemas/rulepack-v1.schema.json"));
      const queue = this.dependencies.queue ?? new BoundedWorkQueue(this.repository, { capacity: this.config.queue.capacity });
      const validate = this.dependencies.webhookValidator ?? createWebhookValidator(join(projectRoot, "config/schemas/alertmanager-webhook-v4.schema.json"));
      const allowedTargets = new Set([...this.config.targetRegistry.targets.values()].map(({ identity }) => targetKey(identity)));
      
      if (this.dependencies.worker) this.worker = this.dependencies.worker;
      else {
        const smtp = this.dependencies.smtp ?? new SmtpAdapter(this.config.smtp);
        const notification = this.dependencies.notification ?? new NotificationDelivery(this.repository, smtp, { health: this.health });
        const prometheus = this.dependencies.prometheusAdapter ?? (this.config.prometheus ? new PrometheusAdapter({ baseUrl: this.config.prometheus.baseUrl, timeoutMs: this.config.timeouts?.prometheusMs ?? 5000 }) : null);
        const collectEvidence = this.dependencies.collectEvidence ?? createDefaultEvidenceCollector(this.config.targetRegistry, { prometheusAdapter: prometheus });
        this.worker = new DiagnosticWorker(this.repository, collectEvidence, {
          timeoutMs: this.config.timeouts.diagnosticMs,
          notification,
          evaluator: (evidence, event) => this.ruleEvaluator.evaluate(evidence, event)
        });
      }
      
      this.server = this.dependencies.server ?? createHttpsService(this.config.tls, {
        token: this.config.bearerToken,
        health: this.health,
        metricsText: () => serializePrometheus(this.health),
        requestLimitBytes: this.config.requestLimitBytes,
        accepting: () => this.accepting,
        ingestion: { queue, validate, allowedTargets },
        repository: this.repository,
        ruleEvaluator: this.ruleEvaluator,
        rulesValidator
      });
      this.server.listen(this.config.listen.port, this.config.listen.host);
      await once(this.server, "listening");
      this.accepting = true;
      this.health.setReady(true);
      this.workerLoop = this.runWorkerLoop();
      return this.server.address();
    } catch (error) {
      this.health.setReady(false);
      if (this.repository) this.repository.close();
      throw error;
    }
  }

  async runWorkerLoop() {
    const staleIntervalMs = (this.config.queue?.staleLockTimeoutMs ?? 300000) / 2;
    const housekeepingIntervalMs = this.config.queue?.housekeepingIntervalMs ?? 3600000;
    let lastStaleCheckAt = Date.now();
    let lastHousekeepingAt = Date.now();

    while (!this.stopping) {
      try {
        const now = Date.now();
        if (now - lastStaleCheckAt >= staleIntervalMs) {
          lastStaleCheckAt = now;
          if (typeof this.repository.recoverStaleLocks === "function") {
            const recovery = this.repository.recoverStaleLocks({
              timeoutMs: this.config.queue?.staleLockTimeoutMs ?? 300000,
              maxRetries: this.config.queue?.maxRetries ?? 3
            });
            if (recovery.recoveredCount > 0) this.health.increment("diagnostic_stale_locks_recovered_total", {}, recovery.recoveredCount);
            if (recovery.exhaustedCount > 0) this.health.increment("diagnostic_stale_locks_exhausted_total", {}, recovery.exhaustedCount);
          }
          if (typeof this.repository.getDatabaseSizeBytes === "function") {
            this.health.setGauge("diagnostic_db_size_bytes", this.repository.getDatabaseSizeBytes());
          }
        }

        if (now - lastHousekeepingAt >= housekeepingIntervalMs) {
          lastHousekeepingAt = now;
          if (typeof this.repository.pruneHistoricalRecords === "function") {
            const pruning = this.repository.pruneHistoricalRecords({
              retentionDays: this.config.queue?.retentionDays ?? 30
            });
            if (pruning.prunedEvents > 0) this.health.increment("diagnostic_records_pruned_total", { table: "events" }, pruning.prunedEvents);
            this.health.increment("diagnostic_housekeeping_runs_total");
          }
          if (typeof this.repository.getDatabaseSizeBytes === "function") {
            this.health.setGauge("diagnostic_db_size_bytes", this.repository.getDatabaseSizeBytes());
          }
        }

        const result = await this.worker.runOnce();
        if (!result) await new Promise((resolvePoll) => {
          this.resolvePoll = resolvePoll;
          this.pollTimer = setTimeout(resolvePoll, this.config.queue.pollIntervalMs);
        });
      } catch {
        this.health.increment("diagnostic_worker_failures_total");
      }
    }
  }

  async shutdown() {
    if (this.stopping) return;
    this.accepting = false;
    this.health.setReady(false);
    this.stopping = true;
    clearTimeout(this.pollTimer);
    this.resolvePoll?.();
    if (this.server?.listening) {
      this.server.close();
      const closed = once(this.server, "close");
      let shutdownTimer;
      await Promise.race([closed, new Promise((resolveTimeout) => { shutdownTimer = setTimeout(() => { this.server.closeAllConnections?.(); resolveTimeout(); }, this.config.timeouts.shutdownMs); })]);
      clearTimeout(shutdownTimer);
    }
    await this.workerLoop;
    this.repository?.close();
  }
}
