import nodemailer from "nodemailer";

export class SmtpAdapter {
  constructor(config, { transport } = {}) {
    this.from = config.from; this.to = config.to;
    this.transport = transport ?? nodemailer.createTransport({ host: config.host, port: config.port, secure: false, connectionTimeout: config.timeoutMs, greetingTimeout: config.timeoutMs, socketTimeout: config.timeoutMs, disableFileAccess: true, disableUrlAccess: true });
  }
  async send(result, rendered) {
    return this.transport.sendMail({ from: this.from, to: this.to, subject: `[${result.lifecycleStatus}] TomcatDown ${result.targetId}`, text: rendered.text, html: rendered.html });
  }
}
