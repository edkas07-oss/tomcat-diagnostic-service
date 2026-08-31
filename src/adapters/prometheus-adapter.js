import { createEvidence } from "../domain/evidence.js";

export class PrometheusAdapter {
  constructor({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
    this.baseUrl = new URL(baseUrl);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async query(target, query, context) {
    const url = new URL("/api/v1/query", this.baseUrl);
    url.searchParams.set("query", `${query}{${target.prometheusSelector}}`);
    let status = "collected";
    let value = null;
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) status = response.status === 401 || response.status === 403 ? "unauthorized" : "unavailable";
      else {
        const body = await response.json();
        if (body.status !== "success" || !body.data) status = "invalid_response";
        else value = body.data.result;
      }
    } catch (error) {
      status = error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : "unavailable";
    }
    return createEvidence({
      source: "prometheus", type: "jmx_scrape", targetId: target.targetId,
      generation: context.generation, observedAt: context.observedAt,
      collectedAt: context.collectedAt, status, strength: "supporting", value,
      redacted: false
    });
  }
}
