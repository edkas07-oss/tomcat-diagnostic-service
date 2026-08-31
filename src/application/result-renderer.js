const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const sections = (result) => [
  ["Alert Summary", `${result.lifecycleStatus} ${result.fingerprint} on ${result.targetId}`],
  ["Diagnostic Assessment", `${result.processingStatus}; ${result.assessment.classification}; ${result.assessment.assessment}${result.assessment.confidence ? `; confidence=${result.assessment.confidence}` : ""}`],
  ["Key Metrics Snapshot", result.evidence.filter((e) => e.source === "prometheus").map((e) => `${e.status}: ${JSON.stringify(e.value)}`).join("\n") || "not_configured"],
  ["Correlated Log Evidence", result.evidence.filter((e) => e.source === "local_file").map((e) => e.value?.excerpt ?? e.status).join("\n") || "not_configured"],
  ["Unavailable or Contradicting Evidence", JSON.stringify({ unavailable: result.unavailableSources, contradictions: result.contradictions })],
  ["Recommended Operator Actions", result.recommendedActions.join("\n")],
  ["Rule and Diagnostic Traceability", `${result.ruleId}/${result.ruleVersion}; ${result.diagnosticId}; ${result.resultHash}`]
];
export function renderResult(result) { const content = sections(result); return { text: content.map(([title, body]) => `${title}\n${body}`).join("\n\n"), html: content.map(([title, body]) => `<h2>${escapeHtml(title)}</h2><pre>${escapeHtml(body)}</pre>`).join("") }; }
