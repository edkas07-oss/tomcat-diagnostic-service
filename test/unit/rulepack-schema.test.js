/**
 * @file test/unit/rulepack-schema.test.js
 * @project Tomcat Diagnostic Service
 * @description Pengujian unit kompilasi dan validasi skema Rulepack v1 serta proteksi ReDoS regex.
 *
 * Pseudocode Alur Pengujian:
 * --------------------------
 * 1. Test "isSafeRegex detects unsafe and safe regex patterns":
 *    - Verifikasi pola literal dan regex ter-escape aman -> return true.
 *    - Verifikasi pola nested quantifier `(a+)+` dan sintaks rusak -> return false.
 * 2. Test "createRulepackValidator accepts valid rulepack payload with category":
 *    - Validasi payload lengkap dengan category `database_persistence` -> return valid: true.
 * 3. Test "createRulepackValidator rejects invalid category enum":
 *    - Validasi category di luar enum schema -> return valid: false.
 * 4. Test "createRulepackValidator rejects invalid schema or inconsistent confidence":
 *    - Validasi field wajib hilang atau pemetaan confidence `confirmed_cause` dengan `low` -> return valid: false.
 * 5. Test "createRulepackValidator rejects unsafe regex pattern in rule payload":
 *    - Validasi rule dengan pattern `(x+)+` -> return valid: false, error: unsafe_regex_pattern.
 */

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

test("createRulepackValidator accepts valid rulepack payload with category", () => {
  const validator = createRulepackValidator(schemaPath);
  const validRule = {
    branch: "TD-09",
    ruleName: "DatabaseConnectionPoolExhausted",
    category: "database_persistence",
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

test("createRulepackValidator rejects invalid category enum", () => {
  const validator = createRulepackValidator(schemaPath);
  const invalidCategory = {
    branch: "TD-09",
    ruleName: "InvalidCategoryRule",
    category: "unsupported_domain_category",
    targetSource: "local_file",
    pattern: "CannotGetJdbcConnectionException",
    assessment: "Tomcat unresponsive: Database connection pool exhausted",
    classification: "confirmed_cause",
    confidence: "high",
    recommendedActions: ["Action 1"]
  };
  const result = validator(invalidCategory);
  assert.equal(result.valid, false);
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
