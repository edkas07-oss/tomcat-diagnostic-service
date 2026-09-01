import { buildCanonicalResult, isMaterialChange } from "../domain/canonical-result.js";
import { evaluateTomcatDown } from "../domain/tomcat-down-engine.js";
import { renderResult } from "./result-renderer.js";

export class DiagnosticWorker {
  constructor(repository, collectEvidence, { timeoutMs = 60000, clock = () => new Date(), notification, render = renderResult } = {}) { this.repository = repository; this.collectEvidence = collectEvidence; this.timeoutMs = timeoutMs; this.clock = clock; this.notification = notification; this.render = render; }
  async runOnce() {
    const item = this.repository.claimNext();
    if (!item) return null;
    const started = this.clock();
    try {
      const event = this.repository.eventForQueue(item.id);
      const previousFiring = this.repository.latestCanonicalResult(event.fingerprint, "firing");
      const result = event.status === "resolved"
        ? this.resolvedResult(event, previousFiring, started)
        : await this.diagnosticResult(event, started);
      const resultId = this.repository.saveCanonicalResult(item.id, result);
      const notify = event.status === "resolved"
        ? this.repository.reserveResolvedNotification(event.fingerprint)
        : previousFiring === null || (isMaterialChange(previousFiring, result) && this.repository.reserveMaterialUpdate(event.fingerprint));
      if (notify && this.notification) await this.notification.deliver(resultId, result, this.render(result));
      this.repository.complete(item.id, true);
      return result;
    } catch (error) { this.repository.complete(item.id, false); throw error; }
  }

  async diagnosticResult(event, started) {
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("diagnostic timeout")), this.timeoutMs); });
    const evidence = await Promise.race([this.collectEvidence(event), deadline]).finally(() => clearTimeout(timer));
    const assessment = evaluateTomcatDown(evidence);
    const partial = evidence.some((value) => value.status !== "collected");
    return buildCanonicalResult({ diagnosticId: `diag-${event.eventKey}`, event, targetId: event.targetId, generation: event.generation, processingStatus: partial ? "partially_completed" : "completed", evidence, assessment, timing: { startedAt: started.toISOString(), completedAt: this.clock().toISOString() }, recommendedActions: ["Review the correlated evidence and restore service through an approved operator procedure."] });
  }

  resolvedResult(event, previous, started) {
    const assessment = previous?.assessment ?? { ruleId: "TomcatDown", ruleVersion: "1", branch: "resolved_without_previous_firing", assessment: "Resolved without a stored firing diagnosis", classification: "undetermined", confidence: null };
    return buildCanonicalResult({ diagnosticId: `diag-${event.eventKey}`, event, targetId: event.targetId, generation: previous?.generation ?? event.generation, processingStatus: previous?.processingStatus ?? "resolved_without_previous_firing", evidence: previous?.evidence ?? [], observations: previous?.observations, contradictions: previous?.contradictions, assessment, contributingFactors: previous?.contributingFactors, timing: { startedAt: started.toISOString(), completedAt: this.clock().toISOString() }, recommendedActions: ["Confirm service recovery and close the incident through an approved operator procedure."] });
  }
}
