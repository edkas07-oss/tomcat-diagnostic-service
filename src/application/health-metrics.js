export class HealthMetrics {
  constructor() { this.live = true; this.ready = false; this.counters = new Map(); this.gauges = new Map(); }
  setReady(value) { this.ready = Boolean(value); }
  increment(name, labels = {}) { const key = `${name}:${JSON.stringify(labels)}`; this.counters.set(key, (this.counters.get(key) ?? 0) + 1); }
  setGauge(name, value) { this.gauges.set(name, value); }
  health() { return { live: this.live, ready: this.ready }; }
  snapshot() { return { counters: Object.fromEntries(this.counters), gauges: Object.fromEntries(this.gauges) }; }
}
