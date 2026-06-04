const CODEX_ENTRIES = {
  // ── Materials ──────────────────────────────────────────────────────────────
  copper:         { category: 'Material', label: 'Copper',          flavor: 'A highly conductive metal. Common throughout the sector.' },
  timber:         { category: 'Material', label: 'Timber',          flavor: 'Dense fibrous wood. Burns slow, builds strong.' },
  stone:          { category: 'Material', label: 'Stone',           flavor: 'Compressed mineral aggregate. Ubiquitous on terrestrial worlds.' },
  iron:           { category: 'Material', label: 'Iron',            flavor: 'Ferrous alloy. The backbone of any frontier operation.' },
  carbon:         { category: 'Material', label: 'Carbon',          flavor: 'Crystalline carbon matrix. Prized by fabricators.' },
  quartz:         { category: 'Material', label: 'Quartz',          flavor: 'Silicon dioxide crystals. Resonant in energy systems.' },
  silica:         { category: 'Material', label: 'Silica',          flavor: 'Refined sand particulate. Essential for circuit fabrication.' },
  fiber:          { category: 'Material', label: 'Fiber',           flavor: 'Organic polymer strands. Lightweight and remarkably tensile.' },
  orosil:      { category: 'Material', label: 'Orosil',      flavor: 'A rare gold-silver alloy found in deep mineral seams. Prized by traders and artificers alike.' },
  gold:        { category: 'Material', label: 'Gold',        flavor: 'Dense precious metal. High conductivity, higher value.' },
  fractalite:  { category: 'Material', label: 'Fractalite',  flavor: 'A crystalline compound with recursive internal geometry. Radiates faint energy.' },
  stahlerte:   { category: 'Material', label: 'Stahlerte',   flavor: 'Hardened alloy of extreme density. Used in structural and armored applications.' },
  resin:       { category: 'Material', label: 'Resin',       flavor: 'Organic binding compound. Adhesive and heat-resistant.' },
  epoxy:       { category: 'Material', label: 'Epoxy',       flavor: 'Two-part polymer sealant. Bonds most known alloys.' },
  aetherite:   { category: 'Material', label: 'Aetherite',   flavor: 'Compressed energy in crystalline form. Handle with caution near circuitry.' },
  holzura:     { category: 'Material', label: 'Holzura',     flavor: 'Dense hardwood composite. Rigid, heat-cured, and remarkably durable.' },
  verdanite:   { category: 'Material', label: 'Verdanite',   flavor: 'Living mineral-plant matter. Grows slowly and stores organic energy.' },
  logicite:    { category: 'Material', label: 'Logicite',    flavor: 'Salvaged micro-logic substrate. Forms the neural fabric of complex machines.' },
  piedral:     { category: 'Material', label: 'Piedral',     flavor: 'Compressed stone shards dropped by mineral-shelled creatures. Dense and jagged.' },
  knochel:     { category: 'Material', label: 'Knochel',     flavor: 'Hardened organic matter from defeated enemies. Part bone, part hide.' },
  bronzura:    { category: 'Material', label: 'Bronzura',    flavor: 'A bronze-derived alloy with faint radioactive properties. Dangerous in quantity.' },
  basalva:     { category: 'Material', label: 'Basalva',     flavor: 'Raw basaltic mineral from volcanic deposits. Extremely heat-resistant.' },
  tobarba:     { category: 'Material', label: 'Tobarba',     flavor: 'Porous volcanic rock laced with metallic ore veins. Found near lava flows.' },
  vitrion:     { category: 'Material', label: 'Vitrion',     flavor: 'Refined glass-silicon composite. Near-perfect for optical and computing systems.' },
  // ── Enemies ────────────────────────────────────────────────────────────────
  rusher:  { category: 'Enemy', label: 'Rusher',  flavor: 'Fast-moving bipedal combat unit. Prioritizes aggression over defense. Minimal shielding.' },
  swinger: { category: 'Enemy', label: 'Swinger', flavor: 'Heavily armored melee fighter. Wind-up attacks carry lethal momentum. Patience wins.' },
  burst:   { category: 'Enemy', label: 'Burst',   flavor: 'Ranged energy emitter. Volatile capacitor banks power its salvos. Stay mobile.' },
  // ── Crafted ────────────────────────────────────────────────────────────────
  terrainCutter:    { category: 'Crafted', label: 'Terrain Cutter',    flavor: 'A powered cutting blade. Clears terrain efficiently. Mind the durability.' },
  chargingStation:  { category: 'Crafted', label: 'Charging Station',  flavor: 'Personal energy restoration module. Plug in, power up, move out.' },
  storageContainer: { category: 'Crafted', label: 'Storage Container', flavor: 'Modular storage unit. More space, fewer trips back to base.' },
  energyCell:       { category: 'Crafted', label: 'Energy Cell',       flavor: 'Field-synthesized power reserve. 50 units of clean energy, on demand.' },
  ration:           { category: 'Crafted', label: 'Ration',            flavor: 'Compressed nutrient block. Keeps you operational between skirmishes.' },
  firstAid:         { category: 'Crafted', label: 'First Aid Kit',     flavor: 'Trauma kit for field wounds. Stops bleeding, restores function.' },
};

export class CodexSystem {
  constructor() {
    this._discovered = new Set();
    this.onDiscover = null; // fn(key, entry)
  }

  discover(key) {
    if (!key || this._discovered.has(key) || !CODEX_ENTRIES[key]) return false;
    this._discovered.add(key);
    if (this.onDiscover) this.onDiscover(key, CODEX_ENTRIES[key]);
    return true;
  }

  isDiscovered(key) { return this._discovered.has(key); }
  get discoveredCount() { return this._discovered.size; }
  get totalCount() { return Object.keys(CODEX_ENTRIES).length; }

  getEntries() {
    return Object.entries(CODEX_ENTRIES).map(([key, entry]) => ({
      key, ...entry, discovered: this._discovered.has(key)
    }));
  }

  serialize() {
    return { discovered: [...this._discovered] };
  }

  load(data) {
    if (data?.discovered) {
      this._discovered = new Set(data.discovered);
    }
  }

  static get ENTRIES() { return CODEX_ENTRIES; }
}
