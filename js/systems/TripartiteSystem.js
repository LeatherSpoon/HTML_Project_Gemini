// TripartiteSystem.js
// Splits a passive investment flow across three legs:
//   capacity   — multiplies ppCap (more held PP during a run)
//   throughput — adds to ppRate via PPSystem.setModifier (PP/s)
//   yield      — multiplies offload capGain (bigger permanent cap per offload)
// Sliders set ratios (0–100, sum to 100). Investment is non-consumptive — PP is not drained;
// the flow is a virtual progression unit routed by ratio. presenceMultiplier is set externally
// by zone-change logic and rotates the bonus per-zone (no UI exposure).

import { CONFIG } from '../config.js';

export class TripartiteSystem {
  constructor(ppSystem) {
    this.pp = ppSystem;

    this.ratios   = { capacity: 34, throughput: 33, yield: 33 };
    this.invested = { capacity: 0,  throughput: 0,  yield: 0  };
    this.presenceMultiplier = { capacity: 1.0, throughput: 1.0, yield: 1.0 };

    this._flowRate     = CONFIG.TRIPARTITE_FLOW_RATE         ?? 0.5;
    this._capScale     = CONFIG.TRIPARTITE_CAPACITY_SCALE    ?? 0.04;
    this._throughScale = CONFIG.TRIPARTITE_THROUGHPUT_SCALE  ?? 0.05;
    this._yieldScale   = CONFIG.TRIPARTITE_YIELD_SCALE       ?? 0.06;

    this._yieldMult = 1;
    this._applyEffects();
  }

  update(delta) {
    const flow = this._flowRate * delta;
    if (flow <= 0) return;

    const r = this.ratios;
    const total = r.capacity + r.throughput + r.yield;
    if (total <= 0) return;

    const m = this.presenceMultiplier;
    this.invested.capacity   += (flow * r.capacity   / total) * m.capacity;
    this.invested.throughput += (flow * r.throughput / total) * m.throughput;
    this.invested.yield      += (flow * r.yield      / total) * m.yield;

    this._applyEffects();
  }

  _applyEffects() {
    // Capacity: multiplicative cap modifier on PPSystem (registry-managed)
    const capMult = 1 + Math.log1p(this.invested.capacity) * this._capScale;
    this.pp.setCapMultiplier('tripartite_capacity', capMult);

    // Throughput: additive PP/s, routed through existing rate-modifier registry
    const throughBonus = Math.log1p(this.invested.throughput) * this._throughScale;
    this.pp.setModifier('tripartite_throughput', throughBonus);

    // Yield: stored, read by PPSystem.offload(yieldMult)
    this._yieldMult = 1 + Math.log1p(this.invested.yield) * this._yieldScale;
  }

  get currentYieldMultiplier() { return this._yieldMult; }

  setRatio(leg, value) {
    value = Math.max(0, Math.min(100, Math.round(value)));
    const others = Object.keys(this.ratios).filter(k => k !== leg);
    const remaining = 100 - value;
    const currentOtherTotal = others.reduce((s, k) => s + this.ratios[k], 0);

    this.ratios[leg] = value;

    if (currentOtherTotal === 0) {
      const each = Math.floor(remaining / others.length);
      others.forEach(k => { this.ratios[k] = each; });
    } else {
      others.forEach(k => {
        this.ratios[k] = Math.round((this.ratios[k] / currentOtherTotal) * remaining);
      });
    }

    const drift = 100 - Object.values(this.ratios).reduce((s, v) => s + v, 0);
    this.ratios[others[0]] += drift;
  }

  serialize() {
    return {
      ratios:   { ...this.ratios },
      invested: { ...this.invested },
    };
  }

  deserialize(data) {
    if (!data) return;
    if (data.ratios)   this.ratios   = { ...this.ratios,   ...data.ratios };
    if (data.invested) this.invested = { ...this.invested, ...data.invested };
    this._applyEffects();
  }
}
