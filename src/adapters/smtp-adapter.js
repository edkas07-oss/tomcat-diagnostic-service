/**
 * @file src/adapters/smtp-adapter.js
 * @project Tomcat Diagnostic Service
 * @description Adapter pengiriman email laporan diagnosis insiden via SMTP (Nodemailer).
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. constructor(config, { transport }):
 *    - Inisialisasi alamat pengirim (from) dan penerima (to).
 *    - Konfigurasi transport Nodemailer dengan host, port, credentials, timeouts, serta flag proteksi `disableFileAccess` dan `disableUrlAccess`.
 * 2. send(result, rendered):
 *    a. Tentukan status lifecycle (`resolved` atau firing/critical).
 *    b. Format subject email:
 *       - Jika resolved: `[RESOLVED] [<ENV>] Tomcat Service: <AlertName> Restored (Target: <targetId>)`
 *       - Jika firing: `[CRITICAL] [<ENV>] Tomcat Service: <AlertName> (Target: <targetId>)`
 *    c. Kirim pesan multipart melalui `transport.sendMail()` dengan `text` dan `html` ter-render.
 *
 * Batasan Keamanan (TN-008, TN-012):
 * - Menggunakan client exact-pinned `nodemailer@9.0.6` dengan zero transitive dependencies.
 * - Mengisolasi transport: `disableFileAccess: true` dan `disableUrlAccess: true` untuk mencegah kebocoran file lokal.
 * - Menerapkan batas waktu ketat: connectionTimeout, greetingTimeout, dan socketTimeout.
 * - Menghasilkan email multipart (HTML + Plain Text) laporan 7 seksi Enterprise SRE ke Mailpit / relay server.
 */

import nodemailer from "nodemailer";

export class SmtpAdapter {
  constructor(config, { transport } = {}) {
    this.from = config.from; this.to = config.to;
    this.transport = transport ?? nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure ?? false, requireTLS: config.requireTLS ?? false, auth: config.username ? { user: config.username, pass: config.password } : undefined, connectionTimeout: config.timeoutMs, greetingTimeout: config.timeoutMs, socketTimeout: config.timeoutMs, disableFileAccess: true, disableUrlAccess: true });
  }
  async send(result, rendered) {
    const isResolved = result.lifecycleStatus === "resolved";
    const env = (result.targetId?.split("/")[0] || "lab").toUpperCase();
    const alertName = result.ruleId || "TomcatDown";
    const severity = (result.event?.labels?.severity || (alertName === "TomcatDown" ? "critical" : "warning")).toUpperCase();
    const prefix = isResolved ? "[RESOLVED]" : `[${severity}]`;
    const subject = isResolved
      ? `${prefix} [${env}] Tomcat Service: ${alertName} Restored (Target: ${result.targetId})`
      : `${prefix} [${env}] Tomcat Service: ${alertName} (Target: ${result.targetId})`;
    const priority = (!isResolved && severity === "CRITICAL") ? "1" : "3";
    const headers = {
      "Auto-Submitted": "auto-generated",
      "X-Priority": priority,
      "X-Incident-Target": result.targetId || "unknown",
      "X-Diagnostic-Rule": alertName
    };
    return this.transport.sendMail({ from: this.from, to: this.to, subject, text: rendered.text, html: rendered.html, headers });
  }
}
