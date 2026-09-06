/**
 * @file src/application/diagnostic-worker.js
 * @project Tomcat Diagnostic Service
 * @author Eddy Wiyatno <edkas07@gmail.com>
 * @license Proprietary & Confidential
 * @description Worker asinkron loop tunggal (Single Worker Loop) untuk pemrosesan antrean dan eksekusi diagnosis insiden.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. runOnce():
 *    a. Klaim item tertua dari antrean kerja via `repository.claimNext()`. Jika kosong -> return null.
 *    b. Ambil data event dari repository.
 *    c. Jika event berstatus "resolved":
 *       - Bentuk canonical result pemulihan via `resolvedResult()`.
 *       - Cek reservasi slot notifikasi resolved (maks 1x per insiden).
 *    d. Jika event berstatus "firing":
 *       - Kumpulkan bukti telemetri via `collectEvidence(event)` dengan batas timeout.
 *       - Evaluasi aturan keputusan melalui `evaluator(evidence)`.
 *       - Susun canonical result standar v1 (`diagnosticResult()`).
 *       - Periksa apakah ini insiden pertama atau terdapat perubahan materiil (`isMaterialChange()`).
 *    e. Simpan canonical result dan ringkasan bukti ke database SQLite.
 *    f. Jika diizinkan notifikasi: render laporan 7-seksi SRE dan kirim via SMTP (`notification.deliver()`).
 *    g. Tandai tugas antrean selesai (`complete(item.id, true)`).
 *    h. Jika terjadi error: tandai tugas gagal (`complete(item.id, false)`).
 * 2. start() & stop():
 *    - Jalankan interval pemrosesan berulang (idle delay 100ms saat tidak ada pekerjaan).
 *    - Hentikan loop dengan aman saat menerima sinyal shutdown.
 *
 * Prinsip & Batasan Arsitektur (TN-007):
 * - Sequential Processing: Memproses antrean satu per satu (concurrency = 1) untuk mencegah race condition / lock contention.
 * - Evidence & Evaluation Pipeline: Mengambil bukti terisolasi, mengevaluasi aturan deterministik, dan menyusun hasil kanonikal v1.
 * - Transactional Completion: Menyimpan canonical result dan evidence summary sebelum menandai item antrean `completed`.
 */

import { buildCanonicalResult, isMaterialChange } from "../domain/canonical-result.js";
import { evaluateTomcatDown } from "../domain/tomcat-down-engine.js";
import { renderResult } from "./result-renderer.js";

export class DiagnosticWorker {
  constructor(repository, collectEvidence, { timeoutMs = 60000, clock = () => new Date(), notification, render = renderResult, evaluator = evaluateTomcatDown } = {}) {
    this.repository = repository;
    this.collectEvidence = collectEvidence;
    this.timeoutMs = timeoutMs;
    this.clock = clock;
    this.notification = notification;
    this.render = render;
    this.evaluator = typeof evaluator === "function" ? evaluator : (evidence) => evaluator.evaluate(evidence);
  }

  async runOnce() {
    const item = this.repository.claimNext();
    if (!item) return null;
    const started = this.clock();
    try {
      const event = this.repository.eventForQueue(item.id);
      const previousFiring = this.repository.latestCanonicalResult(event.fingerprint, "firing");
      const result = event.status === "resolved"
        ? this.resolvedResult(event, previousFiring, started)
        : await this.diagnosticResult(event, started);
      const resultId = this.repository.saveCanonicalResult(item.id, result);
      const notify = event.status === "resolved"
        ? this.repository.reserveResolvedNotification(event.fingerprint)
        : previousFiring === null || (isMaterialChange(previousFiring, result) && this.repository.reserveMaterialUpdate(event.fingerprint));
      if (notify && this.notification) await this.notification.deliver(resultId, result, this.render(result));
      this.repository.complete(item.id, true);
      return result;
    } catch (error) {
      this.repository.complete(item.id, false);
      throw error;
    }
  }

  async diagnosticResult(event, started) {
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("diagnostic timeout")), this.timeoutMs); });
    const evidence = await Promise.race([this.collectEvidence(event), deadline]).finally(() => clearTimeout(timer));
    const assessment = this.evaluator(evidence);
    const partial = evidence.some((value) => value.status !== "collected");
    const actions = assessment.recommendedActions?.length
      ? assessment.recommendedActions
      : ["Review the correlated evidence and restore service through an approved operator procedure."];
    return buildCanonicalResult({
      diagnosticId: `diag-${event.eventKey}`,
      event,
      targetId: event.targetId,
      generation: event.generation,
      processingStatus: partial ? "partially_completed" : "completed",
      evidence,
      assessment,
      timing: { startedAt: started.toISOString(), completedAt: this.clock().toISOString() },
      recommendedActions: actions
    });
  }

  resolvedResult(event, previous, started) {
    const assessment = previous?.assessment ?? { ruleId: "TomcatDown", ruleVersion: "1", branch: "resolved_without_previous_firing", assessment: "Resolved without a stored firing diagnosis", classification: "undetermined", confidence: null };
    return buildCanonicalResult({
      diagnosticId: `diag-${event.eventKey}`,
      event,
      targetId: event.targetId,
      generation: previous?.generation ?? event.generation,
      processingStatus: previous?.processingStatus ?? "resolved_without_previous_firing",
      evidence: previous?.evidence ?? [],
      observations: previous?.observations,
      contradictions: previous?.contradictions,
      assessment,
      contributingFactors: previous?.contributingFactors,
      timing: { startedAt: started.toISOString(), completedAt: this.clock().toISOString() },
      recommendedActions: ["Confirm service recovery and close the incident through an approved operator procedure."]
    });
  }
}
