import { createServer } from "node:https";
import { timingSafeEqual } from "node:crypto";
import { IngestionValidationError, ingestAlertmanager } from "../application/ingest-alertmanager.js";
import { QueueCapacityError } from "../application/bounded-queue.js";

const json = (response, status, body) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
const authenticated = (header, token) => { const prefix = "Bearer "; if (!header?.startsWith(prefix)) return false; const supplied = Buffer.from(header.slice(prefix.length)); const expected = Buffer.from(token); return supplied.length === expected.length && timingSafeEqual(supplied, expected); };

export function createRequestHandler(options) {
  return async (request, response) => {
    if (request.method === "GET" && request.url === "/health/live") return json(response, 200, { status: "UP" });
    if (request.method === "GET" && request.url === "/health/ready") return json(response, options.health.health().ready ? 200 : 503, options.health.health());
    if (request.method === "GET" && request.url === "/metrics") { response.writeHead(200, { "content-type": "text/plain" }); return response.end(options.metricsText()); }
    if (request.method !== "POST" || request.url !== "/api/v1/alerts/alertmanager") return json(response, 404, { error: "not_found" });
    if (!authenticated(request.headers.authorization, options.token)) return json(response, 401, { error: "unauthorized" });
    if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") return json(response, 415, { error: "unsupported_media_type" });
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 256 * 1024) return json(response, 413, { error: "payload_too_large" }); chunks.push(chunk); }
    try { const result = ingestAlertmanager(JSON.parse(Buffer.concat(chunks)), options.ingestion); return json(response, 202, { accepted: result.events.filter((e) => !e.duplicate).length, duplicate: result.events.filter((e) => e.duplicate).length }); }
    catch (error) { if (error instanceof QueueCapacityError) return json(response, 429, { error: "queue_full" }); if (error instanceof SyntaxError || error instanceof IngestionValidationError) return json(response, 400, { error: "invalid_request" }); return json(response, 503, { error: "unavailable" }); }
  };
}
export function createHttpsService(tls, options) { return createServer(tls, createRequestHandler(options)); }
