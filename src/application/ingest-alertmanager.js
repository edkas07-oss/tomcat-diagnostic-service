/**
 * @file src/application/ingest-alertmanager.js
 * @project Tomcat Diagnostic Service
 * @description Modul penyerapan dan normalisasi payload webhook notifikasi insiden dari Alertmanager v4.
 *
 * Prinsip & Batasan Arsitektur (TN-005):
 * - Validasi Skema & Allowlist: Memeriksa integritas envelope dan memastikan identitas target terdaftar pada allowlist lokal.
 * - Deterministic Event Key: Membentuk hash SHA-256 unik (`fingerprint + status + eventTime`) untuk deduplikasi event.
 * - Canonical Timestamps: Menormalisasi format waktu startsAt/endsAt ke standar RFC 3339 UTC.
 * - Queue Ingestion Boundary: Meneruskan data event yang telah dinormalisasi ke antrean kerja berbatas (`BoundedWorkQueue`).
 */

import { createHash } from "node:crypto";

export class IngestionValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "IngestionValidationError";
    this.details = details;
  }
}

function canonicalObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizedTimestamp(value, field) {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new IngestionValidationError(`${field} must be an RFC 3339 timestamp`);
  return new Date(epoch).toISOString();
}

export function targetKey(labels) {
  return `${labels.environment}\u0000${labels.host}\u0000${labels.tomcat_instance}`;
}

export function normalizeWebhook(payload, { validate, allowedTargets, now = () => new Date() }) {
  if (!validate(payload)) {
    throw new IngestionValidationError("webhook does not match schema v4", validate.errors ?? []);
  }

  const alerts = payload.alerts.map((alert) => {
    const startsAt = normalizedTimestamp(alert.startsAt, "startsAt");
    const endsAt = normalizedTimestamp(alert.endsAt, "endsAt");
    if (alert.status === "resolved" && Date.parse(endsAt) < Date.parse(startsAt)) {
      throw new IngestionValidationError("endsAt cannot precede startsAt");
    }
    if (!allowedTargets.has(targetKey(alert.labels))) {
      throw new IngestionValidationError("target identity is not allowlisted");
    }

    const eventTime = alert.status === "firing" ? startsAt : endsAt;
    const eventKey = createHash("sha256")
      .update(`${alert.fingerprint}\u0000${alert.status}\u0000${eventTime}`)
      .digest("hex");
    return {
      fingerprint: alert.fingerprint,
      status: alert.status,
      startsAt,
      endsAt,
      eventTime,
      eventKey,
      labels: canonicalObject(alert.labels),
      annotations: canonicalObject(alert.annotations)
    };
  });

  return {
    groupKey: payload.groupKey,
    receiver: payload.receiver,
    status: payload.status,
    acceptedAt: now().toISOString(),
    alerts
  };
}

export function ingestAlertmanager(payload, options) {
  const normalized = normalizeWebhook(payload, options);
  return options.queue.accept(normalized);
}
