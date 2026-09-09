/**
 * @file src/domain/concurrency-engine.js
 * @project Tomcat Diagnostic Service
 * @description Decision Engine Deterministik untuk insiden Concurrency & Thread Saturation (Cabang TH-01..TH-03).
 */

const result = (ruleId, branch, assessment, classification, confidence = null, recommendedActions = []) => ({
  ruleId,
  ruleVersion: "1",
  branch,
  category: "concurrency-saturation",
  assessment,
  classification,
  confidence,
  recommendedActions
});

export function evaluateConcurrency(evidence, event = {}) {
  const ruleId = event?.labels?.alertname || "TomcatThreadPoolSaturated";

  if (ruleId === "TomcatThreadPoolSaturated") {
    return result(
      ruleId,
      "TH-01",
      "Tomcat HTTP Connector Thread Pool is fully saturated (100% busy) continuously for > 5m; incoming requests at severe risk of starvation or rejection",
      "confirmed_cause",
      "high",
      [
        "Lakukan capture thread dump berkala (jcmd <pid> Thread.print atau jstack) untuk mendeteksi slow requests atau thread deadlock.",
        "Periksa latensi layanan downstream (database slow queries, external HTTP APIs) yang menahan worker threads.",
        "Sesuaikan parameter maxThreads dan minSpareThreads pada connector server.xml jika kapasitas CPU/memori memadai.",
        "Periksa metrik connection reject pada load balancer atau reverse proxy."
      ]
    );
  }

  return result(
    ruleId,
    "TH-03",
    "Concurrency saturation condition undetermined from available evidence",
    "undetermined",
    null,
    [
      "Periksa metrik tomcat_threads_* pada endpoint Prometheus JMX Exporter.",
      "Lakukan audit aktivitas koneksi aktif pada host Tomcat."
    ]
  );
}
