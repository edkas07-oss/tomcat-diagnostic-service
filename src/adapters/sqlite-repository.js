import { chmodSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { QueueCapacityError } from "../application/bounded-queue.js";

export class MigrationError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "MigrationError";
  }
}

export class RuleCollisionError extends Error {
  constructor(message) {
    super(message);
    this.name = "RuleCollisionError";
  }
}

export class SqliteRepository {
  constructor(databasePath, { migrationsDirectory }) {
    this.database = new DatabaseSync(databasePath);
    if (databasePath !== ":memory:") chmodSync(databasePath, 0o600);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate(migrationsDirectory);
  }

  migrate(directory) {
    this.database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    const applied = new Set(this.database.prepare("SELECT version FROM schema_migrations").all().map(({ version }) => version));
    for (const filename of readdirSync(directory).filter((name) => /^\d{3}-.+\.sql$/.test(name)).sort()) {
      const version = Number.parseInt(filename.slice(0, 3), 10);
      if (applied.has(version)) continue;
      try {
        this.database.exec("BEGIN IMMEDIATE");
        this.database.exec(readFileSync(join(directory, filename), "utf8"));
        this.database.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
          .run(version, basename(filename), new Date().toISOString());
        this.database.exec("COMMIT");
      } catch (error) {
        try { this.database.exec("ROLLBACK"); } catch {}
        throw new MigrationError(`migration failed: ${filename}`, error);
      }
    }
  }

