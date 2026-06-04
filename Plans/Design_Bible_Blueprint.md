# Design Bible — Implementation Blueprint

*A roadmap for executing [Design_Bible.md](Design_Bible.md). Each section below is a self-contained work package sized for one focused session. Copy a section's "Prompt" block verbatim to start that session.*

---

## How to use this blueprint

- **Order matters loosely.** Packages 1–4 are foundation work (lore, naming, persistence rules) and should land before content packages (5–9). Package 10 is a holding bin for the one open design question.
- **Each prompt is self-contained.** It restates goals, points to the Design Bible, and lists deliverables — no prior conversation needed.
- **Scope discipline.** If a session starts sprawling beyond its package, stop and spin out a new package rather than expanding scope.

---

## Package 1 — Rename "Overseer" → "Al" and establish his voice

**Why first:** Touches strings across many systems. Doing this once, cleanly, unblocks every later package that writes new dialogue.

**Scope:**
- Global rename of "Overseer" to "Al" in code, UI strings, and seed data.
- Define Al's voice (advisor + comedic jabs) as a short style guide checked into `Plans/`.
- Add 3–5 example lines that future packages can mimic (landing, first death, first portal unlock, mine entry, boss failure).

**Out of scope:** New dialogue triggers, dialogue system, portrait/animation work.

**Prompt:**
> Read [Plans/Design_Bible.md](Plans/Design_Bible.md). The companion character is now named **Al** — a remote helper who guides the player and adds comedic jabs in trouble. Do two things:
> 1. Rename every occurrence of "Overseer" to "Al" across the codebase (code, UI text, seed data, save migration if needed). Use grep first, then surgical edits. Don't touch unrelated strings.
> 2. Create `Plans/Al_Voice_Guide.md` — one page, ≤300 words: tone rules, what Al says yes to / never says, plus 5 example lines (landing, first death, first portal discovery, mine entry, boss failure). Keep it terse.
> Do NOT add new dialogue triggers or a dialogue system — those are later packages.

---

## Package 2 — Persistence-by-Generation rules

**Why early:** Half the game's identity hinges on the table at lines 39–44 of the Design Bible. Until those rules are encoded, every system that serializes is guessing.

**Scope:**
- Encode the Gen 1 → Gen 4+ backup-fidelity table as data in `js/config.js` (or a new `js/systems/GenerationSystem.js`).
- Audit every system's `serialize()` / `load()` against the table. Produce a matrix: *system × current behavior × intended Gen-1 behavior × delta*.
- **Design output only** — do not change save behavior in this package. The matrix becomes the spec for Package 3.

**Prompt:**
> Read [Plans/Design_Bible.md](Plans/Design_Bible.md) §"The Persistence Rationale" and the Permanent-vs-Session table at the end. The backup-fidelity-by-generation table is authoritative.
> Deliver `Plans/Persistence_Matrix.md`: for each system that calls `serialize()`/`load()` (see SaveSystem.js wiring), one row with (a) what it currently persists, (b) what Gen 1 should persist per the bible, (c) the delta. Also add a `GENERATION_BACKUP_TIERS` constant to `js/config.js` encoding the table as data.
> This is a SPEC session. Do NOT change save behavior or rip out persistence — that's Package 3.

---

## Package 3 — Apply the persistence rules

**Depends on:** Package 2's matrix.

**Scope:** Execute the deltas from the matrix. Add a save-version bump and migration that downgrades existing saves to Gen-1 rules unless a generation marker is present.

**Prompt:**
> Read [Plans/Persistence_Matrix.md](Plans/Persistence_Matrix.md) (produced by Package 2) and [Plans/Design_Bible.md](Plans/Design_Bible.md) §Persistence.
> Implement the deltas. Bump `SaveSystem` version, write a migration that maps pre-blueprint saves into the new tiered model. The current player should be treated as Gen 1 unless their save says otherwise. Keep changes surgical — one system at a time, run `npm test` between systems.

---

## Package 4 — Computer-as-Physical-Object visual progression

