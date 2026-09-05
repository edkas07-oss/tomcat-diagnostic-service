/**
 * @file src/adapters/local-file-evidence-adapter.js
 * @project Tomcat Diagnostic Service
 * @description Adapter pembaca bukti file lokal (log catalina, thread dump) dengan sensor redaksi data sensitif.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. Ambil root directory target berdasarkan `target[rootField]`.
 *    - Jika tidak dikonfigurasi, kembalikan Evidence berstatus `not_configured`.
 * 2. Coba baca file menggunakan `readBoundedFile(root, relativePath)`:
 *    a. Lakukan sensor redaksi nilai sensitif (token, password, key, cookie) menggunakan pola regex `sensitive` -> `<redacted>`.
 *    b. Bentuk dan kembalikan Evidence berstatus `collected` dengan nilai `{ excerpt: sanitized, truncated }` serta flag `redacted`.
 * 3. Jika terjadi error:
 *    - Tangkap ENOENT -> kembalikan Evidence berstatus `not_found`.
 *    - Tangkap error lainnya -> kembalikan Evidence berstatus `unavailable`.
 *
 * Prinsip & Batasan Arsitektur (TN-006):
 * - Target Isolation: Membaca path file log target via bounded file reader terisolasi.
 * - Secret Redaction: Meredaksi otomatis token, password, authorization, dan API keys.
 * - Error Containment: Mengonversi ENOENT atau filesystem errors ke status kanonikal `not_found`/`unavailable`.
 */

import { readBoundedFile } from "./bounded-file-reader.js";
import { createEvidence } from "../domain/evidence.js";

const sensitive = /(authorization|cookie|password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi;

export function collectLocalFileEvidence(target, context, { rootField, relativePath, type, strength = "supporting" }) {
  const root = target[rootField];
  if (!root) return createEvidence({ source: "local_file", type, targetId: target.targetId,
    generation: context.generation, observedAt: context.observedAt, collectedAt: context.collectedAt,
    status: "not_configured", strength, redacted: false });
  try {
    const file = readBoundedFile(root, relativePath);
    const sanitized = file.text.replace(sensitive, "$1=<redacted>");
    return createEvidence({ source: "local_file", type, targetId: target.targetId,
      generation: context.generation, observedAt: context.observedAt, collectedAt: context.collectedAt,
      status: "collected", strength, value: { excerpt: sanitized, truncated: file.truncated },
      redacted: sanitized !== file.text });
  } catch (error) {
    return createEvidence({ source: "local_file", type, targetId: target.targetId,
      generation: context.generation, observedAt: context.observedAt, collectedAt: context.collectedAt,
      status: error.code === "ENOENT" ? "not_found" : "unavailable", strength, redacted: false });
  }
}
