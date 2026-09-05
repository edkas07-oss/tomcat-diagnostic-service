-- ==============================================================================
-- Migration : 003-delivery-attempts.sql
-- Project   : Tomcat Diagnostic Service
-- Origin    : TN-008 (Implement Secure Service and SMTP Delivery Boundaries)
-- Purpose   : Persistensi riwayat percobaan pengiriman notifikasi email via SMTP
--             untuk mendukung bounded retry dan audit trail kegagalan/keberhasilan.
-- ==============================================================================

CREATE TABLE notification_attempts (
    id INTEGER PRIMARY KEY,
    result_id INTEGER NOT NULL REFERENCES canonical_results(id),
    attempt INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','sent','failed')),
    error_code TEXT,
    attempted_at TEXT NOT NULL,
    UNIQUE(result_id, attempt)
);
