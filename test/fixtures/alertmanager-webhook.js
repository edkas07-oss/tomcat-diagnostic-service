/**
 * @file test/fixtures/alertmanager-webhook.js
 * @project Tomcat Diagnostic Service
 * @description Fixture generator untuk payload webhook Alertmanager v4 pada lingkungan pengujian.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. Bentuk objek alert default dengan label standar (alertname: TomcatDown, env: lab, host: tomcat-01, default instance).
 * 2. Terapkan custom overrides pada alert jika disediakan.
 * 3. Kembalikan envelope webhook v4 `{ version: '4', groupKey, status, receiver, alerts }`.
 */

export function webhook(overrides = {}) {
  const alert = {
    status: "firing",
    labels: {
      alertname: "TomcatDown",
      severity: "critical",
      environment: "lab",
      host: "tomcat-01",
      tomcat_instance: "default",
      job: "tomcat-jmx-exporter",
      instance: "tomcat-01:9404",
      service: "tomcat",
      check: "runtime-availability"
    },
    annotations: { summary: "Tomcat scrape unavailable" },
    startsAt: "2026-08-31T01:00:00Z",
    endsAt: "0001-01-01T00:00:00Z",
    fingerprint: "abc123",
    ...overrides.alert
  };
  return {
    version: "4",
    groupKey: "{}:{alertname=\"TomcatDown\"}",
    status: alert.status,
    receiver: "diagnostic-service",
    alerts: [alert],
    ...overrides,
    alerts: overrides.alerts ?? [alert]
  };
}
