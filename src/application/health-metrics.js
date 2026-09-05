/**
 * @file src/application/health-metrics.js
 * @project Tomcat Diagnostic Service
 * @description Modul pelacak status kesehatan (liveness, readiness) dan eksporter metrik Prometheus.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. HealthMetrics:
 *    a. Inisialisasi status live = true, ready = false, serta map counters dan gauges.
 *    b. `increment(name, labels)`: Tambah nilai counter untuk kombinasi nama dan label tertentu.
 *    c. `setGauge(name, value)`: Set nilai gauge saat ini.
 *    d. `health()`: Kembalikan objek `{ live, ready }`.
 *    e. `snapshot()`: Salin seluruh nilai counters dan gauges menjadi plain object.
 * 2. serializePrometheus(metrics):
 *    a. Ambil snapshot metrik.
 *    b. Untuk setiap counter dan gauge:
 *       - Validasi nama metrik sesuai format baku Prometheus (`validName`).
 *       - Urutkan label secara leksikografis dan lakukan sanitasi/escaping (`escapeLabel`).
 *       - Susun baris metrik: `${name}{${labels}} ${value}`.
 *    c. Kembalikan representasi string berformat `text/plain; version=0.0.4`.
 */

export class HealthMetrics {
  constructor() { this.live = true; this.ready = false; this.counters = new Map(); this.gauges = new Map(); }
  setReady(value) { this.ready = Boolean(value); }
  increment(name, labels = {}) { const key = `${name}:${JSON.stringify(labels)}`; this.counters.set(key, (this.counters.get(key) ?? 0) + 1); }
  setGauge(name, value) { this.gauges.set(name, value); }
  health() { return { live: this.live, ready: this.ready }; }
  snapshot() { return { counters: Object.fromEntries(this.counters), gauges: Object.fromEntries(this.gauges) }; }
}

const validName = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const escapeLabel = (value) => String(value).replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');

export function serializePrometheus(metrics) {
  const lines = [];
  const emit = (key, value) => {
    const separator = key.indexOf(":");
    const name = separator === -1 ? key : key.slice(0, separator);
    if (!validName.test(name) || !Number.isFinite(value)) throw new TypeError("invalid Prometheus metric");
    const labels = separator === -1 ? {} : JSON.parse(key.slice(separator + 1));
    const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
    for (const [label] of entries) if (!validName.test(label)) throw new TypeError("invalid Prometheus label name");
    const suffix = entries.length ? `{${entries.map(([label, labelValue]) => `${label}="${escapeLabel(labelValue)}"`).join(",")}}` : "";
    lines.push(`${name}${suffix} ${value}`);
  };
  const snapshot = metrics.snapshot();
  for (const [key, value] of Object.entries(snapshot.counters).sort()) emit(key, value);
  for (const [key, value] of Object.entries(snapshot.gauges).sort()) emit(key, value);
  return lines.length ? `${lines.join("\n")}\n` : "";
}