  accept(request, { queueCapacity }) {
    try {
      this.database.exec("BEGIN IMMEDIATE");
      const queued = this.database.prepare("SELECT count(*) AS count FROM work_queue WHERE state IN ('queued', 'processing')").get().count;
      const requestKeys = new Set();
      const unique = request.alerts.filter((alert) => {
        if (requestKeys.has(alert.eventKey)) return false;
        requestKeys.add(alert.eventKey);
        return !this.database.prepare("SELECT 1 FROM events WHERE event_key = ?").get(alert.eventKey);
      });
      if (queued + unique.length > queueCapacity) throw new QueueCapacityError(queueCapacity);

      const requestResult = this.database.prepare("INSERT INTO requests(group_key, receiver, status, accepted_at) VALUES (?, ?, ?, ?)")
        .run(request.groupKey, request.receiver, request.status, request.acceptedAt);
      const requestId = Number(requestResult.lastInsertRowid);
      const results = [];

      for (const alert of request.alerts) {
        const existing = this.database.prepare("SELECT id FROM events WHERE event_key = ?").get(alert.eventKey);
        if (existing) {
          results.push({ eventKey: alert.eventKey, duplicate: true });
          continue;
        }
        this.database.prepare(`INSERT INTO incidents(fingerprint, environment, host, tomcat_instance, state, first_firing_at, resolved_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(fingerprint) DO UPDATE SET
            state = excluded.state,
            first_firing_at = CASE WHEN incidents.state = 'resolved' AND excluded.state = 'firing' THEN excluded.first_firing_at ELSE COALESCE(incidents.first_firing_at, excluded.first_firing_at) END,
            resolved_at = excluded.resolved_at,
            updated_at = excluded.updated_at,
            resolved_notification_count = CASE WHEN incidents.state = 'resolved' AND excluded.state = 'firing' THEN 0 ELSE incidents.resolved_notification_count END,
            material_update_count = CASE WHEN incidents.state = 'resolved' AND excluded.state = 'firing' THEN 0 ELSE incidents.material_update_count END`)
          .run(alert.fingerprint, alert.labels.environment, alert.labels.host, alert.labels.tomcat_instance,
            alert.status, alert.status === "firing" ? alert.eventTime : null,
            alert.status === "resolved" ? alert.eventTime : null, request.acceptedAt);
        const inserted = this.database.prepare(`INSERT INTO events(request_id, event_key, fingerprint, status, event_time, labels_json, annotations_json, accepted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(requestId, alert.eventKey, alert.fingerprint, alert.status, alert.eventTime,
            JSON.stringify(alert.labels), JSON.stringify(alert.annotations), request.acceptedAt);
        this.database.prepare("INSERT INTO work_queue(event_id, created_at) VALUES (?, ?)")
          .run(Number(inserted.lastInsertRowid), request.acceptedAt);
        results.push({ eventKey: alert.eventKey, duplicate: false });
      }
      this.database.exec("COMMIT");
      return { requestId, events: results };
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  claimNext() {
    try {
      this.database.exec("BEGIN IMMEDIATE");
      const item = this.database.prepare("SELECT id, event_id FROM work_queue WHERE state = 'queued' ORDER BY id LIMIT 1").get();
      if (item) this.database.prepare("UPDATE work_queue SET state = 'processing', started_at = ? WHERE id = ?").run(new Date().toISOString(), item.id);
      this.database.exec("COMMIT");
      return item ?? null;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  complete(queueId, succeeded = true) {
    this.database.prepare("UPDATE work_queue SET state = ?, completed_at = ? WHERE id = ? AND state = 'processing'")
      .run(succeeded ? "completed" : "failed", new Date().toISOString(), queueId);
  }

  eventForQueue(queueId) {
    const row = this.database.prepare(`SELECT e.*, i.environment, i.host, i.tomcat_instance, i.first_firing_at FROM work_queue q JOIN events e ON e.id=q.event_id JOIN incidents i ON i.fingerprint=e.fingerprint WHERE q.id=?`).get(queueId);
    if (!row) throw new RangeError("queue item not found");
    const labels = JSON.parse(row.labels_json);
    return { eventKey: row.event_key, fingerprint: row.fingerprint, status: row.status, startsAt: row.status === "firing" ? row.event_time : row.first_firing_at, endsAt: row.status === "resolved" ? row.event_time : null, targetId: `${row.environment}/${row.host}/${row.tomcat_instance}`, generation: null, labels };
  }

  saveCanonicalResult(queueId, result) {
    const eventId = this.database.prepare("SELECT event_id FROM work_queue WHERE id=?").get(queueId)?.event_id;
    const inserted = this.database.prepare(`INSERT INTO canonical_results(event_id, diagnostic_id, schema_version, processing_status, classification, confidence, result_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(eventId, result.diagnosticId, result.schemaVersion, result.processingStatus, result.assessment.classification, result.assessment.confidence, result.resultHash, JSON.stringify(result), result.timing.completedAt);
    const resultId = Number(inserted.lastInsertRowid);
    for (const evidence of result.evidence) this.database.prepare("INSERT INTO evidence_summaries(result_id,evidence_id,source,status,summary_json) VALUES(?,?,?,?,?)").run(resultId, evidence.evidenceId, evidence.source, evidence.status, JSON.stringify(evidence));
    return resultId;
  }

  latestCanonicalResult(fingerprint, lifecycleStatus = null) {
    const incident = this.database.prepare("SELECT first_firing_at FROM incidents WHERE fingerprint=?").get(fingerprint);
    const since = incident?.first_firing_at ?? null;
    const row = this.database.prepare(`SELECT c.result_json FROM canonical_results c JOIN events e ON e.id=c.event_id
      WHERE e.fingerprint=? AND (? IS NULL OR e.status=?) AND (? IS NULL OR e.accepted_at >= ? OR e.event_time >= ?) ORDER BY c.id DESC LIMIT 1`)
      .get(fingerprint, lifecycleStatus, lifecycleStatus, since, since, since);
    return row ? JSON.parse(row.result_json) : null;
  }

  reserveMaterialUpdate(fingerprint) {
    const result = this.database.prepare("UPDATE incidents SET material_update_count=1 WHERE fingerprint=? AND material_update_count=0").run(fingerprint);
    return Number(result.changes) === 1;
  }

  reserveResolvedNotification(fingerprint) {
    const result = this.database.prepare("UPDATE incidents SET resolved_notification_count=1 WHERE fingerprint=? AND resolved_notification_count=0").run(fingerprint);
    return Number(result.changes) === 1;
  }

  beginNotificationAttempt(resultId, attempt) {
    this.database.prepare("INSERT INTO notification_attempts(result_id,attempt,status,error_code,attempted_at) VALUES(?,?,'pending',NULL,?)")
      .run(resultId, attempt, new Date().toISOString());
  }

  finishNotificationAttempt(resultId, attempt, status, errorCode = null) {
    if (!["sent", "failed"].includes(status)) throw new TypeError("invalid notification status");
    const updated = this.database.prepare("UPDATE notification_attempts SET status=?, error_code=?, attempted_at=? WHERE result_id=? AND attempt=? AND status='pending'")
      .run(status, errorCode, new Date().toISOString(), resultId, attempt);
    if (Number(updated.changes) !== 1) throw new RangeError("notification attempt is not pending");
  }

  insertCustomRule(rule, createdBy = "operator-sre") {
    const existing = this.getCustomRuleByBranch(rule.branch);
    if (existing) {
      throw new RuleCollisionError(`Branch '${rule.branch}' already exists in custom rules`);
    }
    const ruleId = rule.ruleId ?? "TomcatDown";
    const category = rule.category ?? "general";
    const ruleJson = JSON.stringify({ ...rule, category });
    const createdAt = new Date().toISOString();
    try {
      const result = this.database.prepare(`
        INSERT INTO custom_rules(rule_id, branch, name, category, target_source, pattern, assessment, classification, confidence, rule_json, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ruleId,
        rule.branch,
        rule.ruleName,
        category,
        rule.targetSource,
        rule.pattern,
        rule.assessment,
        rule.classification,
        rule.confidence ?? null,
        ruleJson,
        createdBy,
        createdAt
      );
      return {
        id: Number(result.lastInsertRowid),
        ruleId,
        branch: rule.branch,
        ruleName: rule.ruleName,
        category,
        targetSource: rule.targetSource,
        pattern: rule.pattern,
        assessment: rule.assessment,
        classification: rule.classification,
        confidence: rule.confidence ?? null,
        recommendedActions: rule.recommendedActions ?? [],
        createdBy,
        createdAt
      };
    } catch (error) {
      if (error?.message?.includes("UNIQUE constraint failed")) {
        throw new RuleCollisionError(`Branch '${rule.branch}' already exists`);
      }
      throw error;
    }
  }

  listCustomRules(category = null) {
    const rows = category
      ? this.database.prepare("SELECT * FROM custom_rules WHERE category = ? ORDER BY id ASC").all(category)
      : this.database.prepare("SELECT * FROM custom_rules ORDER BY id ASC").all();
    return rows.map((row) => {
      const parsed = JSON.parse(row.rule_json);
      return {
        id: row.id,
        ruleId: row.rule_id,
        branch: row.branch,
        ruleName: row.name,
        category: row.category ?? parsed.category ?? "general",
        targetSource: row.target_source,
        pattern: row.pattern,
        assessment: row.assessment,
        classification: row.classification,
        confidence: row.confidence,
        recommendedActions: parsed.recommendedActions ?? [],
        createdBy: row.created_by,
        createdAt: row.created_at
      };
    });
  }

  getCustomRuleByBranch(branch) {
    const row = this.database.prepare("SELECT * FROM custom_rules WHERE branch = ?").get(branch);
    if (!row) return null;
    const parsed = JSON.parse(row.rule_json);
    return {
      id: row.id,
      ruleId: row.rule_id,
      branch: row.branch,
      ruleName: row.name,
      category: row.category ?? parsed.category ?? "general",
      targetSource: row.target_source,
      pattern: row.pattern,
      assessment: row.assessment,
      classification: row.classification,
      confidence: row.confidence,
      recommendedActions: parsed.recommendedActions ?? [],
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  }

  getCustomRuleById(id) {
    const row = this.database.prepare("SELECT * FROM custom_rules WHERE id = ?").get(id);
    if (!row) return null;
    const parsed = JSON.parse(row.rule_json);
    return {
      id: row.id,
      ruleId: row.rule_id,
      branch: row.branch,
      ruleName: row.name,
      category: row.category ?? parsed.category ?? "general",
      targetSource: row.target_source,
      pattern: row.pattern,
      assessment: row.assessment,
      classification: row.classification,
      confidence: row.confidence,
      recommendedActions: parsed.recommendedActions ?? [],
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  }

  close() {
    this.database.close();
  }
}
