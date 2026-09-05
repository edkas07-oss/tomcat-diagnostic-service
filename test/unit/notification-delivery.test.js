/**
 * @file test/unit/notification-delivery.test.js
 * @project Tomcat Diagnostic Service
 * @description Pengujian unit orkestrasi NotificationDelivery (bounded retries, exponential backoff, max age, kategorisasi error).
 *
 * Pseudocode Alur Pengujian:
 * --------------------------
 * 1. Test "notification delivery persists bounded retries before succeeding":
 *    - Simulasi kegagalan pada percobaan 1 (ECONNREFUSED) dan percobaan 2 (ETIMEDOUT), lalu sukses di percobaan 3.
 *    - Verifikasi urutan delay backoff [1000, 5000] dan riwayat pencatatan ke tabel attempts (pending -> failed connection -> pending -> failed timeout -> pending -> sent).
 * 2. Test "notification delivery stops before retry would exceed maximum age":
 *    - Konfigurasi maxAgeMs = 999ms (< delay 1000ms).
 *    - Verifikasi retry dihentikan sebelum melanggar batas umur maksimum.
 * 3. Test "SMTP errors are reduced to bounded codes":
 *    - Verifikasi kategorisasi kode kanonikal untuk EAUTH (authentication), 451 (smtp_4xx), 550 (smtp_5xx), dan detail sensitif (unknown).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { NotificationDelivery, notificationErrorCode } from "../../src/application/notification-delivery.js";

function fixture(failures = []) {
  const records = [];
  const repository = {
    beginNotificationAttempt: (resultId, attempt) => records.push(["pending", resultId, attempt]),
    finishNotificationAttempt: (resultId, attempt, status, code) => records.push([status, resultId, attempt, code ?? null])
  };
  const smtp = { async send() { const failure = failures.shift(); if (failure) throw failure; } };
  return { records, repository, smtp };
}

test("notification delivery persists bounded retries before succeeding", async () => {
  const item = fixture([{ code: "ECONNREFUSED" }, { code: "ETIMEDOUT" }]);
  const delays = []; let now = 0;
  const delivery = new NotificationDelivery(item.repository, item.smtp, {
    sleep: async (delay) => { delays.push(delay); now += delay; },
    clock: () => now
  });
  const outcome = await delivery.deliver(7, {}, {});
  assert.deepEqual(outcome, { status: "sent", attempts: 3 });
  assert.deepEqual(delays, [1000, 5000]);
  assert.deepEqual(item.records, [
    ["pending", 7, 1], ["failed", 7, 1, "connection"],
    ["pending", 7, 2], ["failed", 7, 2, "timeout"],
    ["pending", 7, 3], ["sent", 7, 3, null]
  ]);
});

test("notification delivery stops before retry would exceed maximum age", async () => {
  const item = fixture([{ code: "ECONNECTION" }]);
  const delivery = new NotificationDelivery(item.repository, item.smtp, {
    policy: { maxAttempts: 3, backoffMs: [1000, 5000], maxAgeMs: 999 },
    sleep: async () => assert.fail("sleep must not run"),
    clock: () => 0
  });
  assert.deepEqual(await delivery.deliver(8, {}, {}), { status: "failed", attempts: 1 });
  assert.deepEqual(item.records, [["pending", 8, 1], ["failed", 8, 1, "connection"]]);
});

test("SMTP errors are reduced to bounded codes", () => {
  assert.equal(notificationErrorCode({ code: "EAUTH" }), "authentication");
  assert.equal(notificationErrorCode({ responseCode: 451 }), "smtp_4xx");
  assert.equal(notificationErrorCode({ responseCode: 550 }), "smtp_5xx");
  assert.equal(notificationErrorCode(new Error("sensitive detail")), "unknown");
});
