# Processing Power — Consolidated Implementation Plan

This document merges the two design briefs in `plans/` (`Architectural Blueprints for Infinite Spatial Logistics.txt` and `Velocity by Design Engineering 3D Spatial Progression (Introduce rails).txt`) with the existing `implementation_plan.md` (Lore + Biome Devices) into a single sequenced plan, and prepends the immediate UI bug fix the user flagged in the screenshot.

---

## 0. Bug Fix First — Menu Tab Bar Is Click-Blocked

### Symptom
With any panel open (e.g. EQUIPMENT), the bottom tab bar (`EQUIP / TECH / CRAFT / CODEX / STATS / ⚙`) is visible but does not respond to clicks. The user marked the row "NO WORK" in the screenshot.

### Root cause
`css/main.css:1087-1097` — `.panel-overlay` is `position: fixed; inset: 0; z-index: 150; pointer-events: auto;` so each open panel paints a full-screen, click-capturing layer.

`css/menu.css:135-167` — `#menu-screen` is `z-index: 60` and `#menu-tabbar` is `z-index: 62`. Both are below the panel overlay, so the tab bar is *visually* peeking through the overlay's translucent background but **all pointer events are intercepted by the overlay**, hence the buttons cannot be clicked.

The wiring in `js/main.js:478-480` is correct — `_menuTabs.forEach(t => t.addEventListener('click', () => _activateTab(t.dataset.tab)))` — clicks just never reach the buttons.

### Fix (minimal — CSS only)
1. In `css/menu.css` raise `#menu-tabbar` above the panel-overlay layer, e.g. `z-index: 200`.
2. Also raise `#menu-screen` itself to `z-index: 155` (or use `isolation: isolate`) and let the backdrop keep its current behavior. Backdrop should stay behind the tab bar but above the panels are fine because we want clicks-outside-the-panel to close it — but the user-flagged issue is just about the tabs.
3. In `.panel-overlay` (`css/main.css:1087`) reserve space at the bottom so the panel-window doesn't paint behind the tab bar:
   - `padding-bottom: 64px;` (matches `.menu-tab` min-height of 44 + tabbar padding).
4. Verify: open any panel, click each of the other tabs — should switch panels via `_activateTab` and call `hud._refreshPanel(panelId)`.

### Optional follow-up (cleaner architecture)
Move `#menu-tabbar` *out of* `#menu-screen` so the tab bar is its own top-level stacking context independent of any panel state. This makes the z-index ordering self-evident and eliminates a future regression vector. (Same JS wiring; just sibling instead of child in the DOM.)

### Acceptance test
- Open EQUIP → click TECH → tech panel opens, equipment hides, TECH chip is `.active`.
- Repeat for CRAFT, CODEX, STATS, ⚙.
- ESC still closes the menu screen.
- Mobile (`max-width: 640px`) full-width tabbar still works (test at 380px).

---

## 1. Reconcile the Three Design Tracks

The plans folder + `implementation_plan.md` describe three overlapping tracks. They are compatible but each contributes specific systems:

| Track | Source | Net new mechanics |
|---|---|---|
| Spatial Logistics (5 phases) | `Architectural Blueprints…txt` | Big-number scaffolding, diegetic UI, prestige-with-persistent-infrastructure, layout compression, manufactured friction events |
| Rails / Velocity | `Velocity by Design…txt` | Auto-routing rails, post-prestige empowerment loop, infrastructure compression nodes |
| World-Machine | `implementation_plan.md` | Lore reframe (Kinetic Cartography, Mag-Lev Conduits), four interconnected biome devices with synergy chain |

The biome-device synergy chain (Drill ↔ Enzymes ↔ Coolant ↔ Heat Cells ↔ Superconductors) becomes the **economy** that the spatial-logistics scaffolding *runs on*. Rails are the persistence-through-prestige artifact. Compression is the late-game readability tool.

---

## 2. Phased Build Plan

### Phase A — Foundation (ships with the bug fix above)
- **A1. Fix tab-bar click-blocking** (Section 0).
- **A2. Big-number safety.** Replace raw `Number` PP storage with a mantissa/exponent helper (`js/util/BigNum.js`) used by `PPSystem`, `PedometerSystem`, and any cost computations. Required before late-game scaling makes `Number.MAX_SAFE_INTEGER` reachable. Migrate `serialize()` / `load()` to read both legacy floats and the new `{m,e}` shape.
- **A3. Lore relabel pass.** Rename UI strings only (no system rewires):
  - "Steps Shop" → "Kinetic Cartography Uplink"
  - "Speed Tracks" → "Mag-Lev Conduits" (or just "Conduits")
  - Pedometer header in `index.html:248` and `HUD.js` panel refresh.
