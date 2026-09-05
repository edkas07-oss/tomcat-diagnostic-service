/**
 * @file src/application/target-registry.js
 * @project Tomcat Diagnostic Service
 * @description Registri target terisolasi untuk memetakan identitas target ke path bukti dan endpoint telemetri.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. canonicalTargetId(identity):
 *    - Gabungkan properti identitas menjadi format standar: `${environment}/${host}/${tomcat_instance}`.
 * 2. TargetRegistry.constructor(targets):
 *    a. Loop setiap definisi target dalam array:
 *       - Bentuk `id = canonicalTargetId(target.identity)`. Tolak jika duplikat.
 *       - Validasi bahwa logDirectory, crashDirectory, dan collectorSpool merupakan path absolut ter-normalisasi.
 *       - Validasi pola label exact-match pada `prometheusSelector`.
 *       - Validasi protokol HTTPS pada `applicationHealthUrl`.
 *       - Simpan target ke dalam map `this.targets` sebagai objek beku (`Object.freeze`).
 * 3. require(identity):
 *    - Ambil target berdasarkan ID; lempar RangeError jika tidak terdaftar pada allowlist.
 *
 * Prinsip & Batasan Arsitektur (TN-006):
 * - Target Allowlist: Membentuk canonical target ID (`environment/host/tomcat_instance`) dan menolak target tak terdaftar.
 * - Path Safety: Mewajibkan absolute normalized path tanpa traversal (`..`) atau symlink untuk direktori log dan spool.
 * - Selector & URL Integrity: Memvalidasi exact-match label Prometheus dan mewajibkan skema HTTPS pada health endpoint.
 */

import { isAbsolute, normalize } from "node:path";

export function canonicalTargetId(identity) {
  return `${identity.environment}/${identity.host}/${identity.tomcat_instance}`;
}

export class TargetRegistry {
  constructor(targets) {
    this.targets = new Map();
    for (const target of targets) {
      const id = canonicalTargetId(target.identity);
      if (this.targets.has(id)) throw new TypeError(`duplicate target identity: ${id}`);
      for (const field of ["logDirectory", "crashDirectory", "collectorSpool"]) {
        if (target[field] !== undefined && (!isAbsolute(target[field]) || normalize(target[field]) !== target[field])) {
          throw new TypeError(`${field} must be an absolute normalized local path`);
        }
      }
      if (target.prometheusSelector !== undefined && (!/^[A-Za-z_:][A-Za-z0-9_:]*="[^"\r\n{}]+"(?:,[A-Za-z_:][A-Za-z0-9_:]*="[^"\r\n{}]+")*$/.test(target.prometheusSelector))) {
        throw new TypeError("prometheusSelector must contain only exact trusted label matchers");
      }
      if (target.applicationHealthUrl !== undefined && new URL(target.applicationHealthUrl).protocol !== "https:") {
        throw new TypeError("applicationHealthUrl must use HTTPS");
      }
      this.targets.set(id, Object.freeze({ ...target, targetId: id }));
    }
  }

  require(identity) {
    const id = typeof identity === "string" ? identity : canonicalTargetId(identity);
    const target = this.targets.get(id);
    if (!target) throw new RangeError("target identity is not allowlisted");
    return target;
  }
}
