/**
 * @file src/server/http-service.js
 * @project Tomcat Diagnostic Service
 * @author Eddy Wiyatno <edkas07@gmail.com>
 * @license Proprietary & Confidential
 * @description Server HTTPS internal dan Request Handler antarmuka eksternal.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. createRequestHandler:
 *    a. GET /health/live -> respons HTTP 200 { status: "UP" }.
 *    b. GET /health/ready -> respons HTTP 200 (jika ready) atau 503 Service Unavailable.
 *    c. GET /metrics -> respons HTTP 200 format Prometheus text/plain.
 *    d. POST /api/v1/alerts/alertmanager:
 *       - Validasi method POST, status accepting (graceful shutdown), Bearer auth timing-safe, header application/json.
 *       - Buffer payload request dengan batas ukuran 256 KiB (HTTP 413 jika melebihi).
 *       - Eksekusi `ingestAlertmanager()` -> respons HTTP 202 Accepted { accepted, duplicate }.
 *       - Tangani error validasi (400), target tidak terdaftar (422), kapasitas antrean penuh (429), dan JSON rusak (400).
 *    e. GET /api/v1/rules:
 *       - Validasi Bearer auth.
 *       - Ambil daftar custom rules dari database (opsional filter `?category=`), gabungkan dengan built-in rules, respons HTTP 200.
 *    f. POST /api/v1/rules:
 *       - Validasi Bearer auth, content-type JSON, buffer payload max 64 KiB.
 *       - Validasi JSON Schema Rulepack v1 via `validateRulepack()`.
 *       - Validasi collision: tolak jika branch sama dengan built-in TD-01..TD-08.
 *       - Simpan rulepack ke SQLite via `saveCustomRule()` dan mutasi evaluator via `registerRule()`.
 *       - Respons HTTP 201 Created.
 *    g. Endpoint lainnya -> respons HTTP 404 Not Found.
 *
 * Endpoint yang Dilayani:
 * - `POST /api/v1/alerts` : Webhook ingestion Alertmanager v4 (Bearer auth timing-safe, batas 256 KiB).
 * - `GET /health`         : Status ketersediaan layanan untuk scrape Prometheus / probing liveness.
 * - `GET /health/live`    : Kubernetes/Podman liveness probe.
 * - `GET /health/ready`   : Readiness probe (aktif setelah migrasi database sukses).
 * - `GET /metrics`        : Metrik operasional internal format Prometheus text format.
 * - `POST /api/v1/rules`  : Declarative Rulepack Ingestion (5-Layer Guard: Auth, Schema, Collision, Size, Append-only).
 * - `GET /api/v1/rules`   : Export katalog aturan dengan filter domain `?category=<enum>`.
 */

import { createServer } from "node:https";
import { timingSafeEqual } from "node:crypto";
import { IngestionValidationError, ingestAlertmanager } from "../application/ingest-alertmanager.js";
import { QueueCapacityError } from "../application/bounded-queue.js";
import { RuleCollisionError } from "../adapters/sqlite-repository.js";
import { isBuiltinBranch } from "../domain/rulepack-loader.js";

const json = (response, status, body, headers = {}) => {
  response.writeHead(status, {
    "content-type": "application/json",
    "x-engine-architect": "Eddy Wiyatno",
    "x-diagnostic-engine": "Tomcat Diagnostic Engine/1.0",
    ...headers
  });
  response.end(JSON.stringify(body));
};

const authenticated = (header, token) => {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const supplied = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};

