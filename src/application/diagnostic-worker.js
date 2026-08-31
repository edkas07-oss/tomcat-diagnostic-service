import { buildCanonicalResult } from "../domain/canonical-result.js";
import { evaluateTomcatDown } from "../domain/tomcat-down-engine.js";

export class DiagnosticWorker {
  constructor(repository, collectEvidence, { timeoutMs = 60000, clock = () => new Date() } = {}) { this.repository = repository; this.collectEvidence = collectEvidence; this.timeoutMs = timeoutMs; this.clock = clock; }
  async runOnce() {
    const item = this.repository.claimNext();
    if (!item) return null;
    const started = this.clock();
    try {
      const event = this.repository.eventForQueue(item.id);
      let timer;
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("diagnostic timeout")), this.timeoutMs); });
      const evidence = await Promise.race([this.collectEvidence(event), deadline]).finally(() => clearTimeout(timer));
      const assessment = evaluateTomcatDown(evidence);
      const partial = evidence.some((value) => value.status !== "collected");
      const result = buildCanonicalResult({ diagnosticId: `diag-${event.eventKey}`, event, targetId: event.targetId, generation: event.generation, processingStatus: partial ? "partially_completed" : "completed", evidence, assessment, timing: { startedAt: started.toISOString(), completedAt: this.clock().toISOString() }, recommendedActions: ["Review the correlated evidence and restore service through an approved operator procedure."] });
      this.repository.saveCanonicalResult(item.id, result);
      this.repository.complete(item.id, true);
      return result;
    } catch (error) { this.repository.complete(item.id, false); throw error; }
  }
}
