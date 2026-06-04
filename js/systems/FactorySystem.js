import { CONFIG } from '../config.js';

export class FactorySystem {
  constructor(inventorySystem, ppSystem, statsSystem, pedometerSystem) {
    this.inventory = inventorySystem;
    this.ppSystem = ppSystem;
    this.statsSystem = statsSystem;
    this.pedometerSystem = pedometerSystem;
    
    // Global buff tracks
    this.buffs = {
      logicite_matrix: false,
      fractalite_frame: false,
      aetherite_core: false
    };

    // Keep track of factory machine state
    this.machines = {
      smelter: { 
        id: 'smelter',
        name: 'Arc Smelter',
        unlocked: true, 
        count: 1,
        isAutomated: false, 
        processingSpeed: 2.0, 
        yieldRatio: 1,
        currentRecipe: 'stahlerte',
        progress: 0.0
      },
      assembler: {
        id: 'assembler',
        name: 'Constructor',
        unlocked: true, 
        count: 1, 
        isAutomated: false, 
        processingSpeed: 5.0, 
        yieldRatio: 1,
        currentRecipe: 'logicite',
        progress: 0.0
      },
      fabricator: {
        id: 'fabricator',
        name: 'Advanced Fabricator',
        unlocked: true,
        count: 1,
        isAutomated: false,
        processingSpeed: 10.0,
        yieldRatio: 1,
        currentRecipe: 'logicite_matrix',
        progress: 0.0
      }
    };

    // Dictionary of recipes
    this.recipes = {
      // Smelter — raw → refined
      stahlerte: { inputs: { tobarba: 2 }, outputs: { stahlerte: 1 } },
      vitrion:   { inputs: { basalva: 2 }, outputs: { vitrion: 1 } },
      holzura:   { inputs: { verdanite: 2 }, outputs: { holzura: 1 } },

      // Assembler — refined → component
      logicite:   { inputs: { vitrion: 1, stahlerte: 1 }, outputs: { logicite: 1 } },
      fractalite: { inputs: { stahlerte: 1, holzura: 1 }, outputs: { fractalite: 1 } },
      aetherite:  { inputs: { vitrion: 1, holzura: 1 }, outputs: { aetherite: 1 } },

      // Fabricator — component → artifact (one-time global buff)
      logicite_matrix:  { inputs: { logicite: 10, aetherite: 5 }, outputs: { logicite_matrix: 1 } },
      fractalite_frame: { inputs: { fractalite: 10, logicite: 5 }, outputs: { fractalite_frame: 1 } },
      aetherite_core:   { inputs: { aetherite: 10, fractalite: 5 }, outputs: { aetherite_core: 1 } }
    };

    // Mappings of what recipes belong to what machines
    this.machineRecipes = {
      smelter:   ['stahlerte', 'vitrion', 'holzura'],
      assembler: ['logicite', 'fractalite', 'aetherite'],
      fabricator: ['logicite_matrix', 'fractalite_frame', 'aetherite_core']
    };
  }

  update(delta) {
    for (const [id, machine] of Object.entries(this.machines)) {
      if (!machine.unlocked || !machine.currentRecipe || machine.count === 0) continue;
      
      const recipe = this.recipes[machine.currentRecipe];
      
      // Idle calculation
      if (machine.isAutomated) {
        const workDone = delta * machine.count * (1 / machine.processingSpeed);
        machine.progress += workDone;
      }

      while (machine.progress >= 1.0) {
        if (this.inventory.hasMaterials(recipe.inputs)) {
          // Consume inputs
          for (const [mat, qty] of Object.entries(recipe.inputs)) {
            this.inventory.removeMaterial(mat, qty);
          }
          
          // Generate outputs
          for (const [mat, qty] of Object.entries(recipe.outputs)) {
            this.giveOutput(mat, qty * machine.yieldRatio);
          }
          
          machine.progress -= 1.0; 
        } else {
          machine.progress = 1.0; // halt at 100% until resources available
          break;
        }
      }
    }
  }
  
  giveOutput(item, qty) {
    // If it's a global buff artifact
    if (item === 'logicite_matrix' && !this.buffs.logicite_matrix) {
      this.buffs.logicite_matrix = true;
      this.ppSystem.globalMultiplier *= 1.20;
      this.inventory.addMaterial(item, qty); // Store record in inventory for visuals
    } else if (item === 'fractalite_frame' && !this.buffs.fractalite_frame) {
      this.buffs.fractalite_frame = true;
      this.statsSystem.stats.speed.level += 15; // 15 levels = +2.25 speed
      this.inventory.addMaterial(item, qty);
    } else if (item === 'aetherite_core' && !this.buffs.aetherite_core) {
      this.buffs.aetherite_core = true;
      this.statsSystem.stats.health.level += 10; // 10 levels = 20 HP
      this.statsSystem.stats.energyCap.level += 5; // +50 energy
      this.inventory.addMaterial(item, qty);
    } else {
      // Regular material
      this.inventory.addMaterial(item, Math.floor(qty));
    }
  }

  manualProcess(machineId) {
    const machine = this.machines[machineId];
    if (!machine || machine.isAutomated || !machine.unlocked) return false;
    const recipe = this.recipes[machine.currentRecipe];
    if (!recipe || !this.inventory.hasMaterials(recipe.inputs)) return false;
    machine.progress += (1 / machine.processingSpeed);
    return true;
  }
  
  automate(machineId, cost) {
    const machine = this.machines[machineId];
    if (machine && !machine.isAutomated && this.ppSystem.spend(cost)) {
      machine.isAutomated = true;
    }
  }

  setRecipe(machineId, recipeId) {
    const machine = this.machines[machineId];
    if (machine && this.recipes[recipeId]) {
      machine.currentRecipe = recipeId;
      machine.progress = 0; // reset progress when switching recipe
    }
  }
  
  unlockMachine(machineId) {
    if (this.machines[machineId]) {
      this.machines[machineId].unlocked = true;
      if (this.machines[machineId].count === 0) {
        this.machines[machineId].count = 1;
      }
    }
  }

  serialize() {
    return {
      buffs: { ...this.buffs },
      machines: Object.fromEntries(
        Object.entries(this.machines).map(([id, m]) => [id, { 
          unlocked: m.unlocked, 
          count: m.count, 
          isAutomated: m.isAutomated, 
          currentRecipe: m.currentRecipe,
          progress: m.progress
        }])
      )
    };
  }

  deserialize(data) {
    if (!data) return;
    if (data.buffs) {
      if ((data.buffs.logicite_matrix || data.buffs.quantum_processor_ring) && !this.buffs.logicite_matrix) {
        this.buffs.logicite_matrix = true;
        this.ppSystem.globalMultiplier *= 1.20;
      }
      if ((data.buffs.fractalite_frame || data.buffs.exo_servo_harness) && !this.buffs.fractalite_frame) {
        this.buffs.fractalite_frame = true;
      }
      if ((data.buffs.aetherite_core || data.buffs.aegis_capacitor_bank) && !this.buffs.aetherite_core) {
        this.buffs.aetherite_core = true;
      }
    }
    
    if (data.machines) {
      for (const [id, mData] of Object.entries(data.machines)) {
        if (this.machines[id]) {
          this.machines[id].unlocked = mData.unlocked;
          this.machines[id].count = mData.count;
          this.machines[id].isAutomated = mData.isAutomated;
          this.machines[id].currentRecipe = mData.currentRecipe;
          this.machines[id].progress = mData.progress || 0;
        }
      }
    }
  }
}
