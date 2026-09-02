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