- **A4. Diegetic indicators (cheap version).** On the player exo-suit mesh, add a small emissive core whose color reflects energy %. Above each placed track, a faint glowing pip when `nearTracks > 0`. No new panels, no chrome.

### Phase B — Biome Devices (the synergy chain in `implementation_plan.md`)
Each device is a new system file in `js/systems/` plus a 3D interactable in `Environment.js`. Follow the existing zone-add checklist from `CLAUDE.md`.

- **B1. Deep Core Drill (already partially built — `DrillSystem.js`).**
  - Extend rewards to emit **Geothermal Heat Cells** when the stratum is ≥ 5 *and* a Cryo-Coolant canister is consumed.
  - New material id `heatCell` in `server/definitions/seedData.js`.
  - DB transaction: `inventory.addMaterial` already covers it.
- **B2. Bio-Resonance Siphon (Verdant Maw).**
  - New `BioSiphonSystem.js`: rhythm mini-game (ring contracts at 1.6 Hz, click in target zone → multiplier++; misses reset).
  - Yields organic mats + **Catalytic Enzymes**.
  - Enzymes: `inventorySystem.materials.enzyme--` consumed → multiplier on `DrillSystem.damage` for N seconds.
  - Panel: small floating ring widget, no full-screen panel (diegetic).
- **B3. Tidal Centrifuge (Lagoon Coast).**
  - New `CentrifugeSystem.js`: drag-to-spin; angular velocity decays each frame and you re-input to maintain it. RPM threshold → tick of yield.
  - Yields silica/quartz + **Cryo-Coolant**.
  - Coolant gates the Drill's stratum 5+ runs (B1).
- **B4. Cryo-Stasis Defroster (Frozen Tundra).**
  - New `DefrosterSystem.js`: hold-and-release charge, overshoot wastes the charge.
  - **Consumes Heat Cells** (gate), **emits Superconducting Coils**.
  - Coils apply a global `costMultiplier < 1.0` to `TechTreeSystem` and `CraftingSystem` recipe costs.
- **B5. Wire the synergy loop end-to-end.** Add a new `Codex` entry per device that reveals as the player first uses each, plus a single "Synergy Web" diagram entry that lights up dependencies as they're discovered.

### Phase C — Rails-as-Persistence (from the Velocity brief)
- **C1. Rails vs Speed Tracks.** 
  - There already exist Speed Tracks that accelerate the velocity of the player. The new tiles will act like "rails." 
  - Promote `_placedTracks` or introduce a parallel infrastructure for Rails with a persistent shape: `{ zone, x, z, level }`.
  - **Rail Mechanics:** When a fast-moving player is on a rail, the rail assists with steering at high speeds. This ensures they don't slip or overshoot the track as they are turning.
- **C2. High-Velocity Guidance.** Instead of taking over input via auto-routing, the rail system acts as a physical or magnetic guide. The player continues to steer, but the track adds a subtle constraint force that helps keep their avatar glued to the path.
- **C3. Persistence across prestige.** Infrastructure bought with 'step' count (e.g., rails and tracks) **must not be restarted upon prestige**. When `AscensionSystem.ascend()` resets PP/prestigeBonus, do not clear `pedometer._placedTracks` (or equivalent rail structures). Add an explicit comment in `AscensionSystem.js` noting this preservation rule, and audit `SaveSystem.apply()` to confirm survival.

### Phase D — Cyclical Reset & Compression (Phases 4 of both briefs)
- **D1. Confirm the existing prestige loop matches "Iterative Loop".** `AscensionSystem.js` already resets PP/prestigeBonus and grants AP. Document in `CLAUDE.md` that conduits and biome-device unlocks persist; only PP, run-scoped buffs, and per-run inventory get cleared (TBD which mats are run-scoped — recommend: heat cells, enzymes, coolant *spent* this run reset; raw mats persist).
- **D2. Compression node.**
  - New entity `CompressorNode` placed in any zone that absorbs N adjacent conduits within radius R into a single "compressed" conduit with `level = sum(levels)` and a footprint of one tile.
  - Visual: a denser, more saturated version of the conduit mesh.
  - Affordance: when ≥ 5 conduits are within compression range, surface a diegetic "compress" prompt (a glow + key hint), not a panel.
  - Reversible? The brief says "irreversible upgrades with notable drawbacks" — recommend irreversible to satisfy Phase 5's "cost of regret".

