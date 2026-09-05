-- ==============================================================================
-- Migration : 001-initial.sql
-- Project   : Tomcat Diagnostic Service
-- Origin    : TN-005 (Implement Durable Diagnostic Ingestion and Queue)
-- Purpose   : Skema dasar persistensi webhook Alertmanager, insiden, event,
--             dan antrean kerja berbatas (bounded FIFO work queue).
--
-- Pseudocode Skema & Relasi Database:
-- -----------------------------------
-- 1. Inisialisasi tabel schema_migrations untuk mencatat riwayat migrasi.
-- 2. requests: Catat payload request masuk (group_key, receiver, status firing/resolved).
-- 3. incidents: Entity insiden unik per fingerprint (environment, host, tomcat_instance, state).
-- 4. events: Pencatatan event alert atomik dengan UNIQUE event_key untuk deduplikasi mutlak.
-- 5. work_queue: Antrean kerja FIFO berstatus queued -> processing -> completed/failed,
--    terikat secara 1:1 dengan event_id.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
);

CREATE TABLE requests (
    id INTEGER PRIMARY KEY,
    group_key TEXT NOT NULL,
    receiver TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('firing', 'resolved')),
    accepted_at TEXT NOT NULL
);

CREATE TABLE incidents (
    fingerprint TEXT PRIMARY KEY,
    environment TEXT NOT NULL,
    host TEXT NOT NULL,
    tomcat_instance TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('firing', 'resolved')),
    first_firing_at TEXT,
    resolved_at TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id),
    event_key TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL REFERENCES incidents(fingerprint),
    status TEXT NOT NULL CHECK (status IN ('firing', 'resolved')),
    event_time TEXT NOT NULL,
    labels_json TEXT NOT NULL,
    annotations_json TEXT NOT NULL,
    accepted_at TEXT NOT NULL
);

CREATE TABLE work_queue (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL UNIQUE REFERENCES events(id),
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'processing', 'completed', 'failed')),
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
);

CREATE INDEX events_fingerprint_idx ON events(fingerprint, accepted_at);
CREATE INDEX work_queue_state_idx ON work_queue(state, id);
