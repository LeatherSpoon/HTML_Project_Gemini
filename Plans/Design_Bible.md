# Processing Power — Design Bible
*Synthesized from planning sessions. This document is the authoritative design reference.*

---

## The Premise

The player is a lone operative whose ship lands on an alien planet. Back on Earth, a secret organization has plans for you. They have one directive that transmits immediately on landing: **build a large computer to improve your situation**

The planet's resources are uniquely suited to constructing a computational architecture that cannot be replicated anywhere else.**Al** — guides the player, helps with perspective, and manages the one thing that keeps the player alive: **the backup.**

---

## The Core Loop in One Sentence

Build a computer powerful enough to perfect yourself more completely each time you fall, so that each new run begins from a higher floor than the last.

## I don't want a mothership, I want Al, a remote helper that can communicate directly with the player that offers advice and comedic jabs when the player finds trouble.
---

## What Processing Power Actually Is


## When the player spends PP to upgrade a stat, they are allocating compute to calibrate their exo-suit's neural interface.(I'm not sure I agree with this, I don't want to delete it,  I want to consider it at a further time)## 

~~When they Offload, they are committing a batch of raw cycles to a permanent architectural improvement — a bigger cap, a faster bus, a new memory tier.~~

The number going up is the computer getting smarter.

---



## I replaced "Overseer" with "Al"##


| Computer Generation | What the backup preserves |
|---|---|
| Gen 1 | Physical infrastructure (conduits, placed rails), zone access, portals discovered |
| Gen 2 | Skill calibrations, equipment configurations, drone assignments |
| Gen 3 | Full stat profiles, tech tree unlocks, mastery records |
| Gen 4+ | Progressively more complete — approaching full continuity |

This means the reset mechanic is not a punishment. It is the story. Each run is the player pushing further before the backup catches up. Each generation is a more complete version of themselves returning.

---

## The Computer as a Physical Object

The computer grows at the Landing Site. ~~It starts as a processor core mounted on the hull. ~~By Gen 4 it is a structure larger than the original ship. By late game it dominates the Landing Site — a looming, luminous machine that visually anchors every return trip.

**Visual progression milestones:**
- Gen 1: Exposed circuitry on the ship hull, a single antenna array
- Gen 2: A server stack built alongside the ship, cooling conduits running into the ground
- Gen 3: The ship is no longer recognizable — it has become a node in a larger structure
- Gen 4+: Towers, relay dishes, plasma conduits — the machine is becoming the landscape

The computer's visual state is the most immediate indicator of player progression. A returning player should be able to glance at it and know exactly where they are.

---

## The Mine and the Portal Network

The Mine is not just a resource zone. It is the **portal hub** — the one place on the planet where the geology is exotic enough for stable reality interfaces. Al explains early: the mineral composition of the mountain creates natural resonance chambers. With sufficient compute, these chambers can be tuned to lock onto coordinates in the reality matrix. (LOVE THIS!)

Each portal in the Mine is a **persistent physical structure** — a carved arch of local stone reinforced with whatever exotic materials were needed to stabilize the connection. They look different from each other. They have presence. The player passes through them the way Rick and Morty pass through the portal gun's green tear: instantly, completely, into somewhere entirely different.

**Portal unlock logic:** Each portal requires the computer to have reached a minimum PP threshold AND the player to have defeated the zone's boss at least once. The computer calculates the coordinates; the boss defeat confirms the computer can model what's on the other side.

**Exploration incentive:** Portals are discovered by exploring deep in the Mine. The player finds a sealed arch, and understands they need more compute to open it. This is the Shadows of Brimstone influence — the Mine is a place of discovery, not just a resource node.

---

## The Boss: Simulation Protocol

The player may fail a simulation multiple times. Each failure refines the Al's model. This is the Edge of Tomorrow loop: you are not losing, you are training the algorithm. When you pass, the portal locks in and the zone opens.

**Boss design principle:** Each boss simulation should mirror its zone's core interaction. If the zone's device requires sustained pressure, the boss has high HP and punishes hesitation. 

---

## Tier System: Computer Generations

A **generation** is a major architectural milestone — a qualitative leap in what the computer can do, not just a larger number. Each generation:

1. Unlocks a new cluster of portals in the Mine (new zones become discoverable)
2. Expands what the backup preserves (see persistence table above)
3. Visually transforms the Landing Site computer
4. Introduces new recipe tiers that require both new materials AND legacy materials from earlier zones

There is no ceiling on generations. The first 1–2 beyond the current content are the immediate design target.

**The "surprise legacy resource" pattern:** New-generation recipes should occasionally require a Tier 1 material in a new role. Copper that was a basic wire in Gen 1 becomes a superconducting substrate in Gen 3 when combined with a Tundra material. The player goes back to the Landing Site mine shaft for copper and finds it newly meaningful. This is the intended revisit driver alongside zone-specific rare drops.

---

## Zones: Current and Planned

### Tier 1 Zones (Gen 1 — home planet, surface)

| Zone | Device | Interaction | Boss Sim |
|---|---|---|---|
| Landing Site | — | Navigation hub | — |
| The Mine | Deep Core Drill | Tap / percussive | — (portal hub, no boss) |
| Verdant Maw | Bio-Resonance Siphon |
| Lagoon Coast | Tidal Centrifuge | ~~Circular drag~~ |~~ Sustained pressure~~ |
| Frozen Tundra | Cryo-Stasis Defroster | ~~Charge / release~~ | ~~Precision timing~~ |

