import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { createServer } from "node:http";
import { SqliteRepository } from "../../src/adapters/sqlite-repository.js";
import { DynamicRuleEvaluator } from "../../src/domain/rulepack-loader.js";
import { createRulepackValidator } from "../../src/server/rulepack-schema.js";
import { createRequestHandler } from "../../src/server/http-service.js";

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function send(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

test("Rules API strict guards, persistence, hot-reload, and 405 rejection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-api-test-"));
  const dbPath = join(dir, "diagnostic.db");
  const repo = new SqliteRepository(dbPath, { migrationsDirectory: join(projectRoot, "migrations") });
  const evaluator = new DynamicRuleEvaluator(repo.listCustomRules());
  const validator = createRulepackValidator(join(projectRoot, "config/schemas/rulepack-v1.schema.json"));
  const token = "secret-token-test";

  const handler = createRequestHandler({
    token,
    repository: repo,
    ruleEvaluator: evaluator,
    rulesValidator: validator,
    accepting: () => true,
    health: { health: () => ({ ready: true }) },
    metricsText: () => ""
  });

  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/v1/rules without auth -> 401
    const unauth = await send(`${baseUrl}/api/v1/rules`);
    assert.equal(unauth.status, 401);
    assert.equal(unauth.json.error, "unauthorized");

    // 2. GET /api/v1/rules with auth -> 200 (empty initially)
    const emptyList = await send(`${baseUrl}/api/v1/rules`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(emptyList.status, 200);
    assert.equal(emptyList.json.total, 0);

    // 3. POST /api/v1/rules with wrong content-type -> 415
    const wrongType = await send(`${baseUrl}/api/v1/rules`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" }
    }, "invalid");
    assert.equal(wrongType.status, 415);

    // 4. POST /api/v1/rules payload > 64 KiB -> 413
    const largeBody = {
      branch: "TD-09",
      ruleName: "TooLarge",
      targetSource: "local_file",
      pattern: "x".repeat(65 * 1024),
      assessment: "Oversized rule",
      classification: "confirmed_cause",
      confidence: "high",
      recommendedActions: ["Check size"]
    };
    const tooLarge = await send(`${baseUrl}/api/v1/rules`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }
    }, largeBody);
    assert.equal(tooLarge.status, 413);

    // 5. POST /api/v1/rules invalid schema -> 400
    const invalidSchema = await send(`${baseUrl}/api/v1/rules`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }
    }, { branch: "INVALID-FORMAT" });
    assert.equal(invalidSchema.status, 400);

    // 6. POST /api/v1/rules with built-in collision (TD-02) -> 409
    const builtinCollision = await send(`${baseUrl}/api/v1/rules`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }
    }, {
      branch: "TD-02",
      ruleName: "OverrideOOM",
      targetSource: "local_file",
      pattern: "OOM",
      assessment: "Override test",
      classification: "confirmed_cause",
      confidence: "high",
      recommendedActions: ["Override"]
    });
    assert.equal(builtinCollision.status, 409);
    assert.equal(builtinCollision.json.error, "rule_branch_conflict");

    // 7. POST /api/v1/rules valid TD-09 rule with category -> 201 Created & Hot-Loaded
    const validRule = {
      branch: "TD-09",
      ruleName: "DatabaseConnectionPoolExhausted",
      category: "database_persistence",
      targetSource: "local_file",
      pattern: "CannotGetJdbcConnectionException",
      assessment: "Tomcat unresponsive: Database connection pool exhausted",
      classification: "confirmed_cause",
      confidence: "high",
      recommendedActions: [
        "Periksa koneksi database PostgreSQL.",
        "Tinjau parameter maxTotal pool."
      ]
    };
    const created = await send(`${baseUrl}/api/v1/rules`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }
    }, validRule);
    assert.equal(created.status, 201);
    assert.equal(created.json.branch, "TD-09");
    assert.equal(created.json.ruleName, "DatabaseConnectionPoolExhausted");
    assert.equal(created.json.category, "database_persistence");

    // 8. Hot-reload check: in-memory evaluator immediately evaluates evidence matching TD-09
    const evidence = [
      { evidenceId: "1", source: "local_file", type: "catalina_out", status: "collected", value: { excerpt: "CannotGetJdbcConnectionException: Connection refused" } }
    ];
    const evaluated = evaluator.evaluate(evidence);
    assert.equal(evaluated.branch, "TD-09");
    assert.equal(evaluated.classification, "confirmed_cause");
    assert.equal(evaluated.category, "database_persistence");

    // 8b. Category filtering check: GET /api/v1/rules?category=database_persistence -> total: 1
    const dbFilter = await send(`${baseUrl}/api/v1/rules?category=database_persistence`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(dbFilter.status, 200);
    assert.equal(dbFilter.json.total, 1);
    assert.equal(dbFilter.json.rules[0].branch, "TD-09");

    // 8c. Category filtering check: GET /api/v1/rules?category=jvm_memory -> total: 0
    const memFilter = await send(`${baseUrl}/api/v1/rules?category=jvm_memory`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(memFilter.status, 200);
    assert.equal(memFilter.json.total, 0);

    // 9. POST /api/v1/rules duplicate branch -> 409 Conflict
    const duplicate = await send(`${baseUrl}/api/v1/rules`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }
    }, validRule);
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.json.error, "rule_branch_conflict");

    // 10. GET /api/v1/rules/TD-09 -> 200 rule detail
    const getDetail = await send(`${baseUrl}/api/v1/rules/TD-09`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(getDetail.status, 200);
    assert.equal(getDetail.json.branch, "TD-09");
    assert.equal(getDetail.json.category, "database_persistence");

    // 11. PUT /api/v1/rules/TD-09 -> 405 Method Not Allowed
    const putRes = await send(`${baseUrl}/api/v1/rules/TD-09`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }
    }, validRule);
    assert.equal(putRes.status, 405);
    assert.equal(putRes.json.error, "method_not_allowed");

    // 12. DELETE /api/v1/rules/TD-09 -> 405 Method Not Allowed
    const deleteRes = await send(`${baseUrl}/api/v1/rules/TD-09`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(deleteRes.status, 405);
    assert.equal(deleteRes.json.error, "method_not_allowed");

  } finally {
    server.close();
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
