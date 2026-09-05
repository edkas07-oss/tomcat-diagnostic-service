-- ==============================================================================
-- Migration : 004-notification-lifecycle.sql
-- Project   : Tomcat Diagnostic Service
-- Origin    : TN-012 (Implement Bounded Notification Delivery Orchestration)
-- Purpose   : Menambahkan kolom resolved_notification_count untuk menjamin
--             notifikasi pemulihan (resolved) hanya dikirimkan maksimal 1 kali.
-- ==============================================================================

ALTER TABLE incidents ADD COLUMN resolved_notification_count INTEGER NOT NULL DEFAULT 0;
