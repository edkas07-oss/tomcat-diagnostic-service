/**
 * @file src/adapters/collector-spool-adapter.js
 * @project Tomcat Diagnostic Service
 * @description Adapter pembaca bukti file spool status runtime container dari spool collector.
 *
 * Prinsip & Batasan Arsitektur (TN-006):
 * - Spool Ingestion: Membaca berkas `.json` status runtime container yang ditulis atomik oleh collector.
 * - Window Isolation: Memfilter rekaman hanya yang berada dalam jendela waktu observasi insiden.
 * - File Limit: Membatasi pemrosesan maksimal 200 berkas spool terbaru dengan batas per berkas 16 KiB.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readBoundedFile } from "./bounded-file-reader.js";
import { createEvidence, withinWindow } from "../domain/evidence.js";

export function readCollectorSpool(target, window, { maxFiles = 200 } = {}) {
  if (!target.collectorSpool) return [];
  const records = [];
  for (const name of readdirSync(target.collectorSpool).filter((item) => item.endsWith(".json")).sort().slice(-maxFiles)) {
    try {
      const file = readBoundedFile(target.collectorSpool, name, { maxBytes: 16 * 1024, maxLines: 200 });
      if (file.truncated) continue;
      const record = JSON.parse(file.text);
      const evidence = createEvidence({
        source: "collector", type: record.type, targetId: record.target_id,
        generation: record.generation, observedAt: record.observed_at,
        collectedAt: window.collectedAt, status: record.status,
        strength: record.strength, value: record.value, redacted: Boolean(record.redacted)
      });
      if (withinWindow(evidence, { ...window, targetId: target.targetId })) records.push(evidence);
    } catch {
      continue;
    }
  }
  return records;
}
