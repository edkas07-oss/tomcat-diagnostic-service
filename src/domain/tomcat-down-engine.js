const found = (evidence, type, predicate = () => true) => evidence.some((item) => item.type === type && predicate(item.value, item));

const result = (branch, assessment, classification, confidence = null) => ({
  ruleId: "TomcatDown",
  ruleVersion: "1",
  branch,
  assessment,
  classification,
  confidence
});

export function evaluateTomcatDown(evidence) {
  const jmxFails = found(evidence, "jmx_scrape", (value) => value?.available === false);
  const healthUp = found(evidence, "application_health", (value) => value?.up === true);
  const healthFails = found(evidence, "application_health", (value) => value?.up === false);
  const running = found(evidence, "container_state", (value) => value?.state === "running");
  const exited = found(evidence, "container_state", (value) => value?.state === "exited");

  if ((running && exited) || (healthUp && healthFails)) {
    return result("TD-08", "Cause undetermined from contradicting evidence", "undetermined");
  }

  if (jmxFails && healthFails && found(evidence, "runtime_oom", (value) => value?.oomKilled === true)) {
    return result("TD-02", "Container terminated by OOM mechanism", "confirmed_cause", "high");
  }
  if (found(evidence, "jvm_fatal_marker") && found(evidence, "crash_artifact") && found(evidence, "runtime_death_event")) {
    return result("TD-03", "JVM fatal crash", "confirmed_cause", "high");
  }
  if (found(evidence, "tomcat_startup") && found(evidence, "connector_bind_exception") && !found(evidence, "tomcat_startup_complete")) {
    return result("TD-04", "Connector startup failed because the configured port could not bind", "confirmed_cause", "high");
  }
  if (found(evidence, "orderly_shutdown") && found(evidence, "explicit_stop_event")) {
    return result("TD-05", "Controlled or externally requested shutdown", "confirmed_cause", "high");
  }
  if (jmxFails && healthUp && running) {
    return result("TD-01", "Tomcat is not proven down; JMX Exporter, TLS, or scrape path failed", "probable_cause", "medium");
  }
  if (exited) return result("TD-06", "Container exited; cause undetermined", "undetermined");
  if (running && jmxFails && found(evidence, "application_health", (_, item) => item.status === "timeout") && found(evidence, "long_pause")) {
    return result("TD-07", "Tomcat may be unresponsive; process is not proven down", "possible_cause", "medium");
  }
  return result("TD-08", "Cause undetermined from available evidence", "undetermined");
}
