-- ==============================================================================
-- Migration : 006-rule-category.sql
-- Project   : Tomcat Diagnostic Service
-- Origin    : Release 0.1.4 (Formal Rule Category Support)
-- Purpose   : Menambahkan kolom kategori domain kegagalan (failure domain) pada
--             custom_rules dan indeks untuk filter domain query.
-- ==============================================================================

ALTER TABLE custom_rules ADD COLUMN category TEXT NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS custom_rules_category_idx ON custom_rules(category);
