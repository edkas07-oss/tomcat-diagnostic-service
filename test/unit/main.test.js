/**
 * @file test/unit/main.test.js
 * @project Tomcat Diagnostic Service
 * @description Pengujian unit signal handler proses OS (SIGTERM/SIGINT) dan idempotensi graceful shutdown.
 *
 * Pseudocode Alur Pengujian:
 * --------------------------
 * 1. Pasang signal handler ke objek runtime mock via `installSignalHandlers()`.
 * 2. Pancarkan sinyal SIGTERM dan SIGINT secara bersamaan.
 * 3. Verifikasi fungsi `application.shutdown()` hanya dipanggil tepat satu kali (idempoten).
 * 4. Verifikasi exitCode tetap 0 (shutdown bersih).
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { installSignalHandlers } from "../../src/main.js";

test("SIGTERM and SIGINT share one idempotent graceful-shutdown path", async () => {
  const runtime = new EventEmitter(); runtime.stderr = { write() {} }; runtime.exitCode = 0;
  let shutdownCalls = 0;
  let release;
  const shutdown = new Promise((resolve) => { release = resolve; });
  const application = { async shutdown() { shutdownCalls += 1; await shutdown; } };
  installSignalHandlers(application, runtime);
  runtime.emit("SIGTERM"); runtime.emit("SIGINT");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownCalls, 1);
  release(); await shutdown;
  assert.equal(runtime.exitCode, 0);
});