### Phase E — Manufactured Friction (Phase 5 of the Architectural brief)
- **E1. Spatial budget.** Cap conduits per zone (e.g. 64). Forces compression instead of sprawl.
- **E2. Disruption events.**
  - New `DisruptionSystem.js`. Every X minutes (seeded), pick a random conduit chain and apply a temporary debuff (broken segment, ion storm zone) for 60–120 s.
  - Repair = walk to the segment and hold E for a few seconds.
  - This is the "active phase" anchor — keep it short and clearly bounded so it doesn't punish AFK.
- **E3. Irreversible upgrade choices.** Tech tree "Capstone" rows: each capstone gives +Y but disables an adjacent capstone permanently for the run. Surfaces "cost of regret" without permanently bricking accounts.

---

## 3. New / Touched Files (Quick Index)

| File | Reason |
|---|---|
| `css/menu.css` | Bug fix — z-index on tabbar |
| `css/main.css` | Bug fix — `.panel-overlay { padding-bottom }` |
| `js/util/BigNum.js` *(new)* | A2 mantissa/exponent helper |
| `js/systems/PPSystem.js` | Use BigNum |
| `js/systems/PedometerSystem.js` | Conduit kinds + persistence |
| `js/systems/AscensionSystem.js` | Comment + audit reset scope |
| `js/systems/BioSiphonSystem.js` *(new)* | B2 rhythm device |
| `js/systems/CentrifugeSystem.js` *(new)* | B3 spin device |
| `js/systems/DefrosterSystem.js` *(new)* | B4 charge device |
| `js/systems/DisruptionSystem.js` *(new)* | E2 friction events |
| `js/scene/Environment.js` | Place the four biome devices + compressor node |
| `js/scene/MineLayout.js` | Wire Drill→Heat Cell when coolant present |
| `js/main.js` | Bootstrap + callback wiring for new systems (per `CLAUDE.md` system-wiring pattern) |
| `js/ui/HUD.js` | Codex Synergy Web entry; relabel strings |
| `js/sync/SyncClient.js` | New tx types if biome devices need them |
| `server/definitions/seedData.js` | New materials: enzyme, coolant, heatCell, superconductor |
| `server/db/migrations/003_biome_devices.sql` *(new)* | Tables for biome-device run state if persisted server-side |
| `server/services/transactionService.js` | New tx handlers |
| `tests/runAll.test.js` | Unit tests for BigNum, synergy multipliers, compression |

---

## 4. Sequencing & Risk

1. **Phase A** ships first — A1 (CSS) is ~10 lines and unblocks the user immediately. A2 (BigNum) is invasive but isolated. A3 + A4 are cosmetic.
2. **Phase B** is where most of the design lives — build B1→B4 in the order of the synergy chain so the loop is testable end-to-end after each device.
3. **Phase C** depends on B being playable (conduits without anything to do are uninteresting).
4. **Phase D** depends on C (compression has nothing to compress without rich conduits).
5. **Phase E** is gameplay polish — ship last, tune in playtest.

Biggest risks:
- **BigNum migration** of existing saves. Mitigation: parse legacy `number` in `load()` and upcast to `{m: n, e: 0}`.
- **Conduit auto-routing UX.** Mitigation: prototype with a single zone, gate behind a toggle, A/B against manual control before fleet rollout.
- **Mini-game friction.** Three new mini-games (rhythm/spin/charge) is a lot. Mitigation: each device must also work in a "passive low-yield" fallback so the player isn't forced into mini-games when they want to idle.

---

## 5. Open Questions (good to confirm before B starts)

1. Should biome devices be operable by drones (passive mode)?
2. Are conduits truly permanent across prestige, or only across "soft" resets (with an even harder ascension wiping them)?
3. Compression: irreversible (cost-of-regret) or reversible-with-penalty?
4. Disruption events: opt-in toggle for idle players, or always-on?
