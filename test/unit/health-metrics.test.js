/**
 * @file test/unit/health-metrics.test.js
 * @project Tomcat Diagnostic Service
 * @description Pengujian unit pelacak HealthMetrics dan serialisasi format Prometheus.
 *
 * Pseudocode Alur Pengujian:
 * --------------------------
 * 1. Test "health and metrics expose bounded operational state without target labels":
 *    - Inkrementasi counter dan set gauge; verifikasi output serialisasi Prometheus tanpa membeberkan label internal instance target.
 * 2. Test "Prometheus serialization rejects unsafe metric identities":
 *    - Set metric name tidak valid (`invalid-name`) dan verifikasi serialisasi melempar error.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { HealthMetrics, serializePrometheus } from "../../src/application/health-metrics.js";

test("health and metrics expose bounded operational state without target labels", () => {
  const model = new HealthMetrics(); model.setReady(true); model.increment("events_accepted", { status: "accepted" }); model.setGauge("queue_depth", 2);
  assert.deepEqual(model.health(), { live: true, ready: true });
  assert.equal(model.snapshot().gauges.queue_depth, 2);
  assert.equal(JSON.stringify(model.snapshot()).includes("tomcat_instance"), false);
  assert.equal(serializePrometheus(model), 'events_accepted{status="accepted"} 1\nqueue_depth 2\n');
});

test("Prometheus serialization rejects unsafe metric identities", () => {
  const model = new HealthMetrics(); model.setGauge("invalid-name", 1);
  assert.throws(() => serializePrometheus(model), /invalid Prometheus metric/);
});
