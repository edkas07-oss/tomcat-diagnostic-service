import { readFileSync } from "node:fs";
import Ajv from "ajv";

const confidenceMap = {
  confirmed_cause: ["high"],
  probable_cause: ["medium", "high"],
  possible_cause: ["low", "medium"],
  contributing_factor: ["low", "medium", "high"],
  symptom: ["low", "medium", "high"],
  not_supported: [null],
  undetermined: [null]
};

const dangerousRegexPatterns = [
  /[+*]\s*\)[+*]/,
  /([+*]|\{\d+,?\d*\})\s*\)[+*]|\{\d+,?\d*\}/
];

export function isSafeRegex(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0 || pattern.length > 1024) return false;
  for (const dangerous of dangerousRegexPatterns) {
    if (dangerous.test(pattern)) return false;
  }
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export function validateClassificationConfidence(classification, confidence) {
  const allowed = confidenceMap[classification];
  if (!allowed) return false;
  return allowed.includes(confidence ?? null);
}

export function createRulepackValidator(schemaPath) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv({
    allErrors: true,
    strict: true
  });
  const validate = ajv.compile(schema);
  return (data) => {
    const valid = validate(data);
    if (!valid) {
      return {
        valid: false,
        error: "invalid_rule_schema",
        details: validate.errors
      };
    }
    if (!validateClassificationConfidence(data.classification, data.confidence)) {
      return {
        valid: false,
        error: "invalid_confidence_mapping",
        details: `classification '${data.classification}' is inconsistent with confidence '${data.confidence}'`
      };
    }
    if (!isSafeRegex(data.pattern)) {
      return {
        valid: false,
        error: "unsafe_regex_pattern",
        details: "pattern is invalid or contains potentially unsafe regex constructs"
      };
    }
    return { valid: true };
  };
}
