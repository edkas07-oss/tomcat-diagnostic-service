import assert from "node:assert/strict";
import { test } from "node:test";
import { HealthMetrics } from "../../src/application/health-metrics.js";

test("health and metrics expose bounded operational state without target labels", () => {
  const model = new HealthMetrics(); model.setReady(true); model.increment("events_accepted", { status: "accepted" }); model.setGauge("queue_depth", 2);
  assert.deepEqual(model.health(), { live: true, ready: true });
  assert.equal(model.snapshot().gauges.queue_depth, 2);
  assert.equal(JSON.stringify(model.snapshot()).includes("tomcat_instance"), false);
});
