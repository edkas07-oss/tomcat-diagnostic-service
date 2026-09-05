-- ==============================================================================
-- Migration : 002-canonical-results.sql
-- Project   : Tomcat Diagnostic Service
-- Origin    : TN-007 (Implement Worker Canonical Result and Renderers)
-- Purpose   : Persistensi hasil evaluasi diagnosis kanonikal (canonical results),
--             ringkasan bukti (evidence summaries), dan batas pembaruan materiil.
-- ==============================================================================

ALTER TABLE incidents ADD COLUMN material_update_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE canonical_results (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL UNIQUE REFERENCES events(id),
    diagnostic_id TEXT NOT NULL UNIQUE,
    schema_version INTEGER NOT NULL,
    processing_status TEXT NOT NULL,
    classification TEXT NOT NULL,
    confidence TEXT,
    result_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE evidence_summaries (
    id INTEGER PRIMARY KEY,
    result_id INTEGER NOT NULL REFERENCES canonical_results(id),
    evidence_id TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    UNIQUE(result_id, evidence_id)
);

CREATE INDEX canonical_results_hash_idx ON canonical_results(result_hash);
