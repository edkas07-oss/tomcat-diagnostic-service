/**
 * @file src/domain/evidence.js
 * @project Tomcat Diagnostic Service
 * @description Domain model pembentukan bukti telemetri kanonikal terisolasi untuk analisis insiden.
 *
 * Prinsip & Batasan Arsitektur (TN-006):
 * - Canonical Evidence Model: Menstandarkan tipe, status, strength, dan payload bukti dalam bentuk objek kanonikal.
 * - Deterministic Evidence ID: Menghasilkan SHA-256 evidence ID unik berdasarkan data kanonikal.
 * - Time Window Isolation: Membatasi observasi bukti telemetri hanya pada jendela waktu insiden (`startsAt ± delta`).
 */

import { createHash } from "node:crypto";

export const EVIDENCE_STATUSES = new Set([
  "collected", "not_found", "no_data", "unavailable", "timeout",
  "unauthorized", "not_configured", "invalid_response"
]);
export const EVIDENCE_STRENGTHS = new Set(["direct", "supporting", "contextual"]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function createEvidence(input) {
  if (!EVIDENCE_STATUSES.has(input.status)) throw new TypeError(`unsupported evidence status: ${input.status}`);
  if (!EVIDENCE_STRENGTHS.has(input.strength)) throw new TypeError(`unsupported evidence strength: ${input.strength}`);
  const observedAt = new Date(input.observedAt).toISOString();
  const collectedAt = new Date(input.collectedAt).toISOString();
  const core = canonicalize({
    source: input.source,
    type: input.type,
    targetId: input.targetId,
    generation: input.generation ?? null,
    observedAt,
    status: input.status,
    strength: input.strength,
    value: input.value ?? null,
    redacted: Boolean(input.redacted)
  });
  return {
    evidenceId: createHash("sha256").update(JSON.stringify(core)).digest("hex"),
    ...core,
    collectedAt
  };
}

export function withinWindow(evidence, { targetId, generation, from, to }) {
  const observed = Date.parse(evidence.observedAt);
  return evidence.targetId === targetId
    && (!generation || !evidence.generation || evidence.generation === generation)
    && observed >= Date.parse(from)
    && observed <= Date.parse(to);
}