**Scope:**
- Define the four visual milestones from the bible (lines 54–58) as Three.js scene assemblies built in `Environment.js` at the Landing Site.
- Add a `computerGeneration` field to game state (already present from Package 2/3 work).
- Build Gen 1 and Gen 2 visuals only — Gen 3/4 are stubs returning the Gen 2 mesh with a TODO marker.

**Out of scope:** Sound, particles, animation. Static meshes with toon material + outlines, matching existing style.

**Prompt:**
> Read [Plans/Design_Bible.md](Plans/Design_Bible.md) §"The Computer as a Physical Object". Build the Gen 1 and Gen 2 visual states of the Landing Site computer in `js/scene/Environment.js`. Use `createToonMaterial` and `addOutline` per existing conventions. Wire the visual swap to `state.computerGeneration` (currently always 1). Gen 3 and Gen 4 should be stubs that log a TODO and return the Gen 2 mesh — leave them for a later package. Test by temporarily forcing generation in the console.

---

## Package 5 — Mine as Portal Hub

**Scope:**
- Convert the Mine from pure resource zone into a discovery space with sealed portal arches.
- Each arch is a persistent placed object with: required PP threshold, required boss defeat flag, target zone id, "sealed" / "unlockable" / "open" visual state.
- Discovery model: arches are not announced. The player walks up, gets a HUD readout from Al.
- Implement 1 portal end-to-end (the Shattered Lattice arch, sealed). Subsequent portals are data entries.

**Prompt:**
> Read [Plans/Design_Bible.md](Plans/Design_Bible.md) §"The Mine and the Portal Network". Add a portal system: persistent stone-arch meshes placed deep in the Mine, each with `{ id, position, ppThreshold, requiredBossDefeat, targetZone, state }`. States: sealed (no compute), unlockable (compute met, boss not beaten), open (both met). On player proximity Al delivers a line based on state (use voice guide from Package 1). Implement 1 arch — Shattered Lattice — with placeholder threshold and a stub `targetZone`. Wire collision and the proximity readout. Do not build the Shattered Lattice zone itself (Package 7).

---

## Package 6 — Boss Simulation Protocol

**Scope:**
- Boss-as-simulation framing: defeat or fail, the result trains Al's model. Failing N times reveals more boss telegraphs or shaves HP slightly (design decision in session).
- Hook into existing `CombatSystem`: boss encounters carry a `simulationKey`; on win, set a flag the portal system reads.
- Wire to one boss per Tier 1 zone — Verdant Maw, Lagoon Coast, Frozen Tundra — using existing combat mechanics. No new combat tech.
- Boss design principle from bible: each boss mirrors its zone's device interaction.

**Prompt:**
> Read [Plans/Design_Bible.md](Plans/Design_Bible.md) §"The Boss: Simulation Protocol". Add a simulation-boss layer to `CombatSystem`: each boss has a `simulationKey`, an attempt counter that persists, and a one-time `defeated` flag that the portal system (Package 5) reads. Pick a per-attempt easing rule (e.g. small HP scaling or telegraph reveal) and document it inline in a single-line comment. Stat-up bosses for Verdant Maw, Lagoon Coast, Frozen Tundra with kit that mirrors each zone's device interaction (sustained pressure / circular drag / charge-release). Use existing combat tech only.

---

## Package 7 — Tier 2 Zone: The Shattered Lattice

