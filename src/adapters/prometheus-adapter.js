/**
 * @file src/adapters/prometheus-adapter.js
 * @project Tomcat Diagnostic Service
 * @description Adapter pengambilan metrik telemetri Prometheus API dengan label selector exact-match.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. Inisialisasi instance PrometheusAdapter dengan baseUrl, fetchImpl, dan timeoutMs (5000ms).
 * 2. query(target, query, context):
 *    a. Bentuk URL endpoint `/api/v1/query` dengan parameter kueri gabungan: `${query}{${target.prometheusSelector}}`.
 *    b. Kirim permintaan HTTP GET via fetchImpl dengan batas waktu AbortSignal.timeout().
 *    c. Jika respons tidak OK: tentukan status `unauthorized` (401/403) atau `unavailable`.
 *    d. Jika respons OK: parse body JSON. Jika `status !== 'success'`, set `invalid_response`; jika valid, simpan `body.data.result`.
 *    e. Jika terjadi error: tentukan status `timeout` (TimeoutError/AbortError) atau `unavailable`.
 *    f. Kembalikan objek Evidence kanonikal standar via `createEvidence()`.
 *
 * Prinsip & Batasan Arsitektur (TN-006):
 * - Scrape Bounded: Mengambil metrik instan melalui HTTP API `/api/v1/query`.
 * - Selector Isolation: Menggabungkan kueri hanya dengan `prometheusSelector` exact-match dari target allowlist.
 * - Timeout Bound: Membatasi kueri dengan batas waktu timeout agresif (default 5000ms).
 */

import { createEvidence } from "../domain/evidence.js";

export class PrometheusAdapter {
  constructor({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
    this.baseUrl = new URL(baseUrl);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async query(target, query, context) {
    const url = new URL("/api/v1/query", this.baseUrl);
    url.searchParams.set("query", `${query}{${target.prometheusSelector}}`);
    let status = "collected";
    let value = null;
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) status = response.status === 401 || response.status === 403 ? "unauthorized" : "unavailable";
      else {
        const body = await response.json();
        if (body.status !== "success" || !body.data) status = "invalid_response";
        else value = body.data.result;
      }
    } catch (error) {
      status = error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : "unavailable";
    }
    return createEvidence({
      source: "prometheus", type: "jmx_scrape", targetId: target.targetId,
      generation: context.generation, observedAt: context.observedAt,
      collectedAt: context.collectedAt, status, strength: "supporting", value,
      redacted: false
    });
  }
}
