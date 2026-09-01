import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(process.argv[2], { readOnly: true });
try {
  assert.deepEqual(database.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map(({ version }) => version), [1, 2, 3]);
} finally { database.close(); }
