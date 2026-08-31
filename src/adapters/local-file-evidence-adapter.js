import { readBoundedFile } from "./bounded-file-reader.js";
import { createEvidence } from "../domain/evidence.js";

const sensitive = /(authorization|cookie|password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi;

export function collectLocalFileEvidence(target, context, { rootField, relativePath, type, strength = "supporting" }) {
  const root = target[rootField];
  if (!root) return createEvidence({ source: "local_file", type, targetId: target.targetId,
    generation: context.generation, observedAt: context.observedAt, collectedAt: context.collectedAt,
    status: "not_configured", strength, redacted: false });
  try {
    const file = readBoundedFile(root, relativePath);
    const sanitized = file.text.replace(sensitive, "$1=<redacted>");
    return createEvidence({ source: "local_file", type, targetId: target.targetId,
      generation: context.generation, observedAt: context.observedAt, collectedAt: context.collectedAt,
      status: "collected", strength, value: { excerpt: sanitized, truncated: file.truncated },
      redacted: sanitized !== file.text });
  } catch (error) {
    return createEvidence({ source: "local_file", type, targetId: target.targetId,
      generation: context.generation, observedAt: context.observedAt, collectedAt: context.collectedAt,
      status: error.code === "ENOENT" ? "not_found" : "unavailable", strength, redacted: false });
  }
}
