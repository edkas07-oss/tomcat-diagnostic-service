/**
 * @file test/unit/normalize-webhook.test.js
 * @project Tomcat Diagnostic Service
 * @description Pengujian unit normalisasi payload webhook Alertmanager v4 (eventKey deterministik, allowlist target, skema schema).
 *
 * Pseudocode Alur Pengujian:
 * --------------------------
 * 1. Test "normalizes a valid TomcatDown firing event deterministically":
 *    - Jalankan `normalizeWebhook()` dua kali pada payload yang sama -> verifikasi `eventKey` SHA-256 identik dan `eventTime` UTC format RFC 3339.
 * 2. Test "rejects an identity outside the local allowlist":
 *    - Kirim alert dengan host yang tidak ada pada allowlist -> verifikasi lemparan `IngestionValidationError`.
 * 3. Test "rejects unsupported alert schema":
 *    - Kirim payload dengan version bukan 4 -> verifikasi lemparan `IngestionValidationError`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { IngestionValidationError, normalizeWebhook, targetKey } from "../../src/application/ingest-alertmanager.js";
import { createWebhookValidator } from "../../src/server/webhook-schema.js";
import { webhook } from "../fixtures/alertmanager-webhook.js";

const validate = createWebhookValidator(resolve("config/schemas/alertmanager-webhook-v4.schema.json"));
const allowedTargets = new Set([targetKey({ environment: "lab", host: "tomcat-01", tomcat_instance: "default" })]);
const options = { validate, allowedTargets, now: () => new Date("2026-08-31T01:01:00Z") };

test("normalizes a valid TomcatDown firing event deterministically", () => {
  const first = normalizeWebhook(webhook(), options);
  const second = normalizeWebhook(webhook(), options);
  assert.equal(first.alerts[0].eventKey, second.alerts[0].eventKey);
  assert.equal(first.alerts[0].eventTime, "2026-08-31T01:00:00.000Z");
});

test("normalizes universal monitoring alerts (TomcatGCPauseHigh) deterministically", () => {
  const payload = webhook({
    groupKey: "{}:{alertname=\"TomcatGCPauseHigh\"}",
    alert: {
      labels: {
        alertname: "TomcatGCPauseHigh",
        severity: "warning",
        environment: "lab",
        host: "tomcat-01",
        tomcat_instance: "default",
        job: "tomcat-jmx-exporter",
        instance: "tomcat-01:9404",
        service: "tomcat",
        check: "jvm-gc-latency"
      },
      annotations: { summary: "Tomcat JVM GC pause is excessively high" }
    }
  });
  const normalized = normalizeWebhook(payload, options);
  assert.equal(normalized.alerts[0].labels.alertname, "TomcatGCPauseHigh");
  assert.equal(normalized.alerts[0].labels.severity, "warning");
  assert.equal(normalized.alerts[0].labels.check, "jvm-gc-latency");
});

test("rejects an identity outside the local allowlist", () => {
  const payload = webhook({ alert: { labels: { ...webhook().alerts[0].labels, host: "unapproved" } } });
  assert.throws(() => normalizeWebhook(payload, options), IngestionValidationError);
});

test("rejects unsupported alert schema", () => {
  assert.throws(() => normalizeWebhook(webhook({ version: "3" }), options), IngestionValidationError);
});
