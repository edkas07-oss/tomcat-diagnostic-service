ALTER TABLE custom_rules ADD COLUMN category TEXT NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS custom_rules_category_idx ON custom_rules(category);
