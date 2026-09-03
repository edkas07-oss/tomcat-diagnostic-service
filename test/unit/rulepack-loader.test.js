import test from "node:test";
import assert from "node:assert/strict";
import { DynamicRuleEvaluator, isBuiltinBranch } from "../../src/domain/rulepack-loader.js";

test("isBuiltinBranch detects TD-01 through TD-08", () => {
  assert.equal(isBuiltinBranch("TD-01"), true);
  assert.equal(isBuiltinBranch("TD-06"), true);
  assert.equal(isBuiltinBranch("TD-08"), true);
  assert.equal(isBuiltinBranch("TD-09"), false);
  assert.equal(isBuiltinBranch("CUSTOM-01"), false);
});

test("DynamicRuleEvaluator falls back to built-in engine when no custom rules match", () => {
  const evaluator = new DynamicRuleEvaluator();
  const evidence = [
    { evidenceId: "1", source: "collector", type: "container_state", status: "collected", value: { state: "exited" } },
    { evidenceId: "2", source: "collector", type: "runtime_oom", status: "collected", value: { exitCode: 143, oomKilled: false } }
  ];
  const result = evaluator.evaluate(evidence);
  assert.equal(result.branch, "TD-06");
  assert.equal(result.classification, "undetermined");
});

test("DynamicRuleEvaluator matches custom rule on local_file log excerpt", () => {
  const customRule = {
    id: 1,
    ruleId: "TomcatDown",
    branch: "TD-09",
    ruleName: "DatabaseConnectionPoolExhausted",
    targetSource: "local_file",
    pattern: "CannotGetJdbcConnectionException",
    assessment: "Tomcat unresponsive: Database connection pool exhausted",
    classification: "confirmed_cause",
    confidence: "high",
    recommendedActions: [
      "Periksa koneksi database PostgreSQL.",
      "Tinjau parameter maxTotal pool."
    ]
  };
  const evaluator = new DynamicRuleEvaluator([customRule]);
  const evidence = [
    { evidenceId: "1", source: "collector", type: "container_state", status: "collected", value: { state: "running" } },
    { evidenceId: "2", source: "local_file", type: "orderly_shutdown", status: "collected", value: { excerpt: "org.springframework.jdbc.CannotGetJdbcConnectionException: Failed to obtain JDBC Connection" } }
  ];
  const result = evaluator.evaluate(evidence);
  assert.equal(result.branch, "TD-09");
  assert.equal(result.assessment, "Tomcat unresponsive: Database connection pool exhausted");
  assert.equal(result.classification, "confirmed_cause");
  assert.equal(result.confidence, "high");
  assert.equal(result.recommendedActions.length, 2);
  assert.equal(result.recommendedActions[0], "Periksa koneksi database PostgreSQL.");
});

test("DynamicRuleEvaluator supports hot-reloading via registerRule", () => {
  const evaluator = new DynamicRuleEvaluator();
  const evidence = [
    { evidenceId: "1", source: "local_file", type: "app_log", status: "collected", value: { excerpt: "OutOfDirectMemoryError" } }
  ];
  // Initial evaluation falls back to built-in
  assert.equal(evaluator.evaluate(evidence).branch, "TD-08");

  // Hot-load new rule
  evaluator.registerRule({
    branch: "TD-10",
    ruleName: "DirectMemoryExhausted",
    targetSource: "local_file",
    pattern: "OutOfDirectMemoryError",
    assessment: "JVM direct buffer memory exhausted",
    classification: "confirmed_cause",
    confidence: "high",
    recommendedActions: ["Check -XX:MaxDirectMemorySize setting"]
  });

  const reloaded = evaluator.evaluate(evidence);
  assert.equal(reloaded.branch, "TD-10");
  assert.equal(reloaded.assessment, "JVM direct buffer memory exhausted");
});