**Depends on:** Packages 4, 5, 6 (computer visuals so player can see Gen 2, portal system so the arch opens, boss system so it's gated).

**Scope:**
- New zone in `Environment.js`: crystalline asteroid field, non-Euclidean paths, distinct palette.
- Materials: resonance crystals, void glass, lattice shards. Add to seed data.
- One boss using the simulation system. One unique device (TBD in session — designer call).
- Follow the full zone-add checklist in `CLAUDE.md` (Environment, main.js, config, GameStatistics).
- Critically: this zone must NOT visually echo Earth tech (per the user's note striking the Molten Archive candidate).

**Prompt:**
> Read [Plans/Design_Bible.md](Plans/Design_Bible.md) §"Tier 2 Zones — Candidate Zone B: The Shattered Lattice" and the user's note rejecting Earth-tech aesthetics. Build the Shattered Lattice as a fully accessible zone gated behind its Mine portal. Follow the zone-add checklist in `CLAUDE.md` exactly: Environment._buildShatteredLattice(), switchZone case, getZoneLabel, getResourceNodeSpawns, getEnemySpawns, ZONE_TERRAIN + ZONE_SPAWN_POS in main.js, ENV_UNLOCK threshold in config, TOTAL_WORLDS bump. Add materials (resonance crystals, void glass, lattice shards) to seed data. Pick one device interaction that doesn't duplicate Tier 1 (no tap/drag/charge — invent a 4th gesture). One simulation boss using Package 6's system. Crystalline palette, non-Euclidean path layout via `seededRandom`. NO Earth-tech echoes.

---

## Package 8 — Surprise Legacy Resource pattern

**Scope:**
- Cross-tier recipe rule: Gen N recipes can require Tier-1 materials in new roles. Bible names Copper-as-superconducting-substrate in Gen 3 as the canonical example.
- Add a recipe-tagging convention so the UI can flag "uses legacy material" without breaking discovery surprise.
- Author 3 example Gen 2 recipes using this pattern (combine new Shattered Lattice material with a Mine/Tundra/Lagoon material in a non-obvious role).

**Prompt:**
> Read [Plans/Design_Bible.md](Plans/Design_Bible.md) §"The surprise legacy resource pattern". Authoring task: in `server/definitions/seedData.js`, add 3 Gen-2 recipes that combine a Shattered Lattice material with a Tier-1 material used in a *new role* (the Copper→superconductor pattern). Add a `legacyRole` field to recipe data describing the role so the crafting UI can tell players "Copper used as substrate" only after they unlock it. Don't modify crafting logic beyond passing the field through.

---

## Package 9 — Generation transitions: Ascension and the visual moment

**Scope:**
- The act of advancing Gen N → Gen N+1: trigger conditions, ceremony, what the player sees.
- Visual: Landing Site computer swaps mesh (Package 4), Al delivers a line, save snapshots, new portal cluster becomes discoverable.
- This is the package that makes the entire blueprint feel like a game instead of a system.

**Prompt:**
> Read [Plans/Design_Bible.md](Plans/Design_Bible.md) §"Tier System: Computer Generations" and "The Computer as a Physical Object". Build the generation-up moment: pick the trigger (likely a PP-threshold + craft a "generation core" item — finalize in session), then on trigger: bump `state.computerGeneration`, swap the Landing Site mesh via Package 4's hook, fire Al's transition line (voice guide), snapshot the save, mark new portal arches as discoverable in the Mine. Show the player they crossed a threshold — this should feel like a milestone, not a stat tick.

---

## Package 10 — OPEN DESIGN QUESTION: PP-as-neural-calibration

**Status:** Held. User flagged at Design_Bible.md:24 — "I'm not sure I agree with this, I don't want to delete it, I want to consider it at a further time."

**Decision needed before scheduling:** Does spending PP on stats represent (a) allocating compute to calibrate the exo-suit, or (b) something else entirely? If (a), the stat-up UI gets a compute-allocation framing; if (b), the existing abstraction stays.

**Prompt (when ready):**
> Read [Plans/Design_Bible.md](Plans/Design_Bible.md) line 24 — the held question about PP-as-neural-calibration. Don't implement yet — brainstorm 2–3 framings (with pros/cons) for what PP-on-stat-up *means* narratively, write them to `Plans/PP_Stat_Framing.md` as a one-page decision doc, and stop. The user decides the framing in conversation after reading it.

---

## Suggested execution order

1. Package 1 (Al rename — unblocks everyone)
2. Package 2 → 3 (persistence spec then apply)
3. Package 4 (visual computer — high motivation, low risk)
4. Package 6 (boss simulation — needed by 5)
5. Package 5 (portal hub — needed by 7)
6. Package 7 (Shattered Lattice — the payoff)
7. Package 9 (generation transitions — game-feel layer)
8. Package 8 (legacy-resource recipes — late polish)
9. Package 10 (open question — whenever)

Packages 4 and 6 are independent and can run in parallel sessions.
