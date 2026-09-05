/**
 * @file test/unit/smtp-adapter.test.js
 * @project Tomcat Diagnostic Service
 * @description Pengujian unit SmtpAdapter (pembuatan pesan email multipart/alternative tanpa akses jaringan).
 *
 * Pseudocode Alur Pengujian:
 * --------------------------
 * 1. Buat streamTransport in-memory Nodemailer.
 * 2. Inisialisasi SmtpAdapter dengan transport mock.
 * 3. Kirim email via `adapter.send()` dan verifikasi struktur header/payload `multipart/alternative`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import nodemailer from "nodemailer";
import { SmtpAdapter } from "../../src/adapters/smtp-adapter.js";

test("SMTP adapter produces bounded multipart message without network", async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const adapter = new SmtpAdapter({ from: "diagnostic@tomcat.invalid", to: "operator@tomcat.invalid" }, { transport });
  const info = await adapter.send({ lifecycleStatus: "firing", targetId: "lab/host/one" }, { text: "safe text", html: "<p>safe</p>" });
  const message = info.message.toString();
  assert.ok(message.includes("diagnostic@tomcat.invalid")); assert.ok(message.includes("multipart/alternative"));
});
