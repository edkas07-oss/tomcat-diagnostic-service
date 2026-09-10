/**
 * @file src/domain/tomcat-down-engine.js
 * @project Tomcat Diagnostic Service
 * @author Eddy Wiyatno <edkas07@gmail.com>
 * @license Proprietary & Confidential
 * @description Decision Engine Deterministik Layer 1 untuk insiden TomcatDown (Built-in Branches TD-01..TD-08).
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. Ekstrak sinyal observasi langsung dari bukti telemetri:
 *    - jmxFails, healthUp, healthFails, running, exited.
 * 2. Evaluasi aturan pohon keputusan (Evaluated in strict deterministic order):
 *    a. Kontradiksi langsung (running & exited, atau healthUp & healthFails) -> Branch TD-08 (undetermined).
 *    b. jmxFails + healthFails + runtime_oom (oomKilled = true) -> Branch TD-02 (confirmed_cause, high confidence).
 *    c. jvm_fatal_marker + crash_artifact + runtime_death_event -> Branch TD-03 (confirmed_cause, high confidence).
 *    d. tomcat_startup + connector_bind_exception tanpa complete -> Branch TD-04 (confirmed_cause, high confidence).
 *    e. orderly_shutdown + explicit_stop_event -> Branch TD-05 (confirmed_cause, high confidence).
 *    f. jmxFails + healthUp + running -> Branch TD-01 (probable_cause, medium confidence).
 *    g. exited tanpa bukti spesifik -> Branch TD-06 (undetermined).
 *    h. running + jmxFails + health timeout + long_pause -> Branch TD-07 (possible_cause, medium confidence).
 *    i. Fallback default jika tidak ada cabang yang terpenuhi -> Branch TD-08 (undetermined).
 *
 * Pohon Keputusan Built-in:
 * - TD-01: TLS scrape unavailable
 * - TD-02: Container terminated by OOM mechanism
 * - TD-03: JVM terminated abnormally by crash artifact
 * - TD-04: Port bind conflict prevents startup
 * - TD-05: Orderly shutdown requested
 * - TD-06: Container exited with unknown state
 * - TD-07: Telemetry unconfirmed but runtime exited
 * - TD-08: Cause undetermined from contradicting evidence / insufficient evidence
 */

const found = (evidence, type, predicate = () => true) => evidence.some((item) => item.type === type && predicate(item.value, item));

const result = (ruleId, branch, assessment, classification, confidence = null) => ({
  ruleId,
  ruleVersion: "1",
  branch,
  assessment,
  classification,
  confidence
});

export function evaluateTomcatDown(evidence, event = {}) {
  const ruleId = event?.labels?.alertname || "TomcatDown";
  const jmxFails = found(evidence, "jmx_scrape", (value) => value?.available === false || (Array.isArray(value) && value.some((v) => v?.value?.[1] === "0")));
  const healthUp = found(evidence, "application_health", (value) => value?.up === true);
  const healthFails = found(evidence, "application_health", (value) => value?.up === false);
  const running = found(evidence, "container_state", (value) => value?.state === "running");
  const exited = found(evidence, "container_state", (value) => value?.state === "exited");

  if ((running && exited) || (healthUp && healthFails)) {
    return result(ruleId, "TD-08", "Cause undetermined from contradicting evidence", "undetermined");
  }

  if (jmxFails && healthFails && found(evidence, "runtime_oom", (value) => value?.oomKilled === true)) {
    return result(ruleId, "TD-02", "Container terminated by OOM mechanism", "confirmed_cause", "high");
  }
  if (found(evidence, "jvm_fatal_marker") && found(evidence, "crash_artifact") && found(evidence, "runtime_death_event")) {
    return result(ruleId, "TD-03", "JVM fatal crash", "confirmed_cause", "high");
  }
  if (found(evidence, "tomcat_startup") && found(evidence, "connector_bind_exception") && !found(evidence, "tomcat_startup_complete")) {
    return result(ruleId, "TD-04", "Connector startup failed because the configured port could not bind", "confirmed_cause", "high");
  }
  if (found(evidence, "orderly_shutdown") && found(evidence, "explicit_stop_event")) {
    return result(ruleId, "TD-05", "Controlled or externally requested shutdown", "confirmed_cause", "high");
  }
  if (jmxFails && healthUp && running) {
    return result(ruleId, "TD-01", "Tomcat is not proven down; JMX Exporter, TLS, or scrape path failed", "probable_cause", "medium");
  }
  if (exited) return result(ruleId, "TD-06", "Container exited; cause undetermined", "undetermined");
  if (running && jmxFails && found(evidence, "application_health", (_, item) => item.status === "timeout") && found(evidence, "long_pause")) {
    return result(ruleId, "TD-07", "Tomcat may be unresponsive; process is not proven down", "possible_cause", "medium");
  }
  return result(ruleId, "TD-08", "Cause undetermined from available evidence", "undetermined");
}
