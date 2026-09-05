/**
 * @file src/adapters/application-health-adapter.js
 * @project Tomcat Diagnostic Service
 * @description Adapter probe status HTTP endpoint `/health` aplikasi Tomcat.
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
