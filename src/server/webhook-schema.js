/**
 * @file src/server/webhook-schema.js
 * @project Tomcat Diagnostic Service
 * @description Kompilasi skema validasi webhook Alertmanager v4 menggunakan Ajv (Draft-07).
 *
 * Batasan Teknis (TM-ADR-0013, TN-005):
 * - Menggunakan validator exact-pinned `ajv@8.20.0` dalam mode strict.
 * - Memvalidasi format payload alert webhook: alerts envelope, status, labels, annotations, startsAt RFC3339.
 */

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
