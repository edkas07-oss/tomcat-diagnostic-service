import { readFileSync } from "node:fs";
import Ajv from "ajv";

const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function createWebhookValidator(schemaPath) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    formats: {
      "date-time": {
        type: "string",
        validate: (value) => rfc3339.test(value) && Number.isFinite(Date.parse(value))
      }
    }
  });
  return ajv.compile(schema);
}
