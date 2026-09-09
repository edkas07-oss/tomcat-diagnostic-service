/**
 * @file src/domain/jvm-workload-engine.js
 * @project Tomcat Diagnostic Service
 * @description Decision Engine Deterministik untuk insiden JVM Memory & Garbage Collection (Cabang GC-01..GC-04).
 */

const result = (ruleId, branch, assessment, classification, confidence = null, recommendedActions = []) => ({
  ruleId,
  ruleVersion: "1",
  branch,
  category: "jvm-memory-and-gc",
  assessment,
  classification,
  confidence,
  recommendedActions
});

export function evaluateJvmWorkload(evidence, event = {}) {
  const ruleId = event?.labels?.alertname || "TomcatGCPauseHigh";

  if (ruleId === "TomcatGCPauseHigh") {
    return result(
      ruleId,
      "GC-01",
      "Severe JVM Garbage Collection Stop-The-World pause duration exceeding threshold (> 1.5s), freezing application request processing",
      "confirmed_cause",
      "high",
      [
        "Tuning parameter GC JVM untuk membatasi durasi jeda (misal: -XX:MaxGCPauseMillis=200 -XX:+UseG1GC).",
        "Periksa alokasi heap JVM (-Xms / -Xmx) dan rasio generasi muda (Young Generation).",
        "Analisis GC log terperinci (-Xlog:gc*) untuk mengidentifikasi penyebab fase STW berkepanjangan."
      ]
    );
  }

  if (ruleId === "TomcatGCOverheadHigh") {
    return result(
      ruleId,
      "GC-02",
      "Excessive JVM Garbage Collection CPU overhead (> 15% computation time spent in GC); JVM is thrashing",
      "confirmed_cause",
      "high",
      [
        "Periksa beban kerja alokasi memori aplikasi dan kurangi laju pembuatan objek pendek (object churn).",
        "Tingkatkan kapasitas heap maksimum (-Xmx) jika kapasitas memori host mencukupi.",
        "Analisis pola pembersihan memori untuk mendeteksi inefisiensi pengumpulan sampah (GC thrashing)."
      ]
    );
  }

  if (ruleId === "TomcatOldGenMemoryPressure") {
    return result(
      ruleId,
      "GC-03",
      "Persistent Old Generation (Tenured) memory retention remaining above 90% threshold for > 10m; strong indicator of memory leak",
      "probable_cause",
      "high",
      [
        "Lakukan pengambilan snapshot heap dump JVM (jcmd <pid> GC.heap_dump atau jmap).",
        "Analisis heap dump menggunakan Eclipse Memory Analyzer (MAT) untuk mencari dominator objek yang bocor (leak suspect).",
        "Jadwalkan restart terkontrol atau redeploy aplikasi setelah perbaikan kebocoran memori selesai dilakukan."
      ]
    );
  }

  return result(
    ruleId,
    "GC-04",
    "JVM workload and memory condition undetermined from available telemetry",
    "undetermined",
    null,
    [
      "Periksa metrik runtime JMX Exporter pada https://localhost:9404/metrics.",
      "Lakukan inspeksi log aplikasi dan metrik utilisasi memori kontainer pada Prometheus."
    ]
  );
}
