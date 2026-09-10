/**
 * @file test/unit/collector-spool-adapter.test.js
 * @project Tomcat Diagnostic Service
 * @description Pengujian unit adapter pembaca spool bukti container collector.
 *
 * Pseudocode Alur Pengujian:
 * --------------------------
 * 1. Test "collector spool accepts only bounded records for the target window":
 *    - Buat berkas spool valid, berkas beda target, berkas invalid json, dan berkas di luar rentang window waktu.
 *    - Jalankan `readCollectorSpool()` dan verifikasi hanya 1 rekaman yang lolos isolasi target dan jendela waktu.
 * 2. Test "createDefaultEvidenceCollector reads spool evidence from target":
 *    - Inisialisasi TargetRegistry dengan path direktori spool dan jalankan collector evidence default.
 *    - Verifikasi bukti `container_state: exited` berhasil dibaca dan dinormalisasi.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { readCollectorSpool } from "../../src/adapters/collector-spool-adapter.js";

let directory;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined; });

test("collector spool accepts only bounded records for the target window", () => {
  directory = mkdtempSync(join(tmpdir(), "diagnostic-spool-"));
  const record = (targetId, observedAt) => ({
    type: "container_state", target_id: targetId, generation: "g1", observed_at: observedAt,
    status: "collected", strength: "direct", value: { state: "running" }, redacted: false
  });
  writeFileSync(join(directory, "001.json"), JSON.stringify(record("lab/host/one", "2026-08-31T01:00:00Z")));
  writeFileSync(join(directory, "002.json"), JSON.stringify(record("lab/host/two", "2026-08-31T01:00:00Z")));
  writeFileSync(join(directory, "003.json"), "not-json");
  writeFileSync(join(directory, "004.json"), JSON.stringify(record("lab/host/one", "2026-08-31T00:00:00Z")));
  const target = { targetId: "lab/host/one", collectorSpool: directory };
  const window = { generation: "g1", from: "2026-08-31T00:59:00Z", to: "2026-08-31T01:01:00Z", collectedAt: "2026-08-31T01:01:00Z" };
  assert.equal(readCollectorSpool(target, window).length, 1);
});

test("createDefaultEvidenceCollector reads spool evidence from target", async () => {
  const { createDefaultEvidenceCollector } = await import("../../src/application/application.js");
  const { TargetRegistry } = await import("../../src/application/target-registry.js");
  directory = mkdtempSync(join(tmpdir(), "diagnostic-spool-"));
  const record = {
    type: "container_state", target_id: "lab/tomcat-01/default", generation: "1", observed_at: new Date().toISOString(),
    status: "collected", strength: "direct", value: { state: "exited" }, redacted: false
  };
  writeFileSync(join(directory, "100_container_state.json"), JSON.stringify(record));
  const registry = new TargetRegistry([{ identity: { environment: "lab", host: "tomcat-01", tomcat_instance: "default" }, collectorSpool: directory }]);
  const collector = createDefaultEvidenceCollector(registry);
  const evidence = await collector({ targetId: "lab/tomcat-01/default", generation: "1", startsAt: new Date().toISOString() });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].type, "container_state");
  assert.equal(evidence[0].value.state, "exited");
});

test("createDefaultEvidenceCollector queries live Prometheus metrics when prometheusSelector and prometheusAdapter are configured", async () => {
  const { createDefaultEvidenceCollector } = await import("../../src/application/application.js");
  const { TargetRegistry } = await import("../../src/application/target-registry.js");
  const { PrometheusAdapter } = await import("../../src/adapters/prometheus-adapter.js");

  const registry = new TargetRegistry([{
    identity: { environment: "lab", host: "tomcat-01", tomcat_instance: "default" },
    prometheusSelector: 'job="tomcat-jmx-exporter",instance="tomcat-01:9404"'
  }]);

  const queried = [];
  const prometheusAdapter = new PrometheusAdapter({
    baseUrl: "http://prometheus.local:9090",
    fetchImpl: async (url) => {
      queried.push(new URL(url).searchParams.get("query"));
      return {
        ok: true,
        json: async () => ({ status: "success", data: { result: [{ metric: { __name__: "up" }, value: [12345, "1"] }] } })
      };
    }
  });

  const collector = createDefaultEvidenceCollector(registry, { prometheusAdapter });
  const evidence = await collector({ targetId: "lab/tomcat-01/default", generation: "1", startsAt: new Date().toISOString() });

  assert.equal(evidence.length, 3);
  assert.equal(evidence[0].type, "jmx_scrape");
  assert.equal(evidence[0].status, "collected");
  assert.equal(evidence[1].type, "jvm_memory_pool");
  assert.equal(evidence[2].type, "tomcat_threads_busy");
  assert.equal(queried.length, 3);
  assert.equal(queried[0], 'up{job="tomcat-jmx-exporter",instance="tomcat-01:9404"}');
});

test("createDefaultEvidenceCollector handles Prometheus timeouts gracefully without throwing", async () => {
  const { createDefaultEvidenceCollector } = await import("../../src/application/application.js");
  const { TargetRegistry } = await import("../../src/application/target-registry.js");
  const { PrometheusAdapter } = await import("../../src/adapters/prometheus-adapter.js");

  const registry = new TargetRegistry([{
    identity: { environment: "lab", host: "tomcat-01", tomcat_instance: "default" },
    prometheusSelector: 'job="tomcat-jmx-exporter"'
  }]);

  const prometheusAdapter = new PrometheusAdapter({
    baseUrl: "http://prometheus.local:9090",
    fetchImpl: async () => {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      throw error;
    }
  });

  const collector = createDefaultEvidenceCollector(registry, { prometheusAdapter });
  const evidence = await collector({ targetId: "lab/tomcat-01/default", generation: "1", startsAt: new Date().toISOString() });

  assert.equal(evidence.length, 3);
  assert.equal(evidence[0].status, "timeout");
  assert.equal(evidence[1].status, "timeout");
  assert.equal(evidence[2].status, "timeout");
});
