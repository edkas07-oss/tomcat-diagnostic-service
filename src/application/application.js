import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteRepository } from "../adapters/sqlite-repository.js";
import { BoundedWorkQueue } from "./bounded-queue.js";
import { DiagnosticWorker } from "./diagnostic-worker.js";
import { HealthMetrics, serializePrometheus } from "./health-metrics.js";
import { targetKey } from "./ingest-alertmanager.js";
import { createHttpsService } from "../server/http-service.js";
import { createWebhookValidator } from "../server/webhook-schema.js";

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
      const queue = this.dependencies.queue ?? new BoundedWorkQueue(this.repository, { capacity: this.config.queue.capacity });
      const validate = this.dependencies.webhookValidator ?? createWebhookValidator(join(projectRoot, "config/schemas/alertmanager-webhook-v4.schema.json"));
      const allowedTargets = new Set([...this.config.targetRegistry.targets.values()].map(({ identity }) => targetKey(identity)));
      this.worker = this.dependencies.worker ?? new DiagnosticWorker(this.repository, this.dependencies.collectEvidence ?? (async () => []), { timeoutMs: this.config.timeouts.diagnosticMs });
      this.server = this.dependencies.server ?? createHttpsService(this.config.tls, {
        token: this.config.bearerToken,
        health: this.health,
        metricsText: () => serializePrometheus(this.health),
        requestLimitBytes: this.config.requestLimitBytes,
        accepting: () => this.accepting,
        ingestion: { queue, validate, allowedTargets }
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
    while (!this.stopping) {
      try {
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
