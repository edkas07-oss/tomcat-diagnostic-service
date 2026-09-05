/**
 * @file src/domain/rulepack-loader.js
 * @project Tomcat Diagnostic Service
 * @description Dynamic Rule Evaluator (Layer 2) dan Loader Declarative Rulepack.
 *
 * Menggabungkan evaluasi aturan dinamis dengan mesin bawaan:
 * - Mengompilasi pola regex aturan deklaratif dalam memori secara hot-reload.
 * - Memprioritaskan pencocokan custom rules (TD-09+) terhadap bukti log/spool.
 * - Melakukan fallback mulus ke Decision Engine Layer 1 (TD-01..TD-08) jika tidak ada rule deklaratif yang cocok.
 */

import { evaluateTomcatDown } from "./tomcat-down-engine.js";

const BUILTIN_BRANCHES = new Set([
  "TD-01", "TD-02", "TD-03", "TD-04", "TD-05", "TD-06", "TD-07", "TD-08"
]);

export function isBuiltinBranch(branch) {
  return BUILTIN_BRANCHES.has(branch);
}

export class DynamicRuleEvaluator {
  constructor(initialRules = []) {
    this.rules = [];
    for (const rule of initialRules) {
      this.registerRule(rule);
    }
  }

  registerRule(rule) {
    const compiled = {
      ...rule,
      category: rule.category ?? "general",
      regex: new RegExp(rule.pattern, "i")
    };
    const existingIndex = this.rules.findIndex((r) => r.branch === rule.branch);
    if (existingIndex >= 0) {
      this.rules[existingIndex] = compiled;
    } else {
      this.rules.push(compiled);
    }
    return compiled;
  }

  getRules(category = null) {
    const filtered = category ? this.rules.filter((r) => r.category === category) : this.rules;
    return filtered.map(({ regex, ...rule }) => rule);
  }

  getRuleByBranch(branch) {
    const found = this.rules.find((r) => r.branch === branch);
    if (!found) return null;
    const { regex, ...rule } = found;
    return rule;
  }

  getRuleById(id) {
    const numericId = Number(id);
    const found = this.rules.find((r) => r.id === numericId);
    if (!found) return null;
    const { regex, ...rule } = found;
    return rule;
  }

  evaluate(evidence) {
    for (const rule of this.rules) {
      const match = evidence.some((item) => {
        if (item.status !== "collected") return false;
        if (rule.targetSource !== "any" && item.source !== rule.targetSource) return false;
        if (typeof item.value === "string") return rule.regex.test(item.value);
        if (typeof item.value === "object" && item.value !== null) {
          if (typeof item.value.excerpt === "string" && rule.regex.test(item.value.excerpt)) return true;
          return rule.regex.test(JSON.stringify(item.value));
        }
        return false;
      });

      if (match) {
        return {
          ruleId: rule.ruleId ?? "TomcatDown",
          ruleVersion: rule.ruleVersion ?? "1",
          branch: rule.branch,
          category: rule.category ?? "general",
          assessment: rule.assessment,
          classification: rule.classification,
          confidence: rule.confidence ?? null,
          recommendedActions: rule.recommendedActions ?? []
        };
      }
    }

    return evaluateTomcatDown(evidence);
  }
}
