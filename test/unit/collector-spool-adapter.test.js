import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { readCollectorSpool } from "../../src/adapters/collector-spool-adapter.js";

let directory;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined; });

test("collector spool accepts only bounded records for the target window", () => {
  directory = mkdtempSync(join(tmpdir(), "diagnostic-spool-"));
  const record = (targetId, observedAt) => ({
    type: "container_state", target_id: targetId, generation: "g1", observed_at: observedAt,
    status: "collected", strength: "direct", value: { state: "running" }, redacted: false
  });
  writeFileSync(join(directory, "001.json"), JSON.stringify(record("lab/host/one", "2026-08-31T01:00:00Z")));
  writeFileSync(join(directory, "002.json"), JSON.stringify(record("lab/host/two", "2026-08-31T01:00:00Z")));
  writeFileSync(join(directory, "003.json"), "not-json");
  writeFileSync(join(directory, "004.json"), JSON.stringify(record("lab/host/one", "2026-08-31T00:00:00Z")));
  const target = { targetId: "lab/host/one", collectorSpool: directory };
  const window = { generation: "g1", from: "2026-08-31T00:59:00Z", to: "2026-08-31T01:01:00Z", collectedAt: "2026-08-31T01:01:00Z" };
  assert.equal(readCollectorSpool(target, window).length, 1);
});

test("createDefaultEvidenceCollector reads spool evidence from target", async () => {
  const { createDefaultEvidenceCollector } = await import("../../src/application/application.js");
  const { TargetRegistry } = await import("../../src/application/target-registry.js");
  directory = mkdtempSync(join(tmpdir(), "diagnostic-spool-"));
  const record = {
    type: "container_state", target_id: "lab/tomcat-01/default", generation: "1", observed_at: new Date().toISOString(),
    status: "collected", strength: "direct", value: { state: "exited" }, redacted: false
  };
  writeFileSync(join(directory, "100_container_state.json"), JSON.stringify(record));
  const registry = new TargetRegistry([{ identity: { environment: "lab", host: "tomcat-01", tomcat_instance: "default" }, collectorSpool: directory }]);
  const collector = createDefaultEvidenceCollector(registry);
  const evidence = await collector({ targetId: "lab/tomcat-01/default", generation: "1", startsAt: new Date().toISOString() });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].type, "container_state");
  assert.equal(evidence[0].value.state, "exited");
});