export function createRequestHandler(options) {
  const rulesLimitBytes = 64 * 1024;

  return async (request, response) => {
    const urlObj = new URL(request.url ?? "/", "http://localhost");
    const url = urlObj.pathname;
    const categoryQuery = urlObj.searchParams.get("category");

    if (request.method === "GET" && url === "/health/live") return json(response, 200, { status: "UP" });
    if (request.method === "GET" && url === "/health/ready") return json(response, options.health.health().ready ? 200 : 503, options.health.health());
    if (request.method === "GET" && url === "/metrics") {
      response.writeHead(200, {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
        "x-engine-architect": "Eddy Wiyatno",
        "x-diagnostic-engine": "Tomcat Diagnostic Engine/1.0"
      });
      return response.end(options.metricsText());
    }

    if (url === "/api/v1/alerts/alertmanager") {
      if (request.method !== "POST") return json(response, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      if (options.accepting && !options.accepting()) return json(response, 503, { error: "shutting_down" });
      if (!authenticated(request.headers.authorization, options.token)) return json(response, 401, { error: "unauthorized" });
      if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") return json(response, 415, { error: "unsupported_media_type" });

      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > (options.requestLimitBytes ?? 256 * 1024)) return json(response, 413, { error: "payload_too_large" });
        chunks.push(chunk);
      }

      try {
        const result = ingestAlertmanager(JSON.parse(Buffer.concat(chunks)), options.ingestion);
        return json(response, 202, {
          accepted: result.events.filter((e) => !e.duplicate).length,
          duplicate: result.events.filter((e) => e.duplicate).length
        });
      } catch (error) {
        if (error instanceof QueueCapacityError) return json(response, 429, { error: "queue_full" });
        if (error instanceof SyntaxError || error instanceof IngestionValidationError) return json(response, 400, { error: "invalid_request" });
        return json(response, 503, { error: "unavailable" });
      }
    }

    if (url === "/api/v1/rules" || url.startsWith("/api/v1/rules/")) {
      if (["PUT", "DELETE", "PATCH"].includes(request.method)) {
        return json(response, 405, {
          error: "method_not_allowed",
          message: "Rules API is append-only. Modification and deletion of rules are prohibited."
        }, { Allow: "GET, POST" });
      }

      if (!authenticated(request.headers.authorization, options.token)) {
        return json(response, 401, { error: "unauthorized" });
      }

      if (request.method === "GET" && url === "/api/v1/rules") {
        const rules = options.ruleEvaluator
          ? options.ruleEvaluator.getRules(categoryQuery)
          : (options.repository ? options.repository.listCustomRules(categoryQuery) : []);
        return json(response, 200, { rules, total: rules.length, ...(categoryQuery ? { category: categoryQuery } : {}) });
      }

      if (request.method === "GET" && url.startsWith("/api/v1/rules/")) {
        const identifier = decodeURIComponent(url.slice("/api/v1/rules/".length));
        if (!identifier) return json(response, 404, { error: "not_found" });

        let rule = options.ruleEvaluator?.getRuleByBranch(identifier) ?? options.ruleEvaluator?.getRuleById(identifier);
        if (!rule && options.repository) {
          rule = options.repository.getCustomRuleByBranch(identifier) ?? options.repository.getCustomRuleById(identifier);
        }
        if (!rule) return json(response, 404, { error: "not_found" });
        return json(response, 200, rule);
      }

      if (request.method === "POST" && url === "/api/v1/rules") {
        if (options.accepting && !options.accepting()) return json(response, 503, { error: "shutting_down" });
        if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
          return json(response, 415, { error: "unsupported_media_type" });
        }

        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > rulesLimitBytes) return json(response, 413, { error: "payload_too_large" });
          chunks.push(chunk);
        }

        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return json(response, 400, { error: "invalid_json_payload" });
        }

        if (options.rulesValidator) {
          const validation = options.rulesValidator(body);
          if (!validation.valid) {
            return json(response, 400, {
              error: validation.error ?? "invalid_rule_schema",
              details: validation.details
            });
          }
        }

        if (isBuiltinBranch(body.branch)) {
          return json(response, 409, {
            error: "rule_branch_conflict",
            message: `Branch '${body.branch}' conflicts with built-in rule branches (TD-01..TD-08)`
          });
        }

        try {
          const createdBy = body.createdBy || "operator-sre";
          const savedRule = options.repository?.insertCustomRule(body, createdBy) ?? { ...body, createdBy, createdAt: new Date().toISOString() };
          
          if (options.ruleEvaluator) {
            options.ruleEvaluator.registerRule(savedRule);
          }

          return json(response, 201, savedRule);
        } catch (error) {
          if (error instanceof RuleCollisionError) {
            return json(response, 409, {
              error: "rule_branch_conflict",
              message: error.message
            });
          }
          return json(response, 500, { error: "internal_error" });
        }
      }

      return json(response, 405, { error: "method_not_allowed" }, { Allow: "GET, POST" });
    }

    return json(response, 404, { error: "not_found" });
  };
}

export function createHttpsService(tls, options) {
  return createServer(tls, createRequestHandler(options));
}
