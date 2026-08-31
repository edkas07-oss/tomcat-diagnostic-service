import assert from "node:assert/strict";
import { test } from "node:test";
import { PrometheusAdapter } from "../../src/adapters/prometheus-adapter.js";
import { collectApplicationHealth } from "../../src/adapters/application-health-adapter.js";

const target = { targetId: "lab/host/one", prometheusSelector: 'job="tomcat-jmx-exporter",instance="host:9404"', applicationHealthUrl: "https://health.local/health" };
const context = { observedAt: "2026-08-31T01:00:00Z", collectedAt: "2026-08-31T01:00:01Z", generation: "g1" };

test("Prometheus adapter performs one successful bounded query", async () => {
  let attempts = 0;
  const adapter = new PrometheusAdapter({ baseUrl: "https://prometheus.local", fetchImpl: async () => { attempts += 1; return { ok: true, json: async () => ({ status: "success", data: { result: [] } }) }; } });
  const evidence = await adapter.query(target, "up", context);
  assert.equal(attempts, 1);
  assert.equal(evidence.status, "collected");
});

test("Prometheus timeout is explicit and is not retried", async () => {
  let attempts = 0;
  const adapter = new PrometheusAdapter({ baseUrl: "https://prometheus.local", fetchImpl: async () => { attempts += 1; const error = new Error("timeout"); error.name = "TimeoutError"; throw error; } });
  const evidence = await adapter.query(target, "up", context);
  assert.equal(attempts, 1);
  assert.equal(evidence.status, "timeout");
});

test("application health reports HTTP state without response content", async () => {
  const evidence = await collectApplicationHealth(target, context, { fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.deepEqual(evidence.value, { httpStatus: 503, up: false });
});
