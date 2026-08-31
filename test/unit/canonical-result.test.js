import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCanonicalResult, isMaterialChange } from "../../src/domain/canonical-result.js";
import { createEvidence } from "../../src/domain/evidence.js";
import { renderResult } from "../../src/application/result-renderer.js";

const evidence = createEvidence({ source: "prometheus", type: "jmx_scrape", targetId: "lab/host/one", observedAt: "2026-08-31T01:00:00Z", collectedAt: "2026-08-31T01:00:01Z", status: "collected", strength: "supporting", value: { available: false }, redacted: false });
const input = { diagnosticId: "diag-1", event: { fingerprint: "fp", status: "firing", startsAt: "2026-08-31T01:00:00Z", endsAt: null, eventKey: "key" }, targetId: "lab/host/one", processingStatus: "completed", evidence: [evidence], assessment: { ruleId: "TomcatDown", ruleVersion: "1", branch: "TD-08", assessment: "Cause undetermined", classification: "undetermined", confidence: null }, timing: { startedAt: "a", completedAt: "b" }, recommendedActions: ["Review safely"] };

test("canonical hash excludes volatile timing and material change is bounded", () => {
  const first = buildCanonicalResult(input); const second = buildCanonicalResult({ ...input, timing: { startedAt: "c", completedAt: "d" } });
  assert.equal(first.resultHash, second.resultHash);
  assert.equal(isMaterialChange(first, second), false);
  assert.equal(isMaterialChange(first, { ...second, processingStatus: "partially_completed" }), true);
});

test("renderer preserves seven-section order and escapes HTML", () => {
  const result = buildCanonicalResult({ ...input, recommendedActions: ["Review <script>"] });
  const rendered = renderResult(result);
  assert.equal((rendered.html.match(/<h2>/g) ?? []).length, 7);
  assert.ok(rendered.text.indexOf("Alert Summary") < rendered.text.indexOf("Rule and Diagnostic Traceability"));
  assert.ok(rendered.html.includes("&lt;script&gt;"));
});

test("canonical result rejects invalid confidence", () => assert.throws(() => buildCanonicalResult({ ...input, assessment: { ...input.assessment, classification: "confirmed_cause", confidence: "medium" } }), TypeError));
