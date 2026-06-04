import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createToonMaterial, addOutline, addOutlineToGroup, createRevealToonMaterial } from './ToonMaterials.js';
import { CONFIG } from '../config.js';
import {
  MINE_PORTAL_POS,
  MINE_ZONE_PORTALS,
  getMineableWallBlocks,
} from './MineLayout.js';

// Shared GLB model cache — loads each model once then reuses cloned scenes
const _modelCache = {};
const _loader = new GLTFLoader();
function loadModel(path) {
  if (!_modelCache[path]) {
    _modelCache[path] = new Promise((resolve, reject) => {
      _loader.load(path, gltf => resolve(gltf.scene), undefined, reject);
    });
  }
  return _modelCache[path];
}
function cloneModel(gltfScene, scale = 1) {
  const clone = gltfScene.clone(true);
  clone.scale.setScalar(scale);
  clone.traverse(n => {
    if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; }
  });
  return clone;
}

// Simple seeded PRNG (mulberry32) — deterministic tree/rock placement
function seededRandom(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.currentZone = 'landingSite';
    this._zonePortals = []; // { position, targetZone, ppRequired, mesh }
    this._collisionCircles = []; // { x, z, r }
    this._trackGroup = new THREE.Group(); // track markers live here, separate from env
    scene.add(this._trackGroup);

    // Construct cursor — shows selected tile in construction mode
    this._cursorGroup = new THREE.Group();
    this._cursorGroup.visible = false;
    scene.add(this._cursorGroup);
    const cursorTileMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.45, depthWrite: false });
    const cursorTile = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), cursorTileMat);
    cursorTile.rotation.x = -Math.PI / 2;
    cursorTile.position.y = 0.08;
    this._cursorGroup.add(cursorTile);
    this._cursorTileMat = cursorTileMat;
    const cursorEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.9, 1.9)),
      new THREE.LineBasicMaterial({ color: 0x00ffcc })
    );
    cursorEdges.rotation.x = -Math.PI / 2;
    cursorEdges.position.y = 0.09;
    this._cursorGroup.add(cursorEdges);
    this._cursorEdgeMat = cursorEdges.material;
    this._cursorPulseT = 0;

    // All placed tree positions — checked before each new tree to prevent overlap
    this._treePlacedPositions = []; // { x, z }

    // Trees in current zone — tracked for Terrain Cutter clearing
    this._trees = []; // { group, x, z, alive, collisionIdx }

    // Rocks in current zone — tracked for drilling
    this._rocks = []; // { mesh, x, z, alive, collisionIdx }

    // AABB collision boxes for grid blocks (mine/depths) — parented to rock entries
    this._collisionBoxes = [];

    // All GridHelper instances — toggled visible only in construction mode
    this._grids = [];

    // Reveal materials (mine blocks) — updated with player position each frame
    this._revealMaterials = [];

    // Growing trees (planted from seeds)
    this._growingTrees = []; // { group, targetScale, currentScale, x, z }

    // Pre-load all GLB models in parallel so they're ready when zones build
    this._modelsReady = Promise.all([
      loadModel('./models/Ghibli_Tree.glb').catch(() => null),
      loadModel('./models/Rock_Cluster.glb').catch(() => null),
      loadModel('./models/Fuel_Barrel.glb').catch(() => null),
      loadModel('./models/Supply_Crate.glb').catch(() => null),
      loadModel('./models/Watchtower.glb').catch(() => null),
      loadModel('./models/Cyborg_PC.glb').catch(() => null),
      loadModel('./models/Scrapper.glb').catch(() => null),
    ]).then(([tree, rock, barrel, crate, tower, pc, scrapper]) => {
      this._glb = { tree, rock, barrel, crate, tower, pc, scrapper };
      // Place GLB props for the initial zone (already built procedurally)
      this._placeGLBProps(this.currentZone);
    });

    this._buildLandingSite();
  }

  // ── Zone switching ─────────────────────────────────────────────────────────
  switchZone(zoneName) {
    // Clear current environment
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this._zonePortals = [];
    this._collisionCircles = [];
    this._collisionBoxes = [];
    this._trees = [];
    this._rocks = [];
    this._growingTrees = [];
    this._treePlacedPositions = [];
    this._revealMaterials = [];
    // Reset per-zone interactable station positions
    this._offloadStationPos = null;
    this._fabricatorPos = null;
    this._chargingStationPos = null;
    this._craftTerminalPos = null;
    this._droneMonitorPos = null;
    this._ascensionTerminalPos = null;
    this._masteryTerminalPos = null;
    this._workshopStationPos = null;
    this._constructorStationPos = null;
    this._extractorStationPos = null;
    this._assemblyMatrixStationPos = null;
    this.currentZone = zoneName;

    switch (zoneName) {
      case 'landingSite': this._buildLandingSite(); break;
      case 'mine': this._buildMine(); break;
      case 'depths': this._buildDepths(); break;
      case 'verdantMaw': this._buildVerdantMaw(); break;
      case 'lagoonCoast': this._buildLagoonCoast(); break;
      case 'frozenTundra': this._buildFrozenTundra(); break;
      case 'spaceship': this._buildSpaceship(); break;
      case 'workspace': this._buildWorkspace(); break;
      default: this._buildLandingSite();
    }

    // Place GLB props once models are ready (no-op if still loading)
    if (this._glb) {
      this._placeGLBProps(zoneName);
    }
  }

  // ── Per-frame environment update (growing trees, harvest cooldowns) ────────
  update(delta) {
    for (const t of this._growingTrees) {
      if (t.currentScale < t.targetScale) {
        t.currentScale = Math.min(t.targetScale, t.currentScale + delta * (t.targetScale / 60));
        t.group.scale.setScalar(t.currentScale);
      }
    }
    // Tick tree harvest cooldowns (30s before same tree can be harvested again)
    for (const t of this._trees) {
      if (t.alive && !t._harvestReady) {
        t._harvestTimer += delta;
        if (t._harvestTimer >= 30) {
          t._harvestReady = true;
          t._harvestTimer = 0;
        }
      }
    }
  }

  // ── Terrain Cutter interactions ────────────────────────────────────────────
  // requireHarvestReady: if true, only returns trees with harvest cooldown ready
  findNearestTree(playerPos, requireHarvestReady = false) {
    let best = null, bestDist = Infinity;
    for (const t of this._trees) {
      if (!t.alive) continue;
      if (requireHarvestReady && !t._harvestReady) continue;
      const d = Math.hypot(playerPos.x - t.x, playerPos.z - t.z);
      if (d < 1.8 && d < bestDist) { best = t; bestDist = d; }
    }
    return best;
  }

  // Harvest timber without removing the tree (30s cooldown per tree)
  harvestTimber(tree) {
    if (!tree || !tree.alive || !tree._harvestReady) return null;
    tree._harvestReady = false;
    tree._harvestTimer = 0;
    return { timber: 1 };
  }

  clearTree(tree) {
    if (!tree || !tree.alive) return null;
    tree.alive = false;
    tree.group.visible = false;
    // Remove collision circle for this tree
    const idx = this._collisionCircles.indexOf(tree.collision);
    if (idx !== -1) this._collisionCircles.splice(idx, 1);

    const timber = 1 + Math.floor(Math.random() * 2); // 1–2 timber
    return { timber, verdanite: 1 };                   // always yields a verdanite
  }

  plantTree(x, z) {
    // Spawn a tiny tree that grows to full size over 60s
    this._treePlacedPositions.push({ x, z });
    const treeGroup = new THREE.Group();
    const h = 1.4 + Math.random() * 0.8;
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.22, h, 6);
    const trunkMat = createToonMaterial(0x6b4226);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = h / 2;
    treeGroup.add(trunk);

    const crownColors = [0x2d6a2d, 0x3a8c3a, 0x245224];
    const crownMat = createToonMaterial(crownColors[Math.floor(Math.random() * crownColors.length)]);
    const crownH = 1.8 + Math.random() * 0.6;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.9, crownH, 7), crownMat);
    crown.position.y = h + crownH * 0.4;
    treeGroup.add(crown);

    treeGroup.position.set(x, 0, z);
    treeGroup.scale.setScalar(0.1);
    this.group.add(treeGroup);

    const collision = { x, z, r: 0.55 };
    this._collisionCircles.push(collision);

    const entry = { group: treeGroup, x, z, alive: true, collision, _harvestReady: true, _harvestTimer: 0 };
    this._trees.push(entry);
    this._growingTrees.push({ group: treeGroup, currentScale: 0.1, targetScale: 1.0, x, z });
  }

  // ── Rock drilling interactions ─────────────────────────────────────────────
  findNearestRock(playerPos) {
    let best = null, bestDist = Infinity;
    for (const r of this._rocks) {
      if (!r.alive) continue;
      const d = Math.hypot(playerPos.x - r.x, playerPos.z - r.z);
      if (d < 2.5 && d < bestDist) { best = r; bestDist = d; }
    }
    return best;
  }

  drillRock(rock, techOreBoost = 1.0) {
    if (!rock || !rock.alive) return null;
    rock.richness--;
    const stage = rock.maxRichness - rock.richness; // 1, 2, or 3

    // Loot scales with stage: more stone and ore chance on deeper hits
    const props = rock.props;
    let loot = { stone: stage + Math.floor(Math.random() * 2) };
    const oreChanceMult = ([0, 0.4, 0.7, 1.0][stage] || 1.0) * techOreBoost;
    if (props && props.ore && Math.random() < props.chance * oreChanceMult) {
      loot[props.ore] = 1 + (stage === 3 ? 1 : 0);
    }
    // Ferrous ore drops from any mine block alongside the regular ore
    if (Math.random() < 0.15 * oreChanceMult) {
      loot.tobarba = (loot.tobarba || 0) + 1;
    }

    if (rock.richness <= 0) {
      // Depleted — remove block
      rock.alive = false;
      rock.mesh.visible = false;
      const idx = this._collisionCircles.indexOf(rock.collision);
      if (idx !== -1) this._collisionCircles.splice(idx, 1);
    } else {
      // Show crack overlays per hit stage
      if (stage >= 1 && rock.crack1) rock.crack1.visible = true;
      if (stage >= 2 && rock.crack2) rock.crack2.visible = true;
    }

    return loot;
  }

  // ── GLB model placement ────────────────────────────────────────────────────
  _placeGLBProps(zoneName) {
    const g = this._glb;
    if (!g) return;

    const add = (model, x, z, scale, rotY = 0) => {
      if (!model) return;
      const m = cloneModel(model, scale);
      m.position.set(x, 0, z);
      m.rotation.y = rotY;
      this.group.add(m);
    };

    switch (zoneName) {
      case 'landingSite':
        // Watchtower near mine path entrance
        add(g.tower, -7, -6, 0.9, Math.PI * 0.75);
        // Supply crates near landing pad
        add(g.crate, 2, 3, 0.55, 0.4);
        add(g.crate, -2, 2, 0.5, 1.1);
        // Ghibli trees scattered around (supplement procedural ones)
        add(g.tree, 6, 10, 0.8, 0.5);
        add(g.tree, -5, 12, 0.9, 2.1);
        add(g.tree, 11, -2, 0.75, 0.9);
        break;

      case 'mine':
        // Fuel barrels near the mine entrance
        add(g.barrel, 3, -14, 0.6, 0.3);
        add(g.barrel, -3, -15, 0.55, 1.8);
        add(g.barrel, 5, -13, 0.5, 0.9);
        // Rock clusters as extra decoration
        add(g.rock, 11, 5, 0.7, 0.2);
        add(g.rock, -11, 3, 0.65, 1.5);
        break;

      case 'verdantMaw':
        // More Ghibli trees in the jungle
        add(g.tree, -3, -8, 1.0, 1.0);
        add(g.tree, 8, 2, 0.85, 2.5);
        add(g.tree, -10, -4, 0.9, 0.7);
        // Supply crate (dropped supplies)
        add(g.crate, 2, -4, 0.5, 0.6);
        break;

      case 'lagoonCoast':
        // Fuel barrels washed ashore
        add(g.barrel, 7, 3, 0.65, 0.5);
        add(g.barrel, -4, -8, 0.6, 2.0);
        // Supply crate on the beach
        add(g.crate, -8, 6, 0.55, 1.3);
        break;

      case 'frozenTundra':
        // Rock clusters half-buried in snow
        add(g.rock, -7, 4, 0.8, 0.4);
        add(g.rock, 9, -6, 0.75, 1.9);
        // Supply crate (abandoned expedition gear)
        add(g.crate, 4, -5, 0.5, 0.8);
        break;

      case 'spaceship':
        // Cyborg PC terminal on the far wall
        add(g.pc, -7, -8, 0.7, 0);
        add(g.pc, 7, -8, 0.7, Math.PI);
        // Fuel barrels in the corner
        add(g.barrel, 8, 8, 0.65, 0.3);
        add(g.barrel, 8.8, 8, 0.65, 1.1);
        // Supply crates stacked near the offload station
        add(g.crate, -3, -6, 0.55, 0.2);
        break;
    }
  }

  getPortals() { return this._zonePortals; }

  getCollisionCircles() { return this._collisionCircles; }

  /** Show or hide all floor grid helpers (called when construction panel opens/closes). */
  setGridVisible(v) {
    for (const g of this._grids) g.visible = v;
  }

  // Returns AABB boxes for alive (not yet mined) grid blocks
  getCollisionBoxes() { return this._collisionBoxes.filter(b => b.rock.alive); }

  /**
   * Rebuild track marker meshes for the current zone from pedometer data.
   * Call after zone switch or after placing a new track.
   */
  refreshTrackMarkers(pedometer) {
    // Clear previous markers
    while (this._trackGroup.children.length > 0) {
      this._trackGroup.remove(this._trackGroup.children[0]);
    }
    const tracks = pedometer.getPlacedTracksForZone(this.currentZone);
    for (const t of tracks) {
      this._addTrackMarker(t.x, t.z);
    }
  }

  _addTrackMarker(x, z) {
    // Single tile matching one background grid cell (GridHelper: GROUND_SIZE / (GROUND_SIZE/2) = 2 units per cell)
    const tileMat = createToonMaterial(0x00ddaa);
    tileMat.transparent = true;
    tileMat.opacity = 0.55;

    const tileGeo = new THREE.PlaneGeometry(2.0, 2.0);
    const tile = new THREE.Mesh(tileGeo, tileMat);
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(x, 0.03, z);
    this._trackGroup.add(tile);

    const borderGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(2.0, 2.0));
    const borderMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.9 });
    const border = new THREE.LineSegments(borderGeo, borderMat);
    border.rotation.x = -Math.PI / 2;
    border.position.set(x, 0.04, z);
    this._trackGroup.add(border);
  }

  getZoneLabel() {
    const labels = {
      landingSite: 'Landing Site',
      mine: 'The Mine',
      verdantMaw: 'Verdant Maw',
      lagoonCoast: 'Lagoon Coast',
      frozenTundra: 'Frozen Tundra',
      spaceship: 'Spaceship Interior',
      workspace: 'Workspace',
      depths: 'The Depths',
    };
    return labels[this.currentZone] || 'Unknown';
  }

  // ── Resource node spawn positions per zone ─────────────────────────────────
  getResourceNodeSpawns() {
    switch (this.currentZone) {
      case 'landingSite': return [
        { x: -6, z: -3, type: 'copper' },
        { x: 10, z: -8, type: 'copper' },  // was (4,-5) — moved away from spaceship portal (4,-3)
        { x: -8, z: 5, type: 'timber' },
        { x: -10, z: 2, type: 'timber' },
        { x: 7, z: 6, type: 'timber' },
        // Stone nodes kept clear of the Mine portal at (-10,-10)
        { x: -16, z: -9, type: 'stone' },
        { x: -9, z: -16, type: 'stone' },
        { x: 3, z: 8, type: 'fiber' },
        { x: -3, z: 10, type: 'fiber' },
        { x: 14, z: -4, type: 'fiber' },  // was (9,-6) — moved away from spaceship portal
      ];
      case 'mine': return [];
      case 'verdantMaw': return [
        { x: 3, z: 4, type: 'timber' },
        { x: -5, z: 6, type: 'timber' },
        { x: 7, z: -3, type: 'fiber' },
        { x: -8, z: 3, type: 'fiber' },
        { x: 4, z: -7, type: 'resin',  requiredTool: 'harvestBlade' },
        { x: -4, z: -5, type: 'silica', requiredTool: 'harvestBlade' },
        { x: 9, z: 6, type: 'quartz',  requiredTool: 'harvestBlade' },
        { x: -10, z: -6, type: 'verdanite', requiredTool: 'harvestBlade' },
        { x: 11, z: -4, type: 'verdanite',  requiredTool: 'harvestBlade' },
      ];
      case 'lagoonCoast': return [
        { x: 5, z: 5, type: 'silica', requiredTool: 'diveTool' },
        { x: -6, z: 4, type: 'silica', requiredTool: 'diveTool' },
        { x: 3, z: -6, type: 'copper' },
        { x: -5, z: -3, type: 'quartz', requiredTool: 'diveTool' },
        { x: 8, z: -2, type: 'iron' },
        { x: -9, z: -5, type: 'basalva' },
        { x: 10, z: 7, type: 'basalva' },
      ];
      case 'frozenTundra': return [
        { x: 4, z: 3, type: 'fractalite', requiredTool: 'cryoPick' },
        { x: -5, z: 5, type: 'fractalite', requiredTool: 'cryoPick' },
        { x: 7, z: -4, type: 'tobarba', requiredTool: 'cryoPick' },
        { x: -8, z: -3, type: 'tobarba', requiredTool: 'cryoPick' },
        { x: 2, z: -7, type: 'orosil' },
        { x: -3, z: 7, type: 'orosil' },
        { x: 9, z: 5, type: 'iron' },
        { x: -6, z: -6, type: 'quartz' },
      ];
      case 'spaceship': return []; // no gatherables inside the ship
      case 'workspace': return []; // no gatherables in the workspace
      case 'depths': return [];   // pure mining zone — no resource nodes
      default: return [];
    }
  }

  // ── Enemy spawn positions per zone (with archetype for variety) ───────────
  getEnemySpawns() {
    switch (this.currentZone) {
      // T1 — Rushers only (safe starter zone)
      case 'landingSite': return [
        { x: 14, z: 10,  archetype: 'rusher' },
        { x: -12, z: 16, archetype: 'rusher' },
      ];
      // T2 — 2 Rushers + 1 Swinger
      case 'mine': return [
        { x: 8,  z: 8,  archetype: 'rusher' },
        { x: -8, z: 6,  archetype: 'rusher' },
        { x: 6,  z: -8, archetype: 'swinger' },
      ];
      // T3 — 2 Rushers + 1 Swinger + 1 Burst
      case 'verdantMaw': return [
        { x: 10,  z: 8,  archetype: 'rusher' },
        { x: -8,  z: 10, archetype: 'rusher' },
        { x: 12,  z: -6, archetype: 'swinger' },
        { x: -10, z: -8, archetype: 'burst' },
      ];
      // T4 — 1 Swinger + 2 Burst (synergy pressure)
      case 'lagoonCoast': return [
        { x: 12, z: 6,  archetype: 'swinger' },
        { x: -10, z: 8, archetype: 'burst' },
        { x: 8, z: -10, archetype: 'burst' },
      ];
      // T5 — 2 Swingers + 2 Bursts
      case 'frozenTundra': return [
        { x: 10, z: 6,  archetype: 'swinger' },
        { x: -10, z: 6, archetype: 'burst' },
        { x: 8, z: -10, archetype: 'burst' },
        { x: -8, z: -8, archetype: 'swinger' },
      ];
      case 'spaceship': return []; // no enemies in the ship
      case 'workspace': return []; // no enemies in the workspace
      case 'depths': return [
        { x: 5,  z: 3,  archetype: 'swinger' },
        { x: -5, z: 3,  archetype: 'swinger' },
        { x: 0,  z: -6, archetype: 'burst'   },
      ];
      default: return [];
    }
  }

  // ── Landing Site ───────────────────────────────────────────────────────────
  _buildLandingSite() {
    this._addGround(0x5a8c3c);
    this._addLandingPad();
    this._addPathToMountain();
    this._addForest();
    this._addMountain();
    this._addRocks();

    // Signpost near the pad pointing to the mine
    this._addSignpost(-3, -3, Math.PI * 0.75, "TO MINE");

    // Portal into the Spaceship (on the landing pad, offset right to avoid hatch overlap)
    this._addPortal(4, -3, 'spaceship', 0, 'Spaceship');
    // Portal to Mine — outside the mountain collision circle (r=9 from -18,-18)
    this._addPortal(-10, -10, 'mine', 0, 'Mine');
  }

  _addSpaceshipHatch() {
    // A raised hatch door on the landing pad indicating the spaceship entrance
    const hatchGroup = new THREE.Group();

    // Hatch floor panel
    const hatchGeo = new THREE.BoxGeometry(1.2, 0.1, 1.6);
    const hatchMat = createToonMaterial(0x556677);
    const hatch = new THREE.Mesh(hatchGeo, hatchMat);
    hatch.position.y = 0.1;
    hatch.castShadow = true;
    addOutline(hatch, 0.04);
    hatchGroup.add(hatch);

    // Cyan glow border strips
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
    const edges = [
      { w: 1.2, x: 0, z: 0.8 }, { w: 1.2, x: 0, z: -0.8 },
    ];
    for (const e of edges) {
      const eGeo = new THREE.BoxGeometry(e.w, 0.05, 0.08);
      const em = new THREE.Mesh(eGeo, glowMat);
      em.position.set(e.x, 0.15, e.z);
      hatchGroup.add(em);
    }

    // Arrow pointing down (entry cue)
    const arrowGeo = new THREE.ConeGeometry(0.18, 0.35, 4);
    const arrowMat = createToonMaterial(0x00ffcc);
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.rotation.z = Math.PI; // point down
    arrow.position.y = 0.9;
    hatchGroup.add(arrow);

    hatchGroup.position.set(0, 0, -3);
    this.group.add(hatchGroup);
  }

  _addGround(color) {
    const geo = new THREE.PlaneGeometry(CONFIG.GROUND_SIZE, CONFIG.GROUND_SIZE);
    const mat = createToonMaterial(color);
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Subtle grid overlay so players can read distances and plan movement
    const grid = new THREE.GridHelper(CONFIG.GROUND_SIZE, CONFIG.GROUND_SIZE / 2, 0x000000, 0x000000);
    // Offset grid by 1 unit so grid lines sit at odd coords (±1, ±3, …)
    // and 2×2 track tiles centred on even coords fill cells exactly.
    grid.position.set(1, 0.01, 1);
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    mats.forEach(m => { m.transparent = true; m.opacity = 0.08; });
    grid.visible = false;
    this.group.add(grid);
    this._grids.push(grid);
  }

  _addLandingPad() {
    const geo = new THREE.CylinderGeometry(
      CONFIG.LANDING_PAD_RADIUS, CONFIG.LANDING_PAD_RADIUS, 0.12, 24
    );
    const mat = createToonMaterial(0x8899aa);
    const pad = new THREE.Mesh(geo, mat);
    pad.position.set(0, 0.06, 0);
    pad.receiveShadow = true;
    pad.castShadow = true;
    this.group.add(pad);

    const markGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.14, 16);
    const markMat = createToonMaterial(0xccddee);
    const mark = new THREE.Mesh(markGeo, markMat);
    mark.position.set(0, 0.07, 0);
    this.group.add(mark);
  }

  /**
   * Dirt/stone path running southwest from the landing pad toward the
   * mountain / mine portal at (-10, -10). Creates a long dirt plane plus a
   * scattering of stone tiles along the route.
   */
  _addPathToMountain() {
    // Path endpoints
    const endX = -10;
    const endZ = -10;
    const len = Math.hypot(endX, endZ); // ≈ 18.38
    const angle = Math.atan2(endX, endZ); // world-angle for the southwest diagonal

    // Main dirt strip
    const stripGeo = new THREE.PlaneGeometry(1.6, len);
    const stripMat = createToonMaterial(0x8a7d6b);
    const strip = new THREE.Mesh(stripGeo, stripMat);
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = -angle; // align plane's +Y axis with the path direction
    strip.position.set(endX / 2, 0.02, endZ / 2);
    strip.receiveShadow = true;
    this.group.add(strip);

    // Stepping stones scattered along the path (reproducible jitter)
    const tileMat = createToonMaterial(0x9a9a9a);
    for (let i = 1; i <= 8; i++) {
      const t = i / 9;
      const jx = (Math.sin(i * 2.7) * 0.22);
      const jz = (Math.cos(i * 1.9) * 0.22);
      const tileGeo = new THREE.BoxGeometry(0.45, 0.08, 0.45);
      const tile = new THREE.Mesh(tileGeo, tileMat);
      tile.position.set(endX * t + jx, 0.05, endZ * t + jz);
      tile.rotation.y = i * 0.4;
      tile.receiveShadow = true;
      tile.castShadow = true;
      this.group.add(tile);
    }
  }

  _addForest() {
    const rng = seededRandom(12345); // deterministic layout
    const r = CONFIG.FOREST_RADIUS;
    const count = CONFIG.TREE_COUNT;

    const pathAngle = -3 * Math.PI / 4;
    const gapHalfWidth = Math.PI * 0.12;

    // Portal positions on Landing Site — keep trees away from these
    const portalPositions = [
      { x: 4, z: -3 },     // Spaceship
      { x: -10, z: -10 },  // Mine
      { x: 0, z: 20 },     // Verdant Maw
      { x: 20, z: 0 },     // Lagoon Coast
      { x: 0, z: -20 },    // Frozen Tundra
    ];
    const MIN_PORTAL_DIST = 3.5;

    const _tooCloseToPortal = (tx, tz) =>
      portalPositions.some(p => Math.hypot(tx - p.x, tz - p.z) < MIN_PORTAL_DIST);

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI;
      let d = Math.abs(angle - pathAngle);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < gapHalfWidth) continue;

      const x = Math.cos(angle) * (r + rng() * 3 - 1.5);
      const z = Math.sin(angle) * (r + rng() * 3 - 1.5);
      if (_tooCloseToPortal(x, z)) continue;
      if (this._tooCloseToTree(x, z)) continue;
      this._addTree(x, z, rng);
    }

    const pathDX = -10, pathDZ = -10;
    const pathLenSq = pathDX * pathDX + pathDZ * pathDZ;
    for (let i = 0; i < 14; i++) {
      const x = -8 + rng() * 16;
      const z = -8 + rng() * 16;
      if (Math.hypot(x, z) < CONFIG.LANDING_PAD_RADIUS + 1.2) continue;
      if (_tooCloseToPortal(x, z)) continue;
      const t = Math.max(0, Math.min(1, (x * pathDX + z * pathDZ) / pathLenSq));
      const px = pathDX * t, pz = pathDZ * t;
      if (Math.hypot(x - px, z - pz) < 1.3) continue;
      if (this._tooCloseToTree(x, z)) continue;
      this._addTree(x, z, rng);
    }
  }

  // Returns true if (x,z) is too close to any already-placed tree
  _tooCloseToTree(x, z, minSpacing = 1.3) {
    return this._treePlacedPositions.some(p => Math.hypot(x - p.x, z - p.z) < minSpacing);
  }

  _addTree(x, z, rng) {
    const rand = rng || Math.random;
    this._treePlacedPositions.push({ x, z });
    const treeGroup = new THREE.Group();
    const h = 1.4 + rand() * 0.8;
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.22, h, 6);
    const trunkMat = createToonMaterial(0x6b4226);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = h / 2;
    trunk.castShadow = true;
    treeGroup.add(trunk);

    const crownColors = [0x2d6a2d, 0x3a8c3a, 0x245224];
    const crownColor = crownColors[Math.floor(rand() * crownColors.length)];
    const crownMat = createToonMaterial(crownColor);
    const crownH = 1.8 + rand() * 0.6;
    const crown1Geo = new THREE.ConeGeometry(0.9, crownH, 7);
    const crown1 = new THREE.Mesh(crown1Geo, crownMat);
    crown1.position.y = h + crownH * 0.4;
    crown1.castShadow = true;
    treeGroup.add(crown1);

    const crown2Geo = new THREE.ConeGeometry(0.65, crownH * 0.7, 7);
    const crown2 = new THREE.Mesh(crown2Geo, crownMat);
    crown2.position.y = h + crownH * 0.85;
    treeGroup.add(crown2);

    treeGroup.position.set(x, 0, z);
    treeGroup.rotation.y = rand() * Math.PI * 2;
    addOutlineToGroup(treeGroup, 0.035);
    this.group.add(treeGroup);
    const collision = { x, z, r: 0.55 };
    this._collisionCircles.push(collision);
    this._trees.push({ group: treeGroup, x, z, alive: true, collision, _harvestReady: true, _harvestTimer: 0 });
  }

  _addMountain() {
    const { x, z } = CONFIG.MOUNTAIN_POS;
    const group = new THREE.Group();
    const peakGeo = new THREE.ConeGeometry(7, 14, 8);
    const peakMat = createToonMaterial(0x8899aa);
    const peak = new THREE.Mesh(peakGeo, peakMat);
    peak.position.y = 7;
    peak.castShadow = true;
    group.add(peak);

    const snowGeo = new THREE.ConeGeometry(2.2, 3.5, 8);
    const snowMat = createToonMaterial(0xeeeeff);
    const snow = new THREE.Mesh(snowGeo, snowMat);
    snow.position.y = 13.5;
    group.add(snow);

    const hillGeo = new THREE.ConeGeometry(9, 5, 8);
    const hillMat = createToonMaterial(0x6d7d88);
    const hill = new THREE.Mesh(hillGeo, hillMat);
    hill.position.y = 2.5;
    group.add(hill);

    group.position.set(x, 0, z);
    addOutlineToGroup(group, 0.03);
    this.group.add(group);
    this._collisionCircles.push({ x, z, r: 9 });
  }

  /**
   * Dark cave entrance at the base of the mountain, facing the landing pad.
   * Consists of a hollow stone arch (open-ended cylinder) with a pitch-dark
   * interior disk and two flanking stone pillars.
   */
  _addCaveEntrance(mountainX, mountainZ) {
    // Direction from the mountain center toward the origin (pad), normalized.
    const dx = -mountainX;
    const dz = -mountainZ;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len;
    const nz = dz / len;

    // Place the cave mouth just outside the hill base (hill radius ≈ 9).
    // Pulled closer to mountain so it doesn't overlap the Mine portal ring.
    const mouthR = 5.5;
    const cx = mountainX + nx * mouthR;
    const cz = mountainZ + nz * mouthR;

    // Orient so the cylinder's length axis points toward the pad.
    const yaw = Math.atan2(nx, nz);

    const caveGroup = new THREE.Group();

    // Hollow stone archway (open-ended cylinder rotated on its side)
    const archGeo = new THREE.CylinderGeometry(1.4, 1.4, 3.2, 14, 1, true);
    const archMat = createToonMaterial(0x4a4a55);
    archMat.side = THREE.DoubleSide;
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.rotation.z = Math.PI / 2; // lay the cylinder on its side (axis → X)
    arch.position.y = 1.4;
    arch.castShadow = true;
    arch.receiveShadow = true;
    caveGroup.add(arch);
    addOutline(arch, 0.03);

    // Pitch-dark interior disk sealing the back of the tunnel (no outline).
    const darkGeo = new THREE.CircleGeometry(1.28, 18);
    const darkMat = new THREE.MeshBasicMaterial({
      color: 0x050505,
      side: THREE.DoubleSide,
    });
    const dark = new THREE.Mesh(darkGeo, darkMat);
    dark.rotation.y = Math.PI / 2;
    dark.position.set(-1.2, 1.4, 0); // set back into the mountain (local -X)
    caveGroup.add(dark);

    // Flanking stone pillars
    const pillarMat = createToonMaterial(0x6d7d88);
    for (const side of [-1, 1]) {
      const pillarGeo = new THREE.BoxGeometry(0.55, 2.4, 0.55);
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(0.15, 1.2, side * 1.75);
      pillar.castShadow = true;
      caveGroup.add(pillar);
      addOutline(pillar, 0.04);
    }

    // Lintel across the top
    const lintelGeo = new THREE.BoxGeometry(0.9, 0.35, 3.8);
    const lintel = new THREE.Mesh(lintelGeo, pillarMat);
    lintel.position.set(0.15, 2.55, 0);
    lintel.castShadow = true;
    caveGroup.add(lintel);
    addOutline(lintel, 0.04);

    caveGroup.position.set(cx, 0, cz);
    caveGroup.rotation.y = yaw;
    this.group.add(caveGroup);
  }

  _addRocks() {
    const rng = seededRandom(67890); // deterministic rock sizes/rotations
    const positions = [[5, 7], [-4, 9], [8, -3], [-9, 4], [3, -8]];
    for (const [x, z] of positions) {
      const geo = new THREE.DodecahedronGeometry(0.4 + rng() * 0.3, 0);
      const mat = createToonMaterial(0x888888);
      const rock = new THREE.Mesh(geo, mat);
      rock.position.set(x, 0.3, z);
      rock.rotation.y = rng() * Math.PI;
      rock.castShadow = true;
      addOutline(rock, 0.08);
      this.group.add(rock);
      const collision = { x, z, r: 0.7 };
      this._collisionCircles.push(collision);
      this._rocks.push({ mesh: rock, x, z, alive: true, collision, richness: 3, maxRichness: 3 });
    }
  }

  _addSignpost(x, z, rotY, label) {
    const group = new THREE.Group();
    
    // Post
    const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6);
    const postMat = createToonMaterial(0x5a4a3a);
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.y = 0.6;
    group.add(post);

    // Board
    const boardGeo = new THREE.BoxGeometry(0.8, 0.4, 0.1);
    const boardMat = createToonMaterial(0x6b5a4a);
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.position.y = 1.0;
    group.add(board);

    group.position.set(x, 0, z);
    group.rotation.y = rotY;
    addOutlineToGroup(group, 0.03);
    this.group.add(group);
  }

  _addPortal(x, z, targetZone, ppRequired, label) {
    const group = new THREE.Group();

    // Glowing ring — color set dynamically via refreshPortalAccess()
    const ringGeo = new THREE.TorusGeometry(1.2, 0.15, 8, 16);
    const ringMat = createToonMaterial(0xff8800);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.5;
    group.add(ring);

    // Inner glow
    const innerGeo = new THREE.CircleGeometry(1.0, 16);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x332200,
      transparent: true,
      opacity: 0.6,
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.rotation.x = Math.PI / 2;
    inner.position.y = 1.5;
    group.add(inner);

    // Base pillar
    const pillarGeo = new THREE.CylinderGeometry(0.2, 0.3, 0.5, 8);
    const pillarMat = createToonMaterial(0x556666);
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.y = 0.25;
    group.add(pillar);

    group.position.set(x, 0, z);
    addOutlineToGroup(group, 0.04);
    this.group.add(group);

    // Block player from walking into the portal hole
    this._collisionCircles.push({ x, z, r: 0.9 });

    this._zonePortals.push({
      position: new THREE.Vector3(x, 0, z),
      targetZone,
      ppRequired,
      label,
      mesh: group,
      ringMat,
      innerMat,
    });
  }

  /**
   * Update each portal's ring color based on whether it's currently accessible.
   * isAccessibleFn(portal) → boolean. Free portals (ppRequired===0) are always green.
   */
  refreshPortalAccess(isAccessibleFn) {
    for (const portal of this._zonePortals) {
      const accessible = portal.ppRequired === 0 || isAccessibleFn(portal);
      if (portal.ringMat) portal.ringMat.color.setHex(accessible ? 0x00ffcc : 0xff8800);
      if (portal.innerMat) portal.innerMat.color.setHex(accessible ? 0x004433 : 0x332200);
    }
  }

  // ── Crack overlay helper ───────────────────────────────────────────────────
  // Returns { crack1, crack2 } Groups added as children of mesh.
  // crack1 = horizontal crack (stage 1), crack2 = vertical crack (stage 2).
  _makeCrackStages(mesh, bw, bh, bd) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x080808 });
    const T = 0.07; // crack thickness

    const crack1 = new THREE.Group();
    const y1 = bh * 0.12;
    for (const [zs, xs] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const isZ = zs !== 0;
      const g = isZ
        ? new THREE.BoxGeometry(bw * 0.85, T, T)
        : new THREE.BoxGeometry(T, T, bd * 0.85);
      const m = new THREE.Mesh(g, mat);
      m.position.set(xs * (bw / 2 + 0.02), y1, zs * (bd / 2 + 0.02));
      crack1.add(m);
    }
    crack1.visible = false;
    mesh.add(crack1);

    const crack2 = new THREE.Group();
    const y2 = -bh * 0.1;
    const xOff = bw * 0.18;
    for (const [zs, xs] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const isZ = zs !== 0;
      const g = isZ
        ? new THREE.BoxGeometry(T, bh * 0.65, T)
        : new THREE.BoxGeometry(T, bh * 0.65, T);
      const m = new THREE.Mesh(g, mat);
      m.position.set(
        isZ ? xOff : xs * (bw / 2 + 0.02),
        y2,
        isZ ? zs * (bd / 2 + 0.02) : xOff
      );
      crack2.add(m);
    }
    crack2.visible = false;
    mesh.add(crack2);

    return { crack1, crack2 };
  }

  // ── Mine zone ──────────────────────────────────────────────────────────────
  _buildMine() {
    this._addGround(0x0c0a08); // near-black cave floor
    const rng = seededRandom(54321);




    // ── Mine blocks with ore vein overlays ─────────────────────────────────
    // One reveal material per tier color so all blocks of the same ore type share
    // the same shader uniforms — only 5 uniform updates needed per frame.
    const blocks = getMineableWallBlocks();
    const _tierMats = {};
    for (const b of blocks) {
      if (!_tierMats[b.props.color]) {
        const m = createRevealToonMaterial(b.props.color);
        _tierMats[b.props.color] = m;
        this._revealMaterials.push(m);
      }
    }

    for (const b of blocks) {
      const bw = 3.2;
      const bh = 3.5 + rng() * 4.0; // 3.5–7.5m — more dramatic height variance
      const bd = 3.2;
      const geo = new THREE.BoxGeometry(bw, bh, bd);
      const mat = _tierMats[b.props.color];
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.x, bh / 2, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      addOutline(mesh, 0.04);


      this.group.add(mesh);
      const { crack1, crack2 } = this._makeCrackStages(mesh, bw, bh, bd);
      const rock = { mesh, x: b.x, z: b.z, alive: true, props: b.props, richness: 3, maxRichness: 3, crack1, crack2 };
      this._rocks.push(rock);
      this._collisionBoxes.push({ minX: b.x - bw / 2, maxX: b.x + bw / 2, minZ: b.z - bd / 2, maxZ: b.z + bd / 2, rock });

    }


    this._buildMineTunnels();

    const mp = MINE_ZONE_PORTALS;
    this._addPortal(mp.landingSite.x,  mp.landingSite.z,  'landingSite',  0,                              'Landing Site');
    this._addReturnBeacon(mp.landingSite.x, mp.landingSite.z);
    this._addPortal(mp.depths.x,       mp.depths.z,       'depths',       CONFIG.ENV_UNLOCK.depths,       'The Depths');
    this._addPortal(mp.frozenTundra.x, mp.frozenTundra.z, 'frozenTundra', CONFIG.ENV_UNLOCK.frozenTundra, 'Frozen Tundra');
    this._addPortal(mp.verdantMaw.x,   mp.verdantMaw.z,   'verdantMaw',   CONFIG.ENV_UNLOCK.verdantMaw,   'Verdant Maw');
    this._addPortal(mp.lagoonCoast.x,  mp.lagoonCoast.z,  'lagoonCoast',  CONFIG.ENV_UNLOCK.lagoonCoast,  'Lagoon Coast');
    this._buildDrillRig(0, 0);
  }

  _buildMineTunnels() {
    const S         = 3.2;
    const EDGE      = 16;
    const STEPS     = 7;   // walled blocks per tunnel before chamber opens
    const FLOOR_LEN = STEPS * S + 14; // floor patch length (covers chamber + margin)

    const wallMat  = createToonMaterial(0x181410);
    const floorMat = createToonMaterial(0x0d0b09);
    const rng      = seededRandom(77777);

    // Each tunnel: axis of travel, direction sign, half-width of walled corridor.
    // North is wider to hold two portals side-by-side.
    const tunnels = [
      { axis: 'z', sign: -1, halfW: 6.4 }, // south → Landing Site
      { axis: 'z', sign: +1, halfW: 9.6 }, // north → Depths + Frozen Tundra
      { axis: 'x', sign: +1, halfW: 6.4 }, // east  → Verdant Maw
      { axis: 'x', sign: -1, halfW: 6.4 }, // west  → Lagoon Coast
    ];

    for (const { axis, sign, halfW } of tunnels) {
      const isZ     = axis === 'z';
      const floorW  = halfW * 2 + S;
      const floorCx = isZ ? 0          : sign * (EDGE + FLOOR_LEN / 2);
      const floorCz = isZ ? sign * (EDGE + FLOOR_LEN / 2) : 0;

      // Extended floor tile so cave floor shows beneath the tunnel
      const floorGeo = isZ
        ? new THREE.PlaneGeometry(floorW, FLOOR_LEN)
        : new THREE.PlaneGeometry(FLOOR_LEN, floorW);
      const floorMesh = new THREE.Mesh(floorGeo, floorMat);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.set(floorCx, 0.01, floorCz);
      this.group.add(floorMesh);

      // Wall blocks on both sides of the corridor
      for (let i = 1; i <= STEPS; i++) {
        const mainCoord = sign * (EDGE + i * S);
        for (const side of [-halfW, +halfW]) {
          const h  = 3.5 + rng() * 4.0;
          const bx = isZ ? side      : mainCoord;
          const bz = isZ ? mainCoord : side;
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(3.2, h, 3.2), wallMat);
          mesh.position.set(bx, h / 2, bz);
          addOutline(mesh, 0.04);
          this.group.add(mesh);
          this._collisionCircles.push({ x: bx, z: bz, r: 2.0 });
        }
      }
    }
  }

  _buildDrillRig(x, z) {
    this._drillPos = { x, z };
    const rigGroup = new THREE.Group();
    rigGroup.position.set(x, 0, z);

    // Octagonal base platform
    const baseGeo = new THREE.CylinderGeometry(2.4, 2.6, 0.5, 8);
    const baseMat = createToonMaterial(0x252525);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.25;
    addOutline(base, 0.04);
    rigGroup.add(base);

    // Hazard stripe ring around base
    const hazardGeo = new THREE.TorusGeometry(2.45, 0.09, 6, 8);
    const hazardMat = createToonMaterial(0xffcc00);
    const hazard = new THREE.Mesh(hazardGeo, hazardMat);
    hazard.rotation.x = Math.PI / 2;
    hazard.position.y = 0.52;
    rigGroup.add(hazard);

    // 4 main structural pillars at 45° offset
    const pillarMat = createToonMaterial(0x1e1e1e);
    const pillarAngles = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4];
    for (const angle of pillarAngles) {
      const pGeo = new THREE.BoxGeometry(0.26, 5.2, 0.26);
      const pillar = new THREE.Mesh(pGeo, pillarMat);
      pillar.position.set(Math.cos(angle) * 1.9, 2.85, Math.sin(angle) * 1.9);
      addOutline(pillar, 0.03);
      rigGroup.add(pillar);
    }

    // Cross-beams at two heights
    const beamMat = createToonMaterial(0x303030);
    for (const beamY of [1.5, 3.6]) {
      const bGeoX = new THREE.BoxGeometry(3.8, 0.18, 0.18);
      const bGeoZ = new THREE.BoxGeometry(0.18, 0.18, 3.8);
      const bx = new THREE.Mesh(bGeoX, beamMat);
      const bz = new THREE.Mesh(bGeoZ, beamMat);
      bx.position.y = beamY;
      bz.position.y = beamY;
      rigGroup.add(bx);
      rigGroup.add(bz);
    }

    // Crown frame at top — four box beams forming a square
    const crownY = 5.2;
    const crownMat = createToonMaterial(0x2a2a2a);
    for (let i = 0; i < 4; i++) {
      const cGeo = i % 2 === 0
        ? new THREE.BoxGeometry(3.8, 0.22, 0.22)
        : new THREE.BoxGeometry(0.22, 0.22, 3.8);
      const cBeam = new THREE.Mesh(cGeo, crownMat);
      cBeam.position.y = crownY;
      addOutline(cBeam, 0.025);
      rigGroup.add(cBeam);
    }

    // Machinery housing on crown
    const houseGeo = new THREE.BoxGeometry(1.7, 0.75, 1.7);
    const houseMat = createToonMaterial(0x363636);
    const house = new THREE.Mesh(houseGeo, houseMat);
    house.position.y = crownY + 0.475;
    addOutline(house, 0.04);
    rigGroup.add(house);

    // Drill shaft — long cylinder from crown base down to bit
    const shaftGeo = new THREE.CylinderGeometry(0.17, 0.17, 3.5, 8);
    const shaftMat = createToonMaterial(0x4a4a4a);
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.y = 3.25; // center: top=5.0, bottom=1.5
    addOutline(shaft, 0.03);
    rigGroup.add(shaft);

    // Drill bit — wide cone tapering to narrow tip
    const bitMat = createToonMaterial(0xddbb44);
    const bit1Geo = new THREE.ConeGeometry(0.48, 1.2, 8);
    const bit1 = new THREE.Mesh(bit1Geo, bitMat);
    bit1.rotation.x = Math.PI; // tip down; base at +y
    bit1.position.y = 0.9;    // base at 1.5, tip at 0.3
    addOutline(bit1, 0.04);
    rigGroup.add(bit1);

    const bit2Geo = new THREE.ConeGeometry(0.2, 0.55, 8);
    const bit2 = new THREE.Mesh(bit2Geo, bitMat);
    bit2.rotation.x = Math.PI;
    bit2.position.y = 0.025;  // base at 0.3, tip at -0.25 (into ground)
    rigGroup.add(bit2);

    // Warning lights on pillars (red, MeshBasicMaterial for full brightness)
    const warnMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    for (const angle of pillarAngles) {
      const wGeo = new THREE.SphereGeometry(0.11, 6, 6);
      const warn = new THREE.Mesh(wGeo, warnMat);
      warn.position.set(Math.cos(angle) * 1.9, 4.0, Math.sin(angle) * 1.9);
      rigGroup.add(warn);
    }

    // Interaction indicator — glowing orange orb above crown
    const indGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const indMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    const indicator = new THREE.Mesh(indGeo, indMat);
    indicator.position.y = crownY + 1.3;
    rigGroup.add(indicator);

    this.group.add(rigGroup);
    this._collisionCircles.push({ x, z, r: 1.2 });
  }

  getDrillPos() { return this._drillPos; }

  // Updates the player-position uniform on all reveal materials (mine blocks).
  // Call every frame when in the mine zone.
  updateReveal(playerPos) {
    for (const mat of this._revealMaterials) {
      if (mat.userData.shader) {
        mat.userData.shader.uniforms.uPlayerPos.value.copy(playerPos);
      }
    }
  }

  // ── The Depths sub-zone ────────────────────────────────────────────────────
  _buildDepths() {
    // Dark cave floor — rectangular to match grid
    const floorGeo = new THREE.PlaneGeometry(24, 24);
    const floorMat = createToonMaterial(0x0a0a0f);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Glowing crystal clusters for ambience (decorative)
    const crystalMat = new THREE.MeshBasicMaterial({ color: 0x3333cc });
    const crystalPositions = [[-8,-8],[-8,8],[8,-8],[8,8],[0,-10],[0,10],[-10,0],[10,0]];
    for (const [cx, cz] of crystalPositions) {
      const geo = new THREE.OctahedronGeometry(0.3, 0);
      const m = new THREE.Mesh(geo, crystalMat);
      m.position.set(cx, 0.5, cz);
      this.group.add(m);
    }

    // Grid layout: 7×7 at 3m spacing, range ±9m
    const rng = seededRandom(99999);
    const spacing = 3, half = 3;
    const depthProps = [
      { tier: 5, ore: 'fractalite', chance: 0.35, cost: 20, duration: 8.0,  color: 0x1a1a2a },
      { tier: 6, ore: 'tobarba',   chance: 0.40, cost: 30, duration: 12.0, color: 0x0f0f1a },
    ];

    for (let gi = -half; gi <= half; gi++) {
      for (let gj = -half; gj <= half; gj++) {
        const bx = gi * spacing;
        const bz = gj * spacing;

        // Portal corridor — keep south passage clear
        if (bz < -4 && Math.abs(bx) < 4) continue;

        // Keep centre open for player and enemies
        if (gi === 0 && gj === 0) continue;

        const isBorder = (Math.abs(gi) === half || Math.abs(gj) === half);
        if (!isBorder && rng() > 0.60) continue; // inner: 40% density

        const props = isBorder ? depthProps[1] : depthProps[0];
        const bw = 3.0; // fixed — matches 3m spacing so blocks touch
        const bh = 5.0 + rng() * 2.0;
        const bd = 3.0;
        const geo = new THREE.BoxGeometry(bw, bh, bd);
        const mat = createToonMaterial(props.color);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(bx, bh / 2, bz);
        mesh.rotation.y = 0;
        mesh.castShadow = true;
        this.group.add(mesh);

        const { crack1, crack2 } = this._makeCrackStages(mesh, bw, bh, bd);
        const rock = { mesh, x: bx, z: bz, alive: true, props, richness: 3, maxRichness: 3, crack1, crack2 };
        this._rocks.push(rock);
        this._collisionBoxes.push({ minX: bx - bw / 2, maxX: bx + bw / 2, minZ: bz - bd / 2, maxZ: bz + bd / 2, rock });
      }
    }

    // Return portal to Mine
    this._addPortal(0, -6, 'mine', 0, 'Return to Mine');
    this._addReturnBeacon(0, -6);
  }

  // ── Verdant Maw zone ──────────────────────────────────────────────────────
  _buildVerdantMaw() {
    this._addGround(0x2a5a1a);

    // Dense jungle canopy
    for (let i = 0; i < 30; i++) {
      const x = (Math.random() - 0.5) * 35;
      const z = (Math.random() - 0.5) * 35;
      if (Math.abs(x) < 4 && Math.abs(z) < 4) continue; // clear center
      if (Math.hypot(x - 0, z - 17) < 3) continue; // keep south portal clear
      if (this._tooCloseToTree(x, z, 1.4)) continue;
      this._addJungleTree(x, z);
    }

    // Vines
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.CylinderGeometry(0.03, 0.03, 3, 4);
      const mat = createToonMaterial(0x336633);
      const vine = new THREE.Mesh(geo, mat);
      vine.position.set(
        (Math.random() - 0.5) * 20,
        1.5,
        (Math.random() - 0.5) * 20
      );
      vine.rotation.z = Math.random() * 0.3 - 0.15;
      this.group.add(vine);
    }

    this._addPortal(0, 17, 'landingSite', 0, 'Landing Site');
    this._addReturnBeacon(0, 17);
  }

  _addJungleTree(x, z) {
    this._treePlacedPositions.push({ x, z });
    const treeGroup = new THREE.Group();
    const h = 2.5 + Math.random() * 1.5;
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, h, 6);
    const trunkMat = createToonMaterial(0x4a3520);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = h / 2;
    trunk.castShadow = true;
    treeGroup.add(trunk);

    const crownGeo = new THREE.SphereGeometry(1.2 + Math.random() * 0.5, 8, 6);
    const crownMat = createToonMaterial(0x1a4a1a);
    const crown = new THREE.Mesh(crownGeo, crownMat);
    crown.position.y = h + 0.5;
    crown.castShadow = true;
    treeGroup.add(crown);

    treeGroup.position.set(x, 0, z);
    this.group.add(treeGroup);
    this._collisionCircles.push({ x, z, r: 0.6 });
  }

  // ── Lagoon Coast zone ──────────────────────────────────────────────────────
  _buildLagoonCoast() {
    this._addGround(0xc2b280); // sand
    const rng = seededRandom(88888); // deterministic layout

    // Water areas — positions stored to exclude tree placement
    const waterCircles = [];
    for (let i = 0; i < 6; i++) {
      const r = 3 + rng() * 4;
      const wx = (rng() - 0.5) * 30;
      const wz = (rng() - 0.5) * 30;
      waterCircles.push({ x: wx, z: wz, r });
      const geo = new THREE.CircleGeometry(r, 16);
      const mat = createToonMaterial(0x2277aa);
      mat.transparent = true;
      mat.opacity = 0.7;
      const water = new THREE.Mesh(geo, mat);
      water.rotation.x = -Math.PI / 2;
      water.position.set(wx, 0.02, wz);
      this.group.add(water);
    }

    // Palm trees — skip positions inside water circles
    for (let i = 0; i < 10; i++) {
      const x = (rng() - 0.5) * 30;
      const z = (rng() - 0.5) * 30;
      if (Math.abs(x) < 3 && Math.abs(z) < 3) continue;
      if (Math.hypot(x - 0, z - (-18)) < 3) continue; // keep portal clear
      if (waterCircles.some(w => Math.hypot(x - w.x, z - w.z) < w.r + 1.0)) continue;
      if (this._tooCloseToTree(x, z, 1.0)) continue;
      this._addPalmTree(x, z);
    }

    // Rocky islands
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.CylinderGeometry(1.5, 2, 0.8, 8);
      const mat = createToonMaterial(0x887766);
      const island = new THREE.Mesh(geo, mat);
      island.position.set(
        8 + (rng() - 0.5) * 10,
        0.4,
        (rng() - 0.5) * 15
      );
      island.castShadow = true;
      this.group.add(island);
    }

    this._addPortal(0, -18, 'landingSite', 0, 'Landing Site');
    this._addReturnBeacon(0, -18);
  }

  _addPalmTree(x, z) {
    this._treePlacedPositions.push({ x, z });
    const treeGroup = new THREE.Group();
    const h = 2 + Math.random() * 1;
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, h, 6);
    const trunkMat = createToonMaterial(0x8b6914);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = h / 2;
    trunk.rotation.z = Math.random() * 0.2 - 0.1;
    trunk.castShadow = true;
    treeGroup.add(trunk);

    // Fan leaves
    for (let i = 0; i < 5; i++) {
      const leafGeo = new THREE.ConeGeometry(0.8, 1.5, 4);
      const leafMat = createToonMaterial(0x228833);
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.y = h + 0.2;
      leaf.rotation.z = Math.PI / 4;
      leaf.rotation.y = (i / 5) * Math.PI * 2;
      treeGroup.add(leaf);
    }

    treeGroup.position.set(x, 0, z);
    this.group.add(treeGroup);
    this._collisionCircles.push({ x, z, r: 0.4 });
  }

  // ── Frozen Tundra zone ─────────────────────────────────────────────────────
  _buildFrozenTundra() {
    this._addGround(0xdce8f0); // pale icy blue-white

    // Snow drifts — flat rounded mounds
    for (let i = 0; i < 12; i++) {
      const w = 2 + Math.random() * 3;
      const d = 1.5 + Math.random() * 2;
      const geo = new THREE.CylinderGeometry(w, w * 1.1, 0.4, 10);
      const mat = createToonMaterial(0xeef4ff);
      const drift = new THREE.Mesh(geo, mat);
      drift.position.set(
        (Math.random() - 0.5) * 35,
        0.2,
        (Math.random() - 0.5) * 35
      );
      drift.scale.z = d / w;
      drift.rotation.y = Math.random() * Math.PI;
      drift.receiveShadow = true;
      this.group.add(drift);
    }

    // Dead bare trees (skeletal, no leaves)
    for (let i = 0; i < 14; i++) {
      const x = (Math.random() - 0.5) * 32;
      const z = (Math.random() - 0.5) * 32;
      if (Math.abs(x) < 4 && Math.abs(z) < 4) continue;
      if (Math.hypot(x - 0, z - (-18)) < 3) continue; // keep portal clear
      if (this._tooCloseToTree(x, z, 0.9)) continue;
      this._addDeadTree(x, z);
    }

    // Ice formations — jagged vertical spikes
    for (let i = 0; i < 8; i++) {
      const spikeGroup = new THREE.Group();
      const count = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < count; j++) {
        const h = 0.8 + Math.random() * 1.4;
        const geo = new THREE.ConeGeometry(0.18, h, 5);
        const mat = createToonMaterial(0xa8d8f0);
        const spike = new THREE.Mesh(geo, mat);
        spike.position.set((j - count / 2) * 0.35, h / 2, 0);
        spike.rotation.z = (Math.random() - 0.5) * 0.3;
        spike.castShadow = true;
        addOutline(spike, 0.04);
        spikeGroup.add(spike);
      }
      spikeGroup.position.set(
        (Math.random() - 0.5) * 30,
        0,
        (Math.random() - 0.5) * 30
      );
      spikeGroup.rotation.y = Math.random() * Math.PI;
      this.group.add(spikeGroup);
    }

    // Frozen lake (flat transparent disc)
    const lakeGeo = new THREE.CircleGeometry(6, 20);
    const lakeMat = createToonMaterial(0x7ab8d4);
    lakeMat.transparent = true;
    lakeMat.opacity = 0.6;
    const lake = new THREE.Mesh(lakeGeo, lakeMat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(8, 0.01, 8);
    this.group.add(lake);

    // Crack lines on the lake (thin dark strips)
    for (let i = 0; i < 4; i++) {
      const crackGeo = new THREE.PlaneGeometry(0.08, 4 + Math.random() * 3);
      const crackMat = new THREE.MeshBasicMaterial({ color: 0x4488aa });
      const crack = new THREE.Mesh(crackGeo, crackMat);
      crack.rotation.x = -Math.PI / 2;
      crack.rotation.z = Math.random() * Math.PI;
      crack.position.set(8 + (Math.random() - 0.5) * 8, 0.02, 8 + (Math.random() - 0.5) * 8);
      this.group.add(crack);
    }

    // Portal back to Landing Site
    this._addPortal(0, -18, 'landingSite', 0, 'Landing Site');
    this._addReturnBeacon(0, -18);
  }

  _addDeadTree(x, z) {
    this._treePlacedPositions.push({ x, z });
    const treeGroup = new THREE.Group();
    const h = 2 + Math.random() * 1.5;
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, h, 6);
    const trunkMat = createToonMaterial(0x4a3830);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = h / 2;
    trunk.castShadow = true;
    addOutline(trunk, 0.04);
    treeGroup.add(trunk);

    // Two bare branches
    const branchMat = createToonMaterial(0x4a3830);
    for (let s of [-1, 1]) {
      const bh = 0.6 + Math.random() * 0.5;
      const bGeo = new THREE.CylinderGeometry(0.05, 0.08, bh, 5);
      const branch = new THREE.Mesh(bGeo, branchMat);
      branch.position.set(s * 0.4, h * 0.75, 0);
      branch.rotation.z = s * (Math.PI / 4 + Math.random() * 0.2);
      branch.castShadow = true;
      treeGroup.add(branch);
    }

    // Light snow cap on top of trunk
    const snowCapGeo = new THREE.SphereGeometry(0.16, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    const snowCapMat = createToonMaterial(0xeef4ff);
    const snowCap = new THREE.Mesh(snowCapGeo, snowCapMat);
    snowCap.position.y = h;
    treeGroup.add(snowCap);

    treeGroup.position.set(x, 0, z);
    treeGroup.rotation.y = Math.random() * Math.PI * 2;
    this.group.add(treeGroup);
    this._collisionCircles.push({ x, z, r: 0.35 });
  }

  // ── Spaceship Interior ─────────────────────────────────────────────────────
  _buildSpaceship() {
    // Dark metal floor
    const floorGeo = new THREE.PlaneGeometry(22, 22);
    const floorMat = createToonMaterial(0x1a1a2e);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Subtle grid on floor
    const grid = new THREE.GridHelper(22, 11, 0x00ffcc, 0x00ffcc);
    grid.position.y = 0.01;
    const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMats.forEach(m => { m.transparent = true; m.opacity = 0.12; });
    grid.visible = false;
    this.group.add(grid);
    this._grids.push(grid);

    // Solid perimeter collision — dense ring of overlapping circles along all 4 walls.
    // North wall has a 4-unit gap centered at x=0 for the Workspace hatch.
    for (let wx = -11; wx <= 11; wx += 2) {
      if (wx !== -1 && wx !== 1) {
        this._collisionCircles.push({ x: wx, z: -11, r: 1.2 }); // north wall
      }
      this._collisionCircles.push({ x: wx, z:  11, r: 1.2 }); // south wall
    }
    for (let wz = -9; wz <= 9; wz += 2) {
      this._collisionCircles.push({ x: -11, z: wz, r: 1.2 }); // west wall
      this._collisionCircles.push({ x:  11, z: wz, r: 1.2 }); // east wall
    }

    // Ambient cyan accent strips along floor edges (horizontal only)
    const accentMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
    const stripPositions = [
      { x: 0, z: -10, len: 20 }, { x: 0, z: 10, len: 20 },
    ];
    for (const s of stripPositions) {
      const geo = new THREE.PlaneGeometry(s.len, 0.15);
      const strip = new THREE.Mesh(geo, accentMat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(s.x, 0.02, s.z);
      this.group.add(strip);
    }

    // ── Fabricator (Workbench) ───────────────────────────────────────────────
    this._addFabricator(5, -3);

    // ── Offload Station ────────────────────────────────────────────────────────
    this._addOffloadStation(-8, 0);

    // ── Holographic wall panels (decorative) ─────────────────────────────────
    for (const [px, pz, ry] of [[-9, -5, 0.3], [9, -5, -0.3]]) {
      const panelGeo = new THREE.BoxGeometry(2.5, 1.8, 0.1);
      const panelMat = createToonMaterial(0x0a2233);
      const panel = new THREE.Mesh(panelGeo, panelMat);
      panel.position.set(px, 1.5, pz);
      panel.rotation.y = ry;
      addOutline(panel, 0.04);
      this.group.add(panel);
      // Cyan inner screen
      const screenGeo = new THREE.PlaneGeometry(2.2, 1.4);
      const screenMat = new THREE.MeshBasicMaterial({ color: 0x003322, transparent: true, opacity: 0.8 });
      const screen = new THREE.Mesh(screenGeo, screenMat);
      screen.position.set(px, 1.5, pz + (ry > 0 ? -0.1 : 0.1));
      screen.rotation.y = ry;
      this.group.add(screen);
    }

    // ── Charging Station ──────────────────────────────────────────────────────
    this._addChargingStation(-5, 3);

    // ── Drone Monitor ─────────────────────────────────────────────────────────
    this._addDroneMonitor(5, 3);

    // ── Ascension Terminal ────────────────────────────────────────────────────
    this._addAscensionTerminal(0, -6);

    // ── Mastery Terminal ──────────────────────────────────────────────────────
    this._addMasteryTerminal(6, -6);

    // Hatch to Workspace (north wall — the "top" of the room)
    this._addPortal(0, -9, 'workspace', 0, 'Workspace');

    // Hatch back to Landing Site (south side, near spawn)
    this._addPortal(0, 6, 'landingSite', 0, 'Exit Ship');
    this._addReturnBeacon(0, 6);
  }

  // ── Workspace ─────────────────────────────────────────────────────────────
  _buildWorkspace() {
    // Dark metal floor (slightly different tint from spaceship)
    const floorGeo = new THREE.PlaneGeometry(22, 22);
    const floorMat = createToonMaterial(0x16202a);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Subtle amber grid on floor
    const grid = new THREE.GridHelper(22, 11, 0xffaa44, 0xffaa44);
    grid.position.y = 0.01;
    const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMats.forEach(m => { m.transparent = true; m.opacity = 0.12; });
    grid.visible = false;
    this.group.add(grid);
    this._grids.push(grid);

    // Solid perimeter — gap on south wall (z=11) at x=0 for the return hatch
    for (let wx = -11; wx <= 11; wx += 2) {
      this._collisionCircles.push({ x: wx, z: -11, r: 1.2 }); // north wall
      if (wx !== -1 && wx !== 1) {
        this._collisionCircles.push({ x: wx, z: 11, r: 1.2 }); // south wall (gap for return hatch)
      }
    }
    for (let wz = -9; wz <= 9; wz += 2) {
      this._collisionCircles.push({ x: -11, z: wz, r: 1.2 });
      this._collisionCircles.push({ x:  11, z: wz, r: 1.2 });
    }

    // Amber accent strips along the floor edges
    const accentMat = new THREE.MeshBasicMaterial({ color: 0xffaa44 });
    const stripPositions = [
      { x: 0, z: -10, rx: 0, len: 20 }, { x: 0, z: 10, rx: 0, len: 20 },
      { x: -10, z: 0, rx: Math.PI / 2, len: 20 }, { x: 10, z: 0, rx: Math.PI / 2, len: 20 },
    ];
    for (const s of stripPositions) {
      const geo = new THREE.PlaneGeometry(s.len, 0.15);
      const strip = new THREE.Mesh(geo, accentMat);
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = s.rx;
      strip.position.set(s.x, 0.02, s.z);
      this.group.add(strip);
    }

    // ── 4 stations ──────────────────────────────────────────────────────────
    this._addWorkshopStation(-7, -3);          // Arc Smelter
    this._addConstructorStation(-3, -3);       // (former Component Assembler)
    this._addExtractorStation(3, -3);          // Advanced Fabricator
    this._addAssemblyMatrixStation(7, -3);     // Spatial 5×5 grid

    // Return hatch back to Spaceship (south wall — the bottom)
    this._addPortal(0, 9, 'spaceship', 0, 'Exit Workspace');
    this._addReturnBeacon(0, 9);
  }

  _addWorkshopStation(x, z) {
    const g = new THREE.Group();
    const baseGeo = new THREE.CylinderGeometry(0.85, 0.95, 0.18, 8);
    const baseMat = createToonMaterial(0x2a1800);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.09;
    base.castShadow = true;
    g.add(base);

    const bodyGeo = new THREE.BoxGeometry(1.3, 1.1, 0.7);
    const bodyMat = createToonMaterial(0x221400);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.65;
    body.castShadow = true;
    addOutline(body, 0.05);
    g.add(body);

    const screenGeo = new THREE.PlaneGeometry(1.0, 0.65);
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x3a1400 });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(0, 0.75, 0.36);
    g.add(screen);

    const topGeo = new THREE.BoxGeometry(1.1, 0.07, 0.5);
    const topMat = createToonMaterial(0xff6622);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 1.27;
    g.add(top);

    const indGeo = new THREE.OctahedronGeometry(0.14, 0);
    const indMat = createToonMaterial(0xff6622);
    const ind = new THREE.Mesh(indGeo, indMat);
    ind.position.y = 1.9;
    g.add(ind);

    g.position.set(x, 0, z);
    this.group.add(g);
    this._collisionCircles.push({ x, z, r: 1.0 });
    this._workshopStationPos = { x, z };
  }

  _addConstructorStation(x, z) {
    const g = new THREE.Group();
    const baseGeo = new THREE.CylinderGeometry(0.85, 0.95, 0.18, 8);
    const baseMat = createToonMaterial(0x002a1a);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.09;
    base.castShadow = true;
    g.add(base);

    const bodyGeo = new THREE.BoxGeometry(1.3, 1.1, 0.7);
    const bodyMat = createToonMaterial(0x001a14);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.65;
    body.castShadow = true;
    addOutline(body, 0.05);
    g.add(body);

    const screenGeo = new THREE.PlaneGeometry(1.0, 0.65);
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x003322 });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(0, 0.75, 0.36);
    g.add(screen);

    const topGeo = new THREE.BoxGeometry(1.1, 0.07, 0.5);
    const topMat = createToonMaterial(0x00cc88);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 1.27;
    g.add(top);

    const ringGeo = new THREE.TorusGeometry(0.3, 0.05, 8, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00cc88 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.75;
    g.add(ring);

    const indGeo = new THREE.OctahedronGeometry(0.14, 0);
    const indMat = createToonMaterial(0x00cc88);
    const ind = new THREE.Mesh(indGeo, indMat);
    ind.position.y = 1.9;
    g.add(ind);

    g.position.set(x, 0, z);
    this.group.add(g);
    this._collisionCircles.push({ x, z, r: 1.0 });
    this._constructorStationPos = { x, z };
  }

  _addExtractorStation(x, z) {
    const g = new THREE.Group();
    const baseGeo = new THREE.CylinderGeometry(0.95, 1.05, 0.18, 8);
    const baseMat = createToonMaterial(0x1a0a2a);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.09;
    base.castShadow = true;
    g.add(base);

    const bodyGeo = new THREE.BoxGeometry(1.4, 1.2, 0.8);
    const bodyMat = createToonMaterial(0x150a22);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.7;
    body.castShadow = true;
    addOutline(body, 0.05);
    g.add(body);

    const screenGeo = new THREE.PlaneGeometry(1.05, 0.7);
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x2a0044 });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(0, 0.8, 0.41);
    g.add(screen);

    const topGeo = new THREE.BoxGeometry(1.2, 0.08, 0.6);
    const topMat = createToonMaterial(0xcc44ff);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 1.34;
    g.add(top);

    // Twin spires
    for (const sx of [-0.5, 0.5]) {
      const spireGeo = new THREE.CylinderGeometry(0.06, 0.1, 0.7, 6);
      const spireMat = createToonMaterial(0x553377);
      const spire = new THREE.Mesh(spireGeo, spireMat);
      spire.position.set(sx, 1.7, 0);
      g.add(spire);
    }

    const indGeo = new THREE.OctahedronGeometry(0.15, 0);
    const indMat = createToonMaterial(0xcc44ff);
    const ind = new THREE.Mesh(indGeo, indMat);
    ind.position.y = 2.2;
    g.add(ind);

    g.position.set(x, 0, z);
    this.group.add(g);
    this._collisionCircles.push({ x, z, r: 1.0 });
    this._extractorStationPos = { x, z };
  }

  _addAssemblyMatrixStation(x, z) {
    const g = new THREE.Group();
    const baseGeo = new THREE.CylinderGeometry(0.9, 1.0, 0.18, 8);
    const baseMat = createToonMaterial(0x002233);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.09;
    base.castShadow = true;
    g.add(base);

    const bodyGeo = new THREE.BoxGeometry(1.4, 0.8, 1.4);
    const bodyMat = createToonMaterial(0x001a28);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.55;
    body.castShadow = true;
    addOutline(body, 0.05);
    g.add(body);

    // 5x5 grid of small cyan tiles on top to suggest a matrix bench
    const tileMat = createToonMaterial(0x00aacc);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const tileGeo = new THREE.BoxGeometry(0.18, 0.04, 0.18);
        const tile = new THREE.Mesh(tileGeo, tileMat);
        tile.position.set(-0.5 + c * 0.25, 0.97, -0.5 + r * 0.25);
        g.add(tile);
      }
    }

    const indGeo = new THREE.OctahedronGeometry(0.14, 0);
    const indMat = createToonMaterial(0x00ddff);
    const ind = new THREE.Mesh(indGeo, indMat);
    ind.position.y = 1.7;
    g.add(ind);

    g.position.set(x, 0, z);
    this.group.add(g);
    this._collisionCircles.push({ x, z, r: 1.0 });
    this._assemblyMatrixStationPos = { x, z };
  }

  // Partition wall + accent strip that visually carves an Offload Chamber out of the ship's back.
  _buildOffloadChamberPartition() {
    const PZ = -7.5;       // partition z-line
    const GAP_HALF = 1.0;  // 2-unit doorway centered on x=0
    const HEIGHT = 2.2;
    const THICK = 0.25;

    // Two wall segments flanking the doorway
    const segs = [
      { from: -10.5, to: -GAP_HALF },
      { from: GAP_HALF, to: 10.5 },
    ];
    for (const s of segs) {
      const len = s.to - s.from;
      const cx = (s.from + s.to) / 2;
      const wallGeo = new THREE.BoxGeometry(len, HEIGHT, THICK);
      const wallMat = createToonMaterial(0x162028);
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(cx, HEIGHT / 2, PZ);
      wall.castShadow = true;
      addOutline(wall, 0.04);
      this.group.add(wall);

      // Collision circles along the segment
      for (let x = s.from + 0.5; x <= s.to - 0.5; x += 1.5) {
        this._collisionCircles.push({ x, z: PZ, r: 0.9 });
      }
    }

    // Cyan accent strip along the partition base, with the doorway gap
    const accentMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
    for (const s of segs) {
      const len = s.to - s.from;
      const cx = (s.from + s.to) / 2;
      const stripGeo = new THREE.PlaneGeometry(len, 0.12);
      const strip = new THREE.Mesh(stripGeo, accentMat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(cx, 0.02, PZ);
      this.group.add(strip);
    }

    // Doorway frame (thin verticals on either side of the gap)
    for (const fx of [-GAP_HALF, GAP_HALF]) {
      const frameGeo = new THREE.BoxGeometry(0.12, HEIGHT, 0.4);
      const frameMat = createToonMaterial(0x00aa88);
      const frame = new THREE.Mesh(frameGeo, frameMat);
      frame.position.set(fx, HEIGHT / 2, PZ);
      this.group.add(frame);
    }
  }

  _addOffloadStation(x, z) {
    const g = new THREE.Group();

    // Main console body
    const bodyGeo = new THREE.BoxGeometry(1.4, 1.2, 0.8);
    const bodyMat = createToonMaterial(0x223344);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.6;
    body.castShadow = true;
    addOutline(body, 0.05);
    g.add(body);

    // Glowing top panel
    const topGeo = new THREE.BoxGeometry(1.2, 0.08, 0.6);
    const topMat = createToonMaterial(0x00ffcc);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 1.24;
    g.add(top);

    // Screen
    const screenGeo = new THREE.PlaneGeometry(0.9, 0.6);
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x004433 });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(0, 0.85, 0.41);
    g.add(screen);

    // Label above
    const labelGeo = new THREE.BoxGeometry(1.2, 0.25, 0.05);
    const labelMat = createToonMaterial(0x005544);
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.position.set(0, 1.6, 0.3);
    g.add(label);

    // Floating indicator
    const indGeo = new THREE.OctahedronGeometry(0.12, 0);
    const indMat = createToonMaterial(0x00ffcc);
    const ind = new THREE.Mesh(indGeo, indMat);
    ind.position.y = 2.0;
    g.add(ind);

    g.position.set(x, 0, z);
    this.group.add(g);
    this._collisionCircles.push({ x, z, r: 1.0 });

    // Register as interactable station
    this._offloadStationPos = { x, z };
  }

  _addFabricator(x, z) {
    const g = new THREE.Group();

    // Base platform
    const baseGeo = new THREE.CylinderGeometry(0.9, 1.0, 0.2, 10);
    const baseMat = createToonMaterial(0x334455);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.1;
    base.castShadow = true;
    g.add(base);

    // Main body — wider workbench shape
    const bodyGeo = new THREE.BoxGeometry(1.6, 1.0, 1.0);
    const bodyMat = createToonMaterial(0x334455);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.7;
    body.castShadow = true;
    addOutline(body, 0.05);
    g.add(body);

    // Glowing work surface
    const surfaceGeo = new THREE.BoxGeometry(1.4, 0.06, 0.8);
    const surfaceMat = createToonMaterial(0x4488ff);
    const surface = new THREE.Mesh(surfaceGeo, surfaceMat);
    surface.position.y = 1.23;
    g.add(surface);

    // Arm / crane element
    const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6);
    const armMat = createToonMaterial(0x445566);
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.set(0.5, 1.95, 0);
    arm.rotation.z = Math.PI / 8;
    g.add(arm);

    // End effector glow
    const effGeo = new THREE.SphereGeometry(0.12, 6, 4);
    const effMat = createToonMaterial(0x4488ff);
    const eff = new THREE.Mesh(effGeo, effMat);
    eff.position.set(0.9, 2.5, 0);
    g.add(eff);

    // Label indicator
    const indGeo = new THREE.OctahedronGeometry(0.12, 0);
    const indMat = createToonMaterial(0x4488ff);
    const ind = new THREE.Mesh(indGeo, indMat);
    ind.position.y = 2.8;
    g.add(ind);

    g.position.set(x, 0, z);
    this.group.add(g);
    this._collisionCircles.push({ x, z, r: 1.0 });

    // Register as interactable fabricator
    this._fabricatorPos = { x, z };
  }

  _addDroneMonitor(x, z) {
    const g = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(1.2, 1.0, 0.7);
    const bodyMat = createToonMaterial(0x1a2a1a);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.6;
    body.castShadow = true;
    addOutline(body, 0.05);
    g.add(body);

    const screenGeo = new THREE.PlaneGeometry(0.8, 0.5);
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x003322 });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(0, 0.7, 0.36);
    g.add(screen);

    const topGeo = new THREE.BoxGeometry(1.0, 0.06, 0.5);
    const topMat = createToonMaterial(0x00cc88);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 1.13;
    g.add(top);

    const standGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.5, 6);
    const standMat = createToonMaterial(0x223322);
    const stand = new THREE.Mesh(standGeo, standMat);
    stand.position.y = 0.25;
    g.add(stand);

    const indGeo = new THREE.OctahedronGeometry(0.11, 0);
    const indMat = createToonMaterial(0x00cc88);
    const ind = new THREE.Mesh(indGeo, indMat);
    ind.position.y = 1.7;
    g.add(ind);

    g.position.set(x, 0, z);
    this.group.add(g);
    this._collisionCircles.push({ x, z, r: 1.0 });
    this._droneMonitorPos = { x, z };
  }

  _addAscensionTerminal(x, z) {
    const g = new THREE.Group();

    const baseGeo = new THREE.CylinderGeometry(0.6, 0.7, 0.15, 8);
    const baseMat = createToonMaterial(0x1a0a2a);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.075;
    base.castShadow = true;
    g.add(base);

    const bodyGeo = new THREE.BoxGeometry(1.1, 1.1, 0.6);
    const bodyMat = createToonMaterial(0x1a0a2a);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.65;
    body.castShadow = true;
    addOutline(body, 0.05);
    g.add(body);

    const screenGeo = new THREE.PlaneGeometry(0.8, 0.6);
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x1a003a });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(0, 0.72, 0.31);
    g.add(screen);

    const topGeo = new THREE.BoxGeometry(0.9, 0.06, 0.45);
    const topMat = createToonMaterial(0xcc88ff);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 1.23;
    g.add(top);

    const ringGeo = new THREE.TorusGeometry(0.35, 0.04, 8, 20);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xcc88ff });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.8;
    g.add(ring);

    const indGeo = new THREE.OctahedronGeometry(0.13, 0);
    const indMat = createToonMaterial(0xcc88ff);
    const ind = new THREE.Mesh(indGeo, indMat);
    ind.position.y = 1.85;
    g.add(ind);

    g.position.set(x, 0, z);
    this.group.add(g);
    this._collisionCircles.push({ x, z, r: 1.0 });
    this._ascensionTerminalPos = { x, z };
  }

  _addMasteryTerminal(x, z) {
    const g = new THREE.Group();

    const baseGeo = new THREE.CylinderGeometry(0.7, 0.8, 0.2, 8);
    const baseMat = createToonMaterial(0x2a1a0a);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.1;
    base.castShadow = true;
    g.add(base);

    const bodyGeo = new THREE.BoxGeometry(1.2, 1.2, 0.7);
    const bodyMat = createToonMaterial(0x2a1a0a);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.7;
    body.castShadow = true;
    addOutline(body, 0.05);
    g.add(body);

    const screenGeo = new THREE.PlaneGeometry(0.9, 0.7);
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x3a1a00 });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(0, 0.8, 0.36);
    g.add(screen);

    const topGeo = new THREE.BoxGeometry(1.0, 0.08, 0.5);
    const topMat = createToonMaterial(0xffaa44);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 1.34;
    g.add(top);

    const ringGeo = new THREE.TorusGeometry(0.4, 0.05, 8, 20);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffaa44 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.9;
    g.add(ring);

    const indGeo = new THREE.OctahedronGeometry(0.15, 0);
    const indMat = createToonMaterial(0xffaa44);
    const ind = new THREE.Mesh(indGeo, indMat);
    ind.position.y = 2.0;
    g.add(ind);

    g.position.set(x, 0, z);
    this.group.add(g);
    this._collisionCircles.push({ x, z, r: 1.0 });
    this._masteryTerminalPos = { x, z };
  }

  _addChargingStation(x, z) {
    const g = new THREE.Group();

    // Base platform
    const baseGeo = new THREE.CylinderGeometry(0.8, 0.9, 0.15, 10);
    const baseMat = createToonMaterial(0x223344);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.075;
    base.castShadow = true;
    g.add(base);

    // Main pod body
    const bodyGeo = new THREE.CylinderGeometry(0.55, 0.65, 1.4, 10);
    const bodyMat = createToonMaterial(0x2a3a4a);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.85;
    body.castShadow = true;
    addOutline(body, 0.05);
    g.add(body);

    // Energy ring (green glow)
    const ringGeo = new THREE.TorusGeometry(0.6, 0.06, 8, 20);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x44ff88 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.1;
    g.add(ring);

    // Top dome
    const domeGeo = new THREE.SphereGeometry(0.45, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = createToonMaterial(0x44ff88);
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.y = 1.55;
    g.add(dome);

    // Floating energy indicator
    const indGeo = new THREE.OctahedronGeometry(0.14, 0);
    const indMat = createToonMaterial(0x44ff88);
    const ind = new THREE.Mesh(indGeo, indMat);
    ind.position.y = 2.2;
    g.add(ind);

    g.position.set(x, 0, z);
    this.group.add(g);
    this._collisionCircles.push({ x, z, r: 1.0 });

    this._chargingStationPos = { x, z };
  }

  _addCraftTerminal(x, z) {
    const g = new THREE.Group();

    const baseGeo = new THREE.CylinderGeometry(0.75, 0.85, 0.18, 8);
    const baseMat = createToonMaterial(0x2a1800);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.09;
    base.castShadow = true;
    g.add(base);

    const bodyGeo = new THREE.BoxGeometry(1.3, 1.1, 0.65);
    const bodyMat = createToonMaterial(0x221400);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.64;
    body.castShadow = true;
    addOutline(body, 0.05);
    g.add(body);

    // Main screen
    const screenGeo = new THREE.PlaneGeometry(1.0, 0.65);
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x3a1400 });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(0, 0.75, 0.33);
    g.add(screen);

    // Orange accent strip on top
    const topGeo = new THREE.BoxGeometry(1.1, 0.07, 0.48);
    const topMat = createToonMaterial(0xff6622);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 1.26;
    g.add(top);

    // Side panel — industrial look
    const sideGeo = new THREE.BoxGeometry(0.18, 0.7, 0.55);
    const sideMat = createToonMaterial(0x331a00);
    const side = new THREE.Mesh(sideGeo, sideMat);
    side.position.set(0.74, 0.64, 0);
    addOutline(side, 0.03);
    g.add(side);

    // Gear-like ring
    const ringGeo = new THREE.TorusGeometry(0.3, 0.05, 8, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6622 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.72;
    g.add(ring);

    const indGeo = new THREE.OctahedronGeometry(0.14, 0);
    const indMat = createToonMaterial(0xff6622);
    const ind = new THREE.Mesh(indGeo, indMat);
    ind.position.y = 1.9;
    g.add(ind);

    g.position.set(x, 0, z);
    this.group.add(g);
    this._collisionCircles.push({ x, z, r: 1.0 });
    this._craftTerminalPos = { x, z };
  }

  updateConstructCursor(x, z, addMode, delta) {
    this._cursorGroup.visible = true;
    this._cursorGroup.position.set(x, 0, z);
    const color = addMode ? 0x00ffcc : 0xff4422;
    this._cursorTileMat.color.setHex(color);
    this._cursorEdgeMat.color.setHex(color);
    this._cursorPulseT = (this._cursorPulseT + delta * 3.0) % (Math.PI * 2);
    this._cursorTileMat.opacity = 0.28 + 0.22 * Math.sin(this._cursorPulseT);
  }

  hideConstructCursor() {
    this._cursorGroup.visible = false;
  }

  getOffloadStationPos() { return this._offloadStationPos || null; }
  getFabricatorPos() { return this._fabricatorPos || null; }
  getChargingStationPos() { return this._chargingStationPos || null; }
  getCraftTerminalPos() { return this._craftTerminalPos || null; }
  getDroneMonitorPos() { return this._droneMonitorPos || null; }
  getAscensionTerminalPos() { return this._ascensionTerminalPos || null; }
  getMasteryTerminalPos() { return this._masteryTerminalPos || null; }
  getWorkshopStationPos() { return this._workshopStationPos || null; }
  getConstructorStationPos() { return this._constructorStationPos || null; }
  getExtractorStationPos() { return this._extractorStationPos || null; }
  getAssemblyMatrixStationPos() { return this._assemblyMatrixStationPos || null; }

  /**
   * Tall glowing cyan beacon placed above the return portal so mobile players
   * can spot it from the spawn point at (0, 0).
   */
  _addReturnBeacon(x, z) {
    const group = new THREE.Group();

    // Tall thin pillar
    const pillarGeo = new THREE.CylinderGeometry(0.12, 0.18, 5, 8);
    const pillarMat = createToonMaterial(0x00ffcc);
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.y = 2.5 + 1.5; // sit above portal ring (which is at y=1.5)
    group.add(pillar);
    addOutline(pillar, 0.04);

    // Arrowhead cone pointing upward
    const arrowGeo = new THREE.ConeGeometry(0.35, 0.7, 8);
    const arrowMat = createToonMaterial(0x00ffcc);
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.y = 2.5 + 1.5 + 2.5 + 0.35; // on top of pillar
    group.add(arrow);
    addOutline(arrow, 0.04);

    // Floor ring to draw attention
    const ringGeo = new THREE.TorusGeometry(1.6, 0.1, 6, 20);
    const ringMat = createToonMaterial(0x00ffcc);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.12;
    group.add(ring);

    group.position.set(x, 0, z);
    this.group.add(group);
  }
}
