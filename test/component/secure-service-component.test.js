import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer as createTcpServer } from "node:net";
import { test } from "node:test";
import { once } from "node:events";
import { createHttpsService } from "../../src/server/http-service.js";
import { SmtpAdapter } from "../../src/adapters/smtp-adapter.js";
import { SqliteRepository } from "../../src/adapters/sqlite-repository.js";
import { BoundedWorkQueue } from "../../src/application/bounded-queue.js";
import { DiagnosticWorker } from "../../src/application/diagnostic-worker.js";
import { NotificationDelivery } from "../../src/application/notification-delivery.js";
import { ingestAlertmanager, targetKey } from "../../src/application/ingest-alertmanager.js";
import { createEvidence } from "../../src/domain/evidence.js";
import { createWebhookValidator } from "../../src/server/webhook-schema.js";
import { webhook } from "../fixtures/alertmanager-webhook.js";

const keyPath = process.env.TN008_TLS_KEY;
const certPath = process.env.TN008_TLS_CERT;

function httpsCall(port, ca, { method = "GET", path = "/health/live", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest({ hostname: "127.0.0.1", port, method, path, headers, ca, servername: "localhost", rejectUnauthorized: true }, (response) => {
      const chunks = []; response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    request.on("error", reject); request.end(body);
  });
}

async function fakeSmtpServer() {
  const messages = [];
  const server = createTcpServer((socket) => {
    let dataMode = false; let message = "";
    socket.write("220 localhost ESMTP test\r\n");
    socket.on("data", (buffer) => {
      for (const line of buffer.toString().split("\r\n").filter(Boolean)) {
        if (dataMode) {
          if (line === ".") { messages.push(message); dataMode = false; socket.write("250 queued\r\n"); }
          else message += `${line}\n`;
        } else if (/^(EHLO|HELO)/.test(line)) socket.write("250-localhost\r\n250 PIPELINING\r\n");
        else if (/^(MAIL FROM|RCPT TO)/.test(line)) socket.write("250 ok\r\n");
        else if (line === "DATA") { dataMode = true; socket.write("354 end with dot\r\n"); }
        else if (line === "QUIT") { socket.write("221 bye\r\n"); socket.end(); }
        else socket.write("250 ok\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { server, port: server.address().port, messages };
}

test("actual TLS socket enforces CA and exposes bounded endpoints", { skip: !keyPath || !certPath }, async () => {
  const key = readFileSync(keyPath); const cert = readFileSync(certPath);
  const options = { token: "component-token", health: { health: () => ({ live: true, ready: true }) }, metricsText: () => "queue_depth 0\n", ingestion: {} };
  const server = createHttpsService({ key, cert }, options); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const port = server.address().port;
    assert.equal((await httpsCall(port, cert)).status, 200);
    assert.equal((await httpsCall(port, cert, { path: "/metrics" })).body, "queue_depth 0\n");
    assert.equal((await httpsCall(port, cert, { method: "POST", path: "/api/v1/alerts/alertmanager" })).status, 401);
    await assert.rejects(() => httpsCall(port, Buffer.from("untrusted")));
  } finally { server.close(); await once(server, "close"); }
});

test("SMTP adapter delivers multipart message to an ephemeral listener", async () => {
  const fixture = await fakeSmtpServer();
  try {
    const adapter = new SmtpAdapter({ host: "127.0.0.1", port: fixture.port, timeoutMs: 2000, from: "diagnostic@tomcat.invalid", to: "operator@tomcat.invalid" });
    await adapter.send({ lifecycleStatus: "firing", targetId: "lab/host/one" }, { text: "plain evidence", html: "<p>plain evidence</p>" });
    assert.equal(fixture.messages.length, 1); assert.ok(fixture.messages[0].includes("multipart/alternative"));
  } finally { fixture.server.close(); await once(fixture.server, "close"); }
});

test("worker persists and delivers a rendered result through an actual SMTP socket", async () => {
  const fixture = await fakeSmtpServer(); const directory = mkdtempSync(join(tmpdir(), "notification-socket-"));
  const repository = new SqliteRepository(join(directory, "db.sqlite"), { migrationsDirectory: resolve("migrations") });
  try {
    const queue = new BoundedWorkQueue(repository);
    const validate = createWebhookValidator(resolve("config/schemas/alertmanager-webhook-v4.schema.json"));
    const allowedTargets = new Set([targetKey({ environment: "lab", host: "tomcat-01", tomcat_instance: "default" })]);
    ingestAlertmanager(webhook(), { queue, validate, allowedTargets, now: () => new Date("2026-08-31T01:01:00Z") });
    const smtp = new SmtpAdapter({ host: "127.0.0.1", port: fixture.port, timeoutMs: 2000, from: "diagnostic@tomcat.invalid", to: "operator@tomcat.invalid" });
    const notification = new NotificationDelivery(repository, smtp);
    const collect = async (event) => [createEvidence({ source: "fixture", type: "container_state", targetId: event.targetId, observedAt: "2026-08-31T01:00:00Z", collectedAt: "2026-08-31T01:01:00Z", status: "collected", strength: "direct", value: { state: "exited" } })];
    const worker = new DiagnosticWorker(repository, collect, { clock: () => new Date("2026-08-31T01:02:00Z"), notification });
    const result = await worker.runOnce();
    assert.equal(result.assessment.branch, "TD-06");
    assert.equal(fixture.messages.length, 1);
    assert.ok(fixture.messages[0].includes("Rule and Diagnostic Traceability"));
    assert.equal(repository.database.prepare("SELECT status FROM notification_attempts").get().status, "sent");
  } finally {
    repository.close(); fixture.server.close(); await once(fixture.server, "close");
    rmSync(directory, { recursive: true, force: true });
  }
});
