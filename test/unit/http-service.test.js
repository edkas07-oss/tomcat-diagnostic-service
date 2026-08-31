import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { createRequestHandler } from "../../src/server/http-service.js";

async function call({ method = "POST", url = "/api/v1/alerts/alertmanager", headers = {}, body = "" }, overrides = {}) {
  const request = Readable.from([Buffer.from(body)]); Object.assign(request, { method, url, headers });
  const response = { status: null, headers: null, body: "", writeHead(status, responseHeaders) { this.status = status; this.headers = responseHeaders; }, end(value = "") { this.body += value; } };
  const options = { token: "test-token", health: { health: () => ({ live: true, ready: true }) }, metricsText: () => "queue_depth 0\n", ingestion: { queue: { accept: () => ({ events: [{ duplicate: false }] }) }, validate: () => true, allowedTargets: new Set(), now: () => new Date() }, ...overrides };
  await createRequestHandler(options)(request, response); return response;
}

test("HTTP boundary rejects auth, media type, and oversized bodies", async () => {
  assert.equal((await call({})).status, 401);
  assert.equal((await call({ headers: { authorization: "Bearer test-token", "content-type": "text/plain" } })).status, 415);
  assert.equal((await call({ headers: { authorization: "Bearer test-token", "content-type": "application/json" }, body: "x".repeat(256 * 1024 + 1) })).status, 413);
});

test("health and metrics interfaces expose bounded state", async () => {
  assert.equal((await call({ method: "GET", url: "/health/live" })).status, 200);
  assert.equal((await call({ method: "GET", url: "/health/ready" })).status, 200);
  assert.equal((await call({ method: "GET", url: "/metrics" })).body, "queue_depth 0\n");
});
