/**
 * @file src/adapters/smtp-adapter.js
 * @project Tomcat Diagnostic Service
 * @description Adapter pengiriman email laporan diagnosis insiden via SMTP (Nodemailer).
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
    this.transport = transport ?? nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure ?? false, auth: config.username ? { user: config.username, pass: config.password } : undefined, connectionTimeout: config.timeoutMs, greetingTimeout: config.timeoutMs, socketTimeout: config.timeoutMs, disableFileAccess: true, disableUrlAccess: true });
  }
  async send(result, rendered) {
    const isResolved = result.lifecycleStatus === "resolved";
    const env = (result.targetId?.split("/")[0] || "lab").toUpperCase();
    const alertName = result.ruleId || "TomcatDown";
    const subject = isResolved
      ? `[RESOLVED] [${env}] Tomcat Service: ${alertName} Restored (Target: ${result.targetId})`
      : `[CRITICAL] [${env}] Tomcat Service: ${alertName} (Target: ${result.targetId})`;
    return this.transport.sendMail({ from: this.from, to: this.to, subject, text: rendered.text, html: rendered.html });
  }
}
