/**
 * @file src/domain/canonical-result.js
 * @project Tomcat Diagnostic Service
 * @author Eddy Wiyatno <edkas07@gmail.com>
 * @license Proprietary & Confidential
 * @description Domain model pembentukan Canonical Result v1 dan deteksi perubahan material insiden.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. buildCanonicalResult(input):
 *    a. Validasi enum processingStatus (completed, partially_completed, failed, dll).
 *    b. Validasi konsistensi pasangan classification dan confidence.
 *    c. Urutkan daftar evidence berdasarkan evidenceId secara stabil.
 *    d. Filter daftar unavailableSources (sumber bukti dengan status bukan 'collected').
 *    e. Susun objek kanonikal `core` dengan pengurutan kunci/objek deterministik via `stable()`.
 *    f. Hitung SHA-256 hash dari JSON representasi `core` -> `resultHash` (tanpa field timing yang volatil).
 *    g. Kembalikan objek utuh `{ ...core, timing, resultHash }`.
 * 2. isMaterialChange(previous, current):
 *    - Periksa apakah terdapat perubahan pada processingStatus, classification, confidence, teks asesmen, atau unavailableSources.
 *    - Kembalikan true jika ada perubahan materiil, false jika perubahan hanya bersifat volatil.
 *
 * Prinsip & Batasan Arsitektur (TN-007):
 * - Canonical Schema v1: Membentuk objek hasil diagnosis terstandardisasi dengan stabilitas urutan key/array.
 * - Deterministic Result Hash: Menghitung SHA-256 hash inti hasil evaluasi tanpa melibatkan timestamp volatil.
 * - Material Change Guard: Mendeteksi apakah pembaruan status insiden bersifat material (mengubah klasifikasi/asesmen) sebelum mengirim notifikasi baru.
 */

import { createHash } from "node:crypto";

const statuses = new Set(["completed", "partially_completed", "failed", "unsupported", "skipped", "resolved_without_previous_firing"]);
const confidence = { confirmed_cause: ["high"], probable_cause: ["medium", "high"], possible_cause: ["low", "medium"], contributing_factor: ["low", "medium", "high"], symptom: ["low", "medium", "high"], not_supported: [null], undetermined: [null] };
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;

export function buildCanonicalResult(input) {
  if (!statuses.has(input.processingStatus)) throw new TypeError("invalid processing status");
  if (!confidence[input.assessment.classification]?.includes(input.assessment.confidence ?? null)) throw new TypeError("classification and confidence are inconsistent");
  const evidence = [...input.evidence].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  const unavailableSources = evidence.filter((item) => item.status !== "collected").map(({ source, status }) => ({ source, status }));
  const core = stable({ schemaVersion: 1, diagnosticId: input.diagnosticId, ruleId: input.assessment.ruleId, ruleVersion: input.assessment.ruleVersion, fingerprint: input.event.fingerprint, lifecycleStatus: input.event.status, startsAt: input.event.startsAt, endsAt: input.event.endsAt, eventKey: input.event.eventKey, targetId: input.targetId, generation: input.generation ?? null, processingStatus: input.processingStatus, evidence, observations: input.observations ?? [], unavailableSources, contradictions: input.contradictions ?? [], assessment: input.assessment, contributingFactors: input.contributingFactors ?? [], recommendedActions: input.recommendedActions ?? [], redaction: { applied: evidence.some((item) => item.redacted) } });
  const resultHash = createHash("sha256").update(JSON.stringify(core)).digest("hex");
  return { ...core, event: input.event, timing: input.timing, resultHash };
}

export function isMaterialChange(previous, current) {
  return previous.processingStatus !== current.processingStatus || previous.assessment.classification !== current.assessment.classification || previous.assessment.confidence !== current.assessment.confidence || previous.assessment.assessment !== current.assessment.assessment || JSON.stringify(previous.unavailableSources) !== JSON.stringify(current.unavailableSources);
}
