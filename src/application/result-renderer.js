const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function formatTelemetryEvidence(evidenceList) {
  const telemetry = (evidenceList ?? []).filter((e) => e.source === "prometheus" || e.source === "collector");
  if (telemetry.length === 0) return "not_configured";
  return telemetry.map((e) => {
    const val = typeof e.value === "object" && e.value !== null ? JSON.stringify(e.value) : String(e.value ?? "");
    const observed = e.observedAt ? ` [observed: ${e.observedAt}]` : "";
    return `• ${e.type} (${e.source}/${e.status}${e.strength ? `, ${e.strength}` : ""}): ${val}${observed}`;
  }).join("\n");
}

function formatLogEvidence(evidenceList) {
  const logs = (evidenceList ?? []).filter((e) => e.source === "local_file");
  if (logs.length === 0) return "not_configured";
  return logs.map((e) => e.value?.excerpt ?? `${e.type}: ${e.status}`).join("\n");
}

function formatUnavailableAndContradictions(result) {
  const unavailable = result.unavailableSources && result.unavailableSources.length > 0
    ? result.unavailableSources.join(", ")
    : "none";
  const contradictions = result.contradictions && result.contradictions.length > 0
    ? result.contradictions.join(", ")
    : "none";
  return `Unavailable Sources: ${unavailable}\nContradictions: ${contradictions}`;
}

export function sections(result) {
  const isResolved = result.lifecycleStatus === "resolved";
  const confidenceStr = result.assessment?.confidence ? `; confidence=${result.assessment.confidence}` : "";

  const alertSummary = [
    `Alert: ${result.ruleId} (Severity: critical)`,
    `Lifecycle Status: ${String(result.lifecycleStatus).toUpperCase()}`,
    `Target Identifier: ${result.targetId}`,
    `Fingerprint: ${result.fingerprint}`,
    `Incident Started: ${result.startsAt || "not_specified"}`,
    `Incident Ended: ${result.endsAt || (isResolved ? "resolved" : "active")}`
  ].join("\n");

  const diagnosticAssessment = [
    `Processing Status: ${result.processingStatus}`,
    `Classification: ${result.assessment?.classification}`,
    `Primary Assessment: ${result.assessment?.assessment}`,
    `Engine Decision Branch: ${result.assessment?.branch}${confidenceStr}`
  ].join("\n");

  const keyMetrics = formatTelemetryEvidence(result.evidence);
  const logEvidence = formatLogEvidence(result.evidence);
  const unavailableContradictions = formatUnavailableAndContradictions(result);
  const recommendedActions = (result.recommendedActions && result.recommendedActions.length > 0)
    ? result.recommendedActions.map((action, i) => `${i + 1}. ${action}`).join("\n")
    : "1. Review the correlated evidence and restore service through an approved operator procedure.";

  const traceability = [
    `Rule ID / Version: ${result.ruleId}/${result.ruleVersion}`,
    `Diagnostic ID: ${result.diagnosticId}`,
    `Canonical Result Hash: ${result.resultHash}`,
    `Runtime Generation: ${result.generation ?? "null"}`
  ].join("\n");

  return [
    ["Alert Summary", alertSummary],
    ["Diagnostic Assessment", diagnosticAssessment],
    ["Key Metrics Snapshot", keyMetrics],
    ["Correlated Log Evidence", logEvidence],
    ["Unavailable or Contradicting Evidence", unavailableContradictions],
    ["Recommended Operator Actions", recommendedActions],
    ["Rule and Diagnostic Traceability", traceability]
  ];
}

export function renderResult(result) {
  const content = sections(result);
  const isResolved = result.lifecycleStatus === "resolved";
  const statusColor = isResolved ? "#2e7d32" : "#c62828";
  const statusBg = isResolved ? "#e8f5e9" : "#ffebee";
  const statusBorder = isResolved ? "#a5d6a7" : "#ef9a9a";
  const headerTitle = isResolved ? "[ RESOLVED ] Service Recovery Diagnostic" : "[ CRITICAL ] Diagnostic Incident Report";

  const textBody = content.map(([title, body]) => `=== ${title} ===\n${body}`).join("\n\n");

  const htmlSections = content.map(([title, body]) => {
    return `<div style="margin-bottom:20px;">
<h2>${escapeHtml(title)}</h2>
<div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;font-family:monospace,Consolas,'Courier New',Courier,sans-serif;font-size:13px;line-height:1.6;color:#1e293b;white-space:pre-wrap;word-break:break-word;">${escapeHtml(body)}</div>
</div>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    h2 { font-size:15px; font-weight:bold; color:#0f172a; margin:16px 0 8px 0; padding-bottom:6px; border-bottom:1px solid #e2e8f0; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f6f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:680px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="background-color:${statusColor};color:#ffffff;padding:20px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-size:15px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${escapeHtml(headerTitle)}</td>
                  <td align="right" style="font-size:12px;font-weight:600;background-color:rgba(255,255,255,0.2);padding:4px 10px;border-radius:12px;color:#ffffff;">LAB Environment</td>
                </tr>
                <tr>
                  <td colspan="2" style="font-size:22px;font-weight:bold;color:#ffffff;padding-top:8px;">${escapeHtml(result.ruleId)} &bull; ${escapeHtml(result.targetId)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Main Content -->
          <tr>
            <td style="padding:24px;">
              <!-- Quick Status Callout -->
              <div style="background-color:${statusBg};border-left:4px solid ${statusColor};border:1px solid ${statusBorder};border-left-width:4px;border-radius:6px;padding:14px 18px;margin-bottom:24px;">
                <div style="font-size:14px;font-weight:bold;color:${statusColor};margin-bottom:4px;">
                  ${isResolved ? '✅ Service Restored' : '⚠️ Incident Classification: ' + escapeHtml(String(result.assessment?.classification).toUpperCase())}
                </div>
                <div style="font-size:14px;color:#334155;line-height:1.5;">
                  <strong>Assessment:</strong> ${escapeHtml(result.assessment?.assessment)} (Branch: <code>${escapeHtml(result.assessment?.branch)}</code>)
                </div>
              </div>
              <!-- 7 Ordered Contract Sections -->
              ${htmlSections}
              <!-- Footer -->
              <div style="border-top:1px solid #e2e8f0;margin-top:24px;padding-top:16px;color:#64748b;font-size:12px;text-align:center;">
                Tomcat Monitoring Platform &bull; Automated Diagnostic Service &bull; Do not reply
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { text: textBody, html };
}
