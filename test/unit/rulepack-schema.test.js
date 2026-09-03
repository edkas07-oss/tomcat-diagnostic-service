import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRulepackValidator, isSafeRegex } from "../../src/server/rulepack-schema.js";

const schemaPath = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "config/schemas/rulepack-v1.schema.json");

test("isSafeRegex detects unsafe and safe regex patterns", () => {
  assert.equal(isSafeRegex("CannotGetJdbcConnectionException"), true);
  assert.equal(isSafeRegex("org\\.apache\\.catalina\\[0-9]+\\.Error"), true);
  assert.equal(isSafeRegex("(a+)+"), false);
  assert.equal(isSafeRegex("(a*)*"), false);
  assert.equal(isSafeRegex("[invalid(regex"), false);
});

test("createRulepackValidator accepts valid rulepack payload", () => {
  const validator = createRulepackValidator(schemaPath);
  const validRule = {
    branch: "TD-09",
    ruleName: "DatabaseConnectionPoolExhausted",
    targetSource: "local_file",
    pattern: "CannotGetJdbcConnectionException",
    assessment: "Tomcat unresponsive: Database connection pool exhausted",
    classification: "confirmed_cause",
    confidence: "high",
    recommendedActions: [
      "Periksa utilisasi koneksi pada server Database PostgreSQL.",
      "Tinjau parameter maxTotal pada DataSource."
    ]
  };
  const result = validator(validRule);
  assert.equal(result.valid, true);
});

test("createRulepackValidator rejects invalid schema or inconsistent confidence", () => {
  const validator = createRulepackValidator(schemaPath);
  
  // Missing required field 'assessment'
  const missingField = {
    branch: "TD-09",
    ruleName: "TestRule",
    targetSource: "local_file",
    pattern: "test",
    classification: "confirmed_cause",
    confidence: "high",
    recommendedActions: ["Action 1"]
  };
  assert.equal(validator(missingField).valid, false);

  // Inconsistent confidence: confirmed_cause requires high
  const invalidConfidence = {
    branch: "TD-09",
    ruleName: "TestRule",
    targetSource: "local_file",
    pattern: "test",
    assessment: "Valid assessment",
    classification: "confirmed_cause",
    confidence: "low",
    recommendedActions: ["Action 1"]
  };
  const res = validator(invalidConfidence);
  assert.equal(res.valid, false);
  assert.equal(res.error, "invalid_confidence_mapping");
});

test("createRulepackValidator rejects unsafe regex pattern in rule payload", () => {
  const validator = createRulepackValidator(schemaPath);
  const unsafeRule = {
    branch: "TD-09",
    ruleName: "UnsafeRule",
    targetSource: "local_file",
    pattern: "(a+)+",
    assessment: "Unsafe regex test",
    classification: "confirmed_cause",
    confidence: "high",
    recommendedActions: ["Mitigate"]
  };
  const res = validator(unsafeRule);
  assert.equal(res.valid, false);
  assert.equal(res.error, "unsafe_regex_pattern");
});