### Tier 2 Zones (Gen 2 — portal destinations, to be designed)

These are the first zones accessible only through the Mine's portal network. They are not on the home planet. Each should feel like a genuinely different reality — different color palette, different geometry, different rules.

<!-- ### **Candidate Zone A: The Molten Archive** ### 
###A world where an ancient civilization built its data centers inside a volcanic shelf. Lava flows between server ruins. Materials: refined obsidian, thermal cores, ancient data-wafers. Enemies are automated defense constructs — mechanical, deliberate, slow but armored. Boss: the Archive's master defense AI, a multi-phase construct that escalates power as HP drops. --- I disagree with other worlds also having similar tech based structures. I don't want it to look like Earth---### 
### -->


**Candidate Zone B: The Shattered Lattice**
A crystalline asteroid field stabilized into a walkable environment by an unknown force. Geometry is fractured and non-Euclidean — paths loop and fork unexpectedly. Materials: resonance crystals, void glass, lattice shards. 
---
## Permanent vs. Session Upgrades

| Upgrade Type | Scope | Rationale |
|---|---|---|
| Mag-Lev Conduits / Rails | **Permanent** | Step-earned physical infrastructure |
| Computer structure / generation | **Permanent** | The whole point of the game |
| Zone unlocks / portal access | **Permanent** | Discovered and opened, not re-earned |
| Codex / Achievements | **Permanent** | Discovery-based, always owned |
| Character stat base levels | **Permanent** (scales with gen) | Preserved by the backup |
| Biome device levels | **Session** | Rebuilt each run as the machine comes back online |
| Drone assignments | **Session** | Re-allocated each run |
| Active tech tree nodes | **Session** | Structural nodes persist; run boosts reset |
| Processed materials (enzymes, coolant, heat cells) | **Session** | Byproducts of device operation |
| Raw materials (iron, copper, timber, etc.) | **Permanent** | Physical, don't require computational storage |
| Run-scoped combat buffs / time-warp boosts | **Session** | Explicitly temporary |
---

## The Three-Tier Progression Reset System

### Micro-Offload (tactical)
Sacrifice current PP balance → permanent PP cap increase (√PP × multiplier). Frequent, within a run. No structural change. Already implemented in PPSystem.js.

### Offload (build reset — the expedition-prep ritual)
- **Commits:** PP balance + raw resource stockpile into the machine
- **Resets:** All stat point allocations (fully refunded, freely reallocated)
- **Preserves:** Infrastructure (rails/conduits), equipment inventory, zone access, tech tree, computer structure, drone upgrades
- **Purpose:** The player redesigns their character for the next expedition. Equipment is assessed and selected based on the destination zone. Zone-specific gear requirements (thermal plating for cold zones, bio-filters for toxic zones, etc.) make the pre-Offload moment genuinely strategic.
- **Frequency:** Multiple times within a generation

### Ascension (generation advance — a story beat)
- **Trigger:** Computer reaches a milestone AND specific conditions met (boss simulation cleared, required material delivered)
- **Mechanic:** Al runs simulations, identifies a material with properties needed for the next architectural upgrade, opens a portal, briefs the player on the mission. Player extracts the material, returns it. Machine advances a generation.
- **Effect:** New portals open in the Mine (new zones discoverable), computer visually transforms, new content tier unlocks, backup fidelity expands
- **Mutually beneficial:** Building the computer helps the player; the player's expeditions help the computer. Neither advances without the other.
- **Frequency:** Rare — a major milestone, not a routine reset

---

## Build Archetypes (Fully Modular — "Trying On Costumes")

Stat points reset completely on each Offload. No class lock. The player reinvents their character for each expedition. These are configurations, not classes.

| Archetype | Primary Stats | Identity | Zone Advantage |
|---|---|---|---|
| **Brawler** | Strength, Agility, Focus Rate | Hits hard, generates FP fast, spams skills | Mine, enclosed zones |
| **Scout** | Dexterity, Agility, Perception | Ranged combat, high mobility, finds hidden nodes | Open zones — Lagoon, Verdant Maw |
| **Engineer** | Crafting, Crafting Speed, Dexterity, Constitution | Strong gatherer — drones more productive, crafts better gear | Resource-heavy zones; turns idle loop into main loop |
| **Bulwark** | Health, Defense, Constitution, Strength | Slow, durable, crosses terrain that kills other builds | Boss simulations, high-damage zones, Frozen Tundra |
| **Ghost** | Speed, Agility, Focus Rate | Covers more ground faster than any build | Any zone for efficiency and extraction | Does not gather step-count; is unhindered by zone speed difficulty level.

### Zone-Specific Equipment Layer
Equipment at Offload must account for destination zone requirements:
- **Frozen Tundra:** Thermal-plated legs + torso or cold damage negates Constitution advantage
- **Toxic zones:** Bio-filter head/torso or poison stacks unmanageably  
- **High-traverse zones:** Mag-boots (feet) for grip and stability
- The gear layer creates real pre-expedition decisions layered on top of stat allocation

---


