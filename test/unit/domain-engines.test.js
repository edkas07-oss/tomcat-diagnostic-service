/**
 * @file test/unit/domain-engines.test.js
 * @project Tomcat Diagnostic Service
 * @description Pengujian unit Decision Engines Multi-Domain (Application Health, JVM Workload, Concurrency) dan Multi-Domain Dispatcher.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateApplicationHealth } from "../../src/domain/application-health-engine.js";
import { evaluateJvmWorkload } from "../../src/domain/jvm-workload-engine.js";
import { evaluateConcurrency } from "../../src/domain/concurrency-engine.js";
import { evaluateTomcatDown } from "../../src/domain/tomcat-down-engine.js";
import { DynamicRuleEvaluator, isBuiltinBranch } from "../../src/domain/rulepack-loader.js";

test("isBuiltinBranch detects all built-in branches across 4 domains", () => {
  // Runtime Availability domain
  assert.equal(isBuiltinBranch("TD-01"), true);
  assert.equal(isBuiltinBranch("TD-08"), true);
  
  // Application Health domain
  assert.equal(isBuiltinBranch("AH-01"), true);
  assert.equal(isBuiltinBranch("AH-05"), true);

  // JVM Workload & GC domain
  assert.equal(isBuiltinBranch("GC-01"), true);
  assert.equal(isBuiltinBranch("GC-04"), true);

  // Concurrency Saturation domain
  assert.equal(isBuiltinBranch("TH-01"), true);
  assert.equal(isBuiltinBranch("TH-03"), true);

  // Custom branches
  assert.equal(isBuiltinBranch("TD-09"), false);
  assert.equal(isBuiltinBranch("CUSTOM-01"), false);
});

test("evaluateApplicationHealth resolves AH-01 through AH-04 accurately", () => {
  const scrapeUnavailable = evaluateApplicationHealth([], { labels: { alertname: "TelegrafHealthScrapeUnavailable" } });
  assert.equal(scrapeUnavailable.branch, "AH-04");
  assert.equal(scrapeUnavailable.classification, "confirmed_cause");
  assert.equal(scrapeUnavailable.ruleId, "TelegrafHealthScrapeUnavailable");

  const metricsMissing = evaluateApplicationHealth([], { labels: { alertname: "TomcatApplicationHealthMetricsMissing" } });
  assert.equal(metricsMissing.branch, "AH-03");
  assert.equal(metricsMissing.classification, "probable_cause");
  assert.equal(metricsMissing.ruleId, "TomcatApplicationHealthMetricsMissing");

  const timeoutEvidence = [
    { evidenceId: "1", source: "collector", type: "application_health", status: "timeout", value: { timeout: true } }
  ];
  const probeTimeout = evaluateApplicationHealth(timeoutEvidence, { labels: { alertname: "TomcatApplicationHealthFailed" } });
  assert.equal(probeTimeout.branch, "AH-02");
  assert.equal(probeTimeout.classification, "probable_cause");

  const failedProbe = [
    { evidenceId: "1", source: "collector", type: "application_health", status: "collected", value: { up: false, httpCode: 503 } }
  ];
  const appFailed = evaluateApplicationHealth(failedProbe, { labels: { alertname: "TomcatApplicationHealthFailed" } });
  assert.equal(appFailed.branch, "AH-01");
  assert.equal(appFailed.classification, "confirmed_cause");
});

test("evaluateJvmWorkload resolves GC-01 through GC-04 accurately", () => {
  const gcPause = evaluateJvmWorkload([], { labels: { alertname: "TomcatGCPauseHigh" } });
  assert.equal(gcPause.branch, "GC-01");
  assert.equal(gcPause.classification, "confirmed_cause");
  assert.equal(gcPause.ruleId, "TomcatGCPauseHigh");
  assert.equal(gcPause.category, "jvm-memory-and-gc");

  const gcOverhead = evaluateJvmWorkload([], { labels: { alertname: "TomcatGCOverheadHigh" } });
  assert.equal(gcOverhead.branch, "GC-02");
  assert.equal(gcOverhead.classification, "confirmed_cause");
  assert.equal(gcOverhead.ruleId, "TomcatGCOverheadHigh");

  const oldGen = evaluateJvmWorkload([], { labels: { alertname: "TomcatOldGenMemoryPressure" } });
  assert.equal(oldGen.branch, "GC-03");
  assert.equal(oldGen.classification, "probable_cause");
  assert.equal(oldGen.ruleId, "TomcatOldGenMemoryPressure");

  const unknown = evaluateJvmWorkload([], { labels: { alertname: "TomcatOtherJvmAlert" } });
  assert.equal(unknown.branch, "GC-04");
  assert.equal(unknown.classification, "undetermined");
});

test("evaluateConcurrency resolves TH-01 accurately", () => {
  const saturated = evaluateConcurrency([], { labels: { alertname: "TomcatThreadPoolSaturated" } });
  assert.equal(saturated.branch, "TH-01");
  assert.equal(saturated.classification, "confirmed_cause");
  assert.equal(saturated.ruleId, "TomcatThreadPoolSaturated");
  assert.equal(saturated.category, "concurrency-saturation");
});

test("DynamicRuleEvaluator dispatches events to the appropriate domain engine while preserving ruleId", () => {
  const evaluator = new DynamicRuleEvaluator();
  const evidence = [
    { evidenceId: "1", source: "collector", type: "container_state", status: "collected", value: { state: "running" } }
  ];

  // Dispatch to JVM domain
  const gcResult = evaluator.evaluate(evidence, { labels: { alertname: "TomcatGCPauseHigh" } });
  assert.equal(gcResult.ruleId, "TomcatGCPauseHigh");
  assert.equal(gcResult.branch, "GC-01");
  assert.equal(gcResult.category, "jvm-memory-and-gc");

  // Dispatch to Concurrency domain
  const threadResult = evaluator.evaluate(evidence, { labels: { alertname: "TomcatThreadPoolSaturated" } });
  assert.equal(threadResult.ruleId, "TomcatThreadPoolSaturated");
  assert.equal(threadResult.branch, "TH-01");
  assert.equal(threadResult.category, "concurrency-saturation");

  // Dispatch to App Health domain
  const appHealthResult = evaluator.evaluate(evidence, { labels: { alertname: "TelegrafHealthScrapeUnavailable" } });
  assert.equal(appHealthResult.ruleId, "TelegrafHealthScrapeUnavailable");
  assert.equal(appHealthResult.branch, "AH-04");
  assert.equal(appHealthResult.category, "application-health");

  // Dispatch to TomcatDown (default / explicit)
  const tomcatDownResult = evaluator.evaluate(evidence, { labels: { alertname: "TomcatDown" } });
  assert.equal(tomcatDownResult.ruleId, "TomcatDown");
  assert.equal(tomcatDownResult.branch, "TD-08");
});

test("DynamicRuleEvaluator prioritizes Layer 2 custom rules over Layer 1 domain dispatching", () => {
  const customRule = {
    branch: "TD-09",
    ruleName: "DatabasePoolExhausted",
    targetSource: "local_file",
    pattern: "CannotGetJdbcConnectionException",
    assessment: "Database pool exhausted",
    classification: "confirmed_cause",
    confidence: "high"
  };
  const evaluator = new DynamicRuleEvaluator([customRule]);
  const evidence = [
    { evidenceId: "1", source: "local_file", type: "orderly_shutdown", status: "collected", value: { excerpt: "CannotGetJdbcConnectionException: Connection timed out" } }
  ];

  const result = evaluator.evaluate(evidence, { labels: { alertname: "TomcatThreadPoolSaturated" } });
  assert.equal(result.branch, "TD-09");
  assert.equal(result.ruleId, "TomcatThreadPoolSaturated");
  assert.equal(result.assessment, "Database pool exhausted");
});
