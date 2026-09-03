import { createServer } from "node:https";
import { timingSafeEqual } from "node:crypto";
import { IngestionValidationError, ingestAlertmanager } from "../application/ingest-alertmanager.js";
import { QueueCapacityError } from "../application/bounded-queue.js";
import { RuleCollisionError } from "../adapters/sqlite-repository.js";
import { isBuiltinBranch } from "../domain/rulepack-loader.js";

const json = (response, status, body, headers = {}) => {
  response.writeHead(status, { "content-type": "application/json", ...headers });
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
      response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
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
