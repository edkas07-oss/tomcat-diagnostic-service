import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { QueueCapacityError } from "../application/bounded-queue.js";

export class MigrationError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "MigrationError";
  }
}

export class SqliteRepository {
  constructor(databasePath, { migrationsDirectory }) {
    this.database = new DatabaseSync(databasePath);
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
          ON CONFLICT(fingerprint) DO UPDATE SET state = excluded.state, resolved_at = excluded.resolved_at, updated_at = excluded.updated_at`)
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

  close() {
    this.database.close();
  }
}
