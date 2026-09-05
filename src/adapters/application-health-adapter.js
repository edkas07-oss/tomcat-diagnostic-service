/**
 * @file src/adapters/application-health-adapter.js
 * @project Tomcat Diagnostic Service
 * @description Adapter probe status HTTP endpoint `/health` aplikasi Tomcat.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. Periksa apakah target memiliki konfigurasi `applicationHealthUrl`.
 *    - Jika tidak ada, kembalikan objek Evidence berstatus `not_configured`.
 * 2. Lakukan HTTP GET request menggunakan fetchImpl dengan AbortSignal timeout (3000ms).
 * 3. Jika berhasil: ekstrak `{ up: response.ok, httpStatus: response.status }` dan set status `collected`.
 * 4. Jika gagal:
 *    - Jika TimeoutError / AbortError -> set status `timeout`.
 *    - Selain itu -> set status `unavailable`.
 * 5. Bentuk dan kembalikan objek Evidence standar melalui `createEvidence()`.
 *
 * Prinsip & Batasan Arsitektur (TN-006):
 * - Health Probe: Memeriksa ketersediaan aplikasi web via endpoint HTTPS `/health`.
 * - Aggressive Timeout: Membatasi probe HTTP dengan timeout ketat (default 3000ms).
 * - Non-leaking Payload: Hanya mencatat `up` (boolean) dan `httpStatus`, tanpa menyimpan body respons aplikasi.
 */

import { createEvidence } from "../domain/evidence.js";

export async function collectApplicationHealth(target, context, { fetchImpl = globalThis.fetch, timeoutMs = 3000 } = {}) {
  if (!target.applicationHealthUrl) {
    return createEvidence({ source: "application_health", type: "application_health", targetId: target.targetId,
      generation: context.generation, observedAt: context.observedAt, collectedAt: context.collectedAt,
      status: "not_configured", strength: "supporting", redacted: false });
  }
  let status = "collected";
  let value = null;
  try {
    const response = await fetchImpl(target.applicationHealthUrl, { signal: AbortSignal.timeout(timeoutMs) });
    value = { up: response.ok, httpStatus: response.status };
  } catch (error) {
    status = error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : "unavailable";
  }
  return createEvidence({ source: "application_health", type: "application_health", targetId: target.targetId,
    generation: context.generation, observedAt: context.observedAt, collectedAt: context.collectedAt,
    status, strength: "supporting", value, redacted: false });
}
