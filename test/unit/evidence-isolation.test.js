/**
 * @file test/unit/evidence-isolation.test.js
 * @project Tomcat Diagnostic Service
 * @description Pengujian unit isolasi bukti, anti-traversal, anti-symlink, dan pembatasan jendela observasi telemetri.
 *
 * Pseudocode Alur Pengujian:
 * --------------------------
 * 1. Test "registry rejects unknown identity and non-normalized evidence paths":
 *    - Verifikasi penolakan target di luar allowlist, path log relatif traversal, selector prometheus tidak aman, dan URL non-HTTPS.
 * 2. Test "bounded reader rejects traversal and symlinks and enforces bounds":
 *    - Verifikasi penolakan akses path keluar root (`../outside`), penolakan file symlink, dan pemotongan buffer `maxLines: 2`.
 * 3. Test "evidence window isolates target, generation, and UTC time":
 *    - Verifikasi fungsi `withinWindow()` hanya mengizinkan bukti dengan kesesuaian targetId, generation ID, dan jendela waktu yang presisi.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { readBoundedFile } from "../../src/adapters/bounded-file-reader.js";
import { createEvidence, withinWindow } from "../../src/domain/evidence.js";
import { TargetRegistry } from "../../src/application/target-registry.js";

const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

test("registry rejects unknown identity and non-normalized evidence paths", () => {
  const registry = new TargetRegistry([{ identity: { environment: "lab", host: "host", tomcat_instance: "one" }, logDirectory: "/var/log/tomcat" }]);
  assert.equal(registry.require("lab/host/one").targetId, "lab/host/one");
  assert.throws(() => registry.require("lab/host/two"), RangeError);
  assert.throws(() => new TargetRegistry([{ identity: { environment: "lab", host: "host", tomcat_instance: "one" }, logDirectory: "../logs" }]), TypeError);
  assert.throws(() => new TargetRegistry([{ identity: { environment: "lab", host: "host", tomcat_instance: "one" }, prometheusSelector: 'job="safe"} or vector(1)' }]), TypeError);
  assert.throws(() => new TargetRegistry([{ identity: { environment: "lab", host: "host", tomcat_instance: "one" }, applicationHealthUrl: "http://host/health" }]), TypeError);
});

test("bounded reader rejects traversal and symlinks and enforces bounds", () => {
  const root = mkdtempSync(join(tmpdir(), "diagnostic-files-"));
  directories.push(root);
  mkdirSync(join(root, "logs"));
  writeFileSync(join(root, "logs", "catalina.log"), "one\ntwo\nthree\n");
  symlinkSync(join(root, "logs", "catalina.log"), join(root, "linked.log"));
  assert.throws(() => readBoundedFile(root, "../outside"), RangeError);
  assert.throws(() => readBoundedFile(root, "linked.log"), RangeError);
  assert.equal(readBoundedFile(root, "logs/catalina.log", { maxBytes: 100, maxLines: 2 }).truncated, true);
});

test("evidence window isolates target, generation, and UTC time", () => {
  const evidence = createEvidence({ source: "fixture", type: "container_state", targetId: "lab/host/one", generation: "g1", observedAt: "2026-08-31T01:00:00Z", collectedAt: "2026-08-31T01:01:00Z", status: "collected", strength: "direct", value: {} });
  const window = { targetId: "lab/host/one", generation: "g1", from: "2026-08-31T00:59:00Z", to: "2026-08-31T01:02:00Z" };
  assert.equal(withinWindow(evidence, window), true);
  assert.equal(withinWindow(evidence, { ...window, targetId: "lab/host/two" }), false);
  assert.equal(withinWindow(evidence, { ...window, generation: "g2" }), false);
});
