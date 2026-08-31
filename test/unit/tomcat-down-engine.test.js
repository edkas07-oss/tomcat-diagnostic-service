import assert from "node:assert/strict";
import { test } from "node:test";
import { createEvidence } from "../../src/domain/evidence.js";
import { evaluateTomcatDown } from "../../src/domain/tomcat-down-engine.js";

const base = { source: "fixture", targetId: "lab/host/tomcat", observedAt: "2026-08-31T01:00:00Z", collectedAt: "2026-08-31T01:00:01Z", status: "collected", strength: "direct", redacted: false };
const ev = (type, value = {}) => createEvidence({ ...base, type, value });
const branch = (items) => evaluateTomcatDown(items).branch;

test("evaluates every TomcatDown decision-table branch", () => {
  assert.equal(branch([ev("jmx_scrape", { available: false }), ev("application_health", { up: true }), ev("container_state", { state: "running" })]), "TD-01");
  assert.equal(branch([ev("jmx_scrape", { available: false }), ev("application_health", { up: false }), ev("runtime_oom", { oomKilled: true })]), "TD-02");
  assert.equal(branch([ev("jvm_fatal_marker"), ev("crash_artifact"), ev("runtime_death_event")]), "TD-03");
  assert.equal(branch([ev("tomcat_startup"), ev("connector_bind_exception")]), "TD-04");
  assert.equal(branch([ev("orderly_shutdown"), ev("explicit_stop_event")]), "TD-05");
  assert.equal(branch([ev("container_state", { state: "exited" })]), "TD-06");
  assert.equal(branch([ev("container_state", { state: "running" }), ev("jmx_scrape", { available: false }), createEvidence({ ...base, type: "application_health", status: "timeout" }), ev("long_pause")]), "TD-07");
  assert.equal(branch([createEvidence({ ...base, type: "jmx_scrape", status: "unavailable" })]), "TD-08");
});

test("uses contract confidence rather than a numeric score", () => {
  const result = evaluateTomcatDown([ev("jvm_fatal_marker"), ev("crash_artifact"), ev("runtime_death_event")]);
  assert.deepEqual({ classification: result.classification, confidence: result.confidence }, { classification: "confirmed_cause", confidence: "high" });
});

test("contradicting direct state falls back to TD-08", () => {
  assert.equal(branch([ev("container_state", { state: "running" }), ev("container_state", { state: "exited" })]), "TD-08");
});
