/**
 * @file src/domain/application-health-engine.js
 * @project Tomcat Diagnostic Service
 * @description Decision Engine Deterministik untuk insiden HTTP Application Health (Cabang AH-01..AH-05).
 */

const found = (evidence, type, predicate = () => true) =>
  evidence.some((item) => item.type === type && predicate(item.value, item));

const result = (ruleId, branch, assessment, classification, confidence = null, recommendedActions = []) => ({
  ruleId,
  ruleVersion: "1",
  branch,
  category: "application-health",
  assessment,
  classification,
  confidence,
  recommendedActions
});

export function evaluateApplicationHealth(evidence, event = {}) {
  const ruleId = event?.labels?.alertname || "TomcatApplicationHealthFailed";
  
  if (ruleId === "TelegrafHealthScrapeUnavailable") {
    return result(
      ruleId,
      "AH-04",
      "Telegraf collector daemon is unavailable or unreachable by Prometheus scraper",
      "confirmed_cause",
      "high",
      [
        "Periksa status container Telegraf pada host runtime.",
        "Periksa log container Telegraf untuk mendeteksi error internal.",
        "Pastikan jaringan devops-lab dan konektivitas scraper Prometheus ke port 9273 aktif."
      ]
    );
  }

  if (ruleId === "TomcatApplicationHealthMetricsMissing") {
    return result(
      ruleId,
      "AH-03",
      "Telegraf is scrapeable, but expected http_response series for Tomcat application health is missing",
      "probable_cause",
      "medium",
      [
        "Periksa konfigurasi inputs.http_response pada /etc/telegraf/health-check.conf.",
        "Pastikan target http://tomcat-jmx-exporter:8080/health dapat diakses dari container Telegraf.",
        "Verifikasi izin akses dan respons HTTP endpoint /health."
      ]
    );
  }

  const appHealthTimeout = found(evidence, "application_health", (val, item) => item.status === "timeout" || val?.timeout === true);
  if (appHealthTimeout) {
    return result(
      ruleId,
      "AH-02",
      "Tomcat application health probe timed out (> 5s); servlet or context is slow or unresponsive",
      "probable_cause",
      "medium",
      [
        "Periksa waktu respons backend dan konektivitas database pool.",
        "Analisis antrean request dan konkurensi thread pada Tomcat.",
        "Periksa catalina.out untuk potensi database deadlock atau I/O bottleneck."
      ]
    );
  }

  const appHealthFailed = found(evidence, "application_health", (val) => val?.up === false || (val?.httpCode && val.httpCode >= 500));
  if (appHealthFailed || ruleId === "TomcatApplicationHealthFailed") {
    return result(
      ruleId,
      "AH-01",
      "Tomcat application health check failed (HTTP status non-200 or unhealthy body status)",
      "confirmed_cause",
      "high",
      [
        "Periksa log aplikasi Tomcat (catalina.out dan localhost_access_log).",
        "Verifikasi endpoint internal /health dan periksa dependensi downstream (database/cache).",
        "Lakukan inspeksi error HTTP response code pada aplikasi."
      ]
    );
  }

  return result(
    ruleId,
    "AH-05",
    "Application health status undetermined from available evidence",
    "undetermined",
    null,
    [
      "Lakukan verifikasi manual curl HTTP probe ke http://localhost:8080/health.",
      "Periksa log container Tomcat dan status kesehatan target pada Prometheus."
    ]
  );
}
