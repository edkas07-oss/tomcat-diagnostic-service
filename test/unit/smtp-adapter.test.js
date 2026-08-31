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
