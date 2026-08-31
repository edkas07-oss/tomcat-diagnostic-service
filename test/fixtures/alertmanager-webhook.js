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
