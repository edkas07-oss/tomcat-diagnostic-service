/**
 * @file test/component/image-runtime-probe.js
 * @project Tomcat Diagnostic Service
 * @description Probe polling kesehatan HTTPS (live, ready, metrics) pada container image yang sedang berjalan.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. Baca sertifikat CA dari argumen baris perintah dan port HTTPS dari environment `TN010_HTTPS_PORT`.
 * 2. Lakukan polling berulang (maksimal 50 kali dengan interval 100ms) ke endpoint `/health/ready` via HTTPS.
 * 3. Verifikasi respons HTTP 200 dengan payload `{ live: true, ready: true }`.
 * 4. Verifikasi respons HTTP 200 pada endpoint `/health/live` dan `/metrics`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:https";

const [certificatePath] = process.argv.slice(2);
const port = Number.parseInt(process.env.TN010_HTTPS_PORT ?? "", 10);
const ca = readFileSync(certificatePath);

function get(path) {
  return new Promise((resolve, reject) => {
    const call = request({ hostname: "127.0.0.1", port, path, ca, servername: "localhost", rejectUnauthorized: true }, (response) => {
      const chunks = []; response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    call.on("error", reject); call.end();
  });
}

let ready;
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { ready = await get("/health/ready"); if (ready.status === 200) break; } catch {}
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(ready?.status, 200);
assert.deepEqual(JSON.parse(ready.body), { live: true, ready: true });
assert.equal((await get("/health/live")).status, 200);
assert.equal((await get("/metrics")).status, 200);
