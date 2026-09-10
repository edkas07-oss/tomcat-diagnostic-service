-- ==============================================================================
-- Migration : 007-stale-lock-recovery-and-retention.sql
-- Project   : Tomcat Diagnostic Service
-- Origin    : TN-007 (Implement Stale Lock Recovery and SQLite State Resilience)
-- Purpose   : Menambahkan kolom retry_count dan lease_expires_at pada work_queue
--             serta indeks pendukung untuk stale lock recovery dan retention pruning.
--
-- Pseudocode Skema & Relasi Database:
-- -----------------------------------
-- 1. Tambahkan kolom retry_count (default 0) dan lease_expires_at pada tabel work_queue.
-- 2. Buat indeks work_queue_stale_idx untuk query cepat item processing yang expired.
-- 3. Buat indeks timestamp pada events, requests, canonical_results, dan notification_attempts
--    untuk optimasi rutinitas housekeeping dan pruning data historis.
-- ==============================================================================

ALTER TABLE work_queue ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work_queue ADD COLUMN lease_expires_at TEXT;

CREATE INDEX IF NOT EXISTS work_queue_stale_idx ON work_queue(state, started_at);
CREATE INDEX IF NOT EXISTS events_accepted_at_idx ON events(accepted_at);
CREATE INDEX IF NOT EXISTS requests_accepted_at_idx ON requests(accepted_at);
CREATE INDEX IF NOT EXISTS canonical_results_created_at_idx ON canonical_results(created_at);
CREATE INDEX IF NOT EXISTS notification_attempts_attempted_at_idx ON notification_attempts(attempted_at);
