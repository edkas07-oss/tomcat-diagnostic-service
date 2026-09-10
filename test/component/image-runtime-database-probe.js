/**
 * @file test/component/image-runtime-database-probe.js
 * @project Tomcat Diagnostic Service
 * @description Probe verifikasi skema database SQLite pasca startup container image.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. Buka database SQLite pada path argumen baris perintah dalam mode read-only.
 * 2. Kueri tabel schema_migrations dan pastikan seluruh versi migrasi terdaftar lengkap.
 * 3. Tutup koneksi database pada blok finally.
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(process.argv[2], { readOnly: true });
try {
  assert.deepEqual(database.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map(({ version }) => version), [1, 2, 3, 4, 5, 6, 7]);
} finally { database.close(); }
