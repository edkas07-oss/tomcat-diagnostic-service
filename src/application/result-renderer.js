const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function formatTelemetryEvidence(evidenceList) {
  const telemetry = (evidenceList ?? []).filter((e) => e.source === "prometheus" || e.source === "collector");
  if (telemetry.length === 0) return "not_configured (Tidak ada telemetri runtime)";
  return telemetry.map((e) => {
    const val = typeof e.value === "object" && e.value !== null ? JSON.stringify(e.value) : String(e.value ?? "");
    const observed = e.observedAt ? ` [waktu observasi: ${e.observedAt}]` : "";
    return `• ${e.type} (${e.source}/${e.status}${e.strength ? `, strength: ${e.strength}` : ""}): ${val}${observed}`;
  }).join("\n");
}

function formatLogEvidence(evidenceList) {
  const logs = (evidenceList ?? []).filter((e) => e.source === "local_file");
  if (logs.length === 0) return "not_configured (Tidak ada file log atau ekstrak log yang tercatat)";
  return logs.map((e) => e.value?.excerpt ?? `${e.type}: ${e.status}`).join("\n");
}

function formatUnavailableAndContradictions(result) {
  const unavailable = result.unavailableSources && result.unavailableSources.length > 0
    ? result.unavailableSources.join(", ")
    : "Tidak ada (Semua sumber bukti yang relevan berhasil diperiksa)";
  const contradictions = result.contradictions && result.contradictions.length > 0
    ? result.contradictions.join(", ")
    : "Tidak ada (Tidak ditemukan bukti yang saling bertentangan)";
  return `Sumber yang Tidak Tersedia: ${unavailable}\nBukti yang Bertentangan: ${contradictions}`;
}

function getRecommendedActions(result) {
  const isResolved = result.lifecycleStatus === "resolved";
  const custom = result.recommendedActions ?? [];
  const isGenericDefault = custom.length === 1 && (
    custom[0].startsWith("Review the correlated evidence") ||
    custom[0].startsWith("Confirm service recovery")
  );

  if (custom.length > 0 && !isGenericDefault) {
    return custom.map((action, i) => `${i + 1}. ${action}`).join("\n");
  }

  if (isResolved) {
    return [
      "1. Konfirmasi pemulihan metrik dan status target pada dashboard monitoring Prometheus / Grafana.",
      "2. Status insiden ditutup secara otomatis; tidak diperlukan tindakan mitigasi lanjutan."
    ].join("\n");
  }

  const branch = result.assessment?.branch;
  if (branch === "TD-06") {
    return [
      "1. Periksa status runtime container pada host (periksa apakah container aktif atau terhenti).",
      "2. Periksa log container untuk menganalisis penyebab penghentian layanan.",
      "3. Lakukan deploy atau start ulang container Tomcat melalui skrip deployment resmi.",
      "4. Verifikasi ketersediaan metrik HTTPS pada port 9404 dan endpoint aplikasi pada port 8080."
    ].join("\n");
  }

  if (branch === "TD-02") {
    return [
      "1. Periksa batas memori container dan cgroup host (indikasi Out Of Memory / OOM).",
      "2. Analisis heap dump JVM Tomcat dan sesuaikan alokasi memori (-Xmx).",
      "3. Lakukan start ulang container dengan alokasi memori yang disesuaikan."
    ].join("\n");
  }

  if (branch === "TD-01") {
    return [
      "1. Container Tomcat berjalan dan aplikasi sehat, namun JMX Exporter tidak merespons pada port 9404.",
      "2. Periksa sertifikat TLS JMX Exporter dan konfigurasi port binding pada host.",
      "3. Periksa konektivitas jaringan scraper Prometheus ke target Tomcat."
    ].join("\n");
  }

  return [
    "1. Periksa bukti forensik runtime yang terkorelasi di atas.",
    "2. Lakukan prosedur pemulihan layanan Tomcat sesuai SOP operasional yang disetujui."
  ].join("\n");
}

export function sections(result) {
  const isResolved = result.lifecycleStatus === "resolved";
  const confidenceStr = result.assessment?.confidence ? `; confidence=${result.assessment.confidence}` : "";

  const alertSummary = [
    `Nama Alert: ${result.ruleId} (Tingkat Keparahan: CRITICAL)`,
    `Status Siklus: ${isResolved ? "RESOLVED (PULIH)" : "FIRING (AKTIF)"}`,
    `Target Identitas: ${result.targetId}`,
    `Fingerprint: ${result.fingerprint}`,
    `Waktu Mulai Insiden: ${result.startsAt || "tidak_tersedia"}`,
    `Waktu Selesai: ${result.endsAt || (isResolved ? "selesai / pulih" : "masih berlangsung (aktif)")}`
  ].join("\n");

  const categoryStr = result.assessment?.category ? `\nKategori Domain: ${result.assessment.category}` : "";
  const diagnosticAssessment = [
    `Status Pemrosesan: ${result.processingStatus === "completed" ? "Selesai (Completed)" : result.processingStatus}`,
    `Klasifikasi: ${result.assessment?.classification}`,
    `Hasil Diagnosis Utama: ${result.assessment?.assessment}`,
    `Branch Keputusan Engine: ${result.assessment?.branch}${confidenceStr}${categoryStr}`
  ].join("\n");

  const keyMetrics = formatTelemetryEvidence(result.evidence);
  const logEvidence = formatLogEvidence(result.evidence);
  const unavailableContradictions = formatUnavailableAndContradictions(result);
  const recommendedActions = getRecommendedActions(result);

  const traceability = [
    `Rule ID / Versi: ${result.ruleId}/${result.ruleVersion}`,
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
  const headerTitle = isResolved ? "[ RESOLVED ] Tomcat Service Restored" : "[ CRITICAL ] Tomcat Monitoring Alert & Diagnostic Report";

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
                  ${isResolved ? '✅ Status: Layanan Berhasil Dipulihkan' : '⚠️ Klasifikasi Insiden: ' + escapeHtml(String(result.assessment?.classification).toUpperCase())}
                </div>
                <div style="font-size:14px;color:#334155;line-height:1.5;">
                  <strong>Hasil Evaluasi:</strong> ${escapeHtml(result.assessment?.assessment)} (Branch Keputusan: <code>${escapeHtml(result.assessment?.branch)}</code>)
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
