-- ==============================================================================
-- Migration : 005-custom-rules.sql
-- Project   : Tomcat Diagnostic Service
-- Origin    : TN-018 (Implement Strict Declarative Rulepack Engine)
-- Purpose   : Persistensi aturan deklaratif dinamis (custom rules) hasil sintesis
--             AI atau input SRE, dengan proteksi branch unik (anti-collision).
-- ==============================================================================

CREATE TABLE custom_rules (
    id INTEGER PRIMARY KEY,
    rule_id TEXT NOT NULL,
    branch TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    target_source TEXT NOT NULL,
    pattern TEXT NOT NULL,
    assessment TEXT NOT NULL,
    classification TEXT NOT NULL,
    confidence TEXT,
    rule_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX custom_rules_branch_idx ON custom_rules(branch);
