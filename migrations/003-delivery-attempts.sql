-- ==============================================================================
-- Migration : 003-delivery-attempts.sql
-- Project   : Tomcat Diagnostic Service
-- Origin    : TN-008 (Implement Secure Service and SMTP Delivery Boundaries)
-- Purpose   : Persistensi riwayat percobaan pengiriman notifikasi email via SMTP
--             untuk mendukung bounded retry dan audit trail kegagalan/keberhasilan.
--
-- Pseudocode Skema & Relasi Database:
-- -----------------------------------
-- 1. notification_attempts: Mencatat setiap nomor percobaan pengiriman (attempt 1..3),
--    status (pending, sent, failed), kode error kanonikal, dan timestamp.
-- 2. Constraint UNIQUE(result_id, attempt) untuk mencegah duplikasi pencatatan percobaan yang sama.
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
