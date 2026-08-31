import { createHash } from "node:crypto";

const statuses = new Set(["completed", "partially_completed", "failed", "unsupported", "skipped", "resolved_without_previous_firing"]);
const confidence = { confirmed_cause: ["high"], probable_cause: ["medium", "high"], possible_cause: ["low", "medium"], contributing_factor: ["low", "medium", "high"], symptom: ["low", "medium", "high"], not_supported: [null], undetermined: [null] };
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;

export function buildCanonicalResult(input) {
  if (!statuses.has(input.processingStatus)) throw new TypeError("invalid processing status");
  if (!confidence[input.assessment.classification]?.includes(input.assessment.confidence ?? null)) throw new TypeError("classification and confidence are inconsistent");
  const evidence = [...input.evidence].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  const unavailableSources = evidence.filter((item) => item.status !== "collected").map(({ source, status }) => ({ source, status }));
  const core = stable({ schemaVersion: 1, diagnosticId: input.diagnosticId, ruleId: input.assessment.ruleId, ruleVersion: input.assessment.ruleVersion, fingerprint: input.event.fingerprint, lifecycleStatus: input.event.status, startsAt: input.event.startsAt, endsAt: input.event.endsAt, eventKey: input.event.eventKey, targetId: input.targetId, generation: input.generation ?? null, processingStatus: input.processingStatus, evidence, observations: input.observations ?? [], unavailableSources, contradictions: input.contradictions ?? [], assessment: input.assessment, contributingFactors: input.contributingFactors ?? [], recommendedActions: input.recommendedActions ?? [], redaction: { applied: evidence.some((item) => item.redacted) } });
  const resultHash = createHash("sha256").update(JSON.stringify(core)).digest("hex");
  return { ...core, timing: input.timing, resultHash };
}

export function isMaterialChange(previous, current) {
  return previous.processingStatus !== current.processingStatus || previous.assessment.classification !== current.assessment.classification || previous.assessment.confidence !== current.assessment.confidence || previous.assessment.assessment !== current.assessment.assessment || JSON.stringify(previous.unavailableSources) !== JSON.stringify(current.unavailableSources);
}
