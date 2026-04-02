import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "..", "data");
const statePath = path.join(dataDir, "state.json");
const accountsPath = path.join(dataDir, "accounts.json");

const SYSTEM_DETAILS = {
  sol: {
    ownerRule: "No direct ownership. Mining rights are leased.",
    bodies: [
      { id: "earth", name: "Earth", type: "Planet", x: 0, y: 0, radius: 8 },
      { id: "luna", name: "Luna", type: "Moon", x: 26, y: 0, radius: 3 },
      { id: "mars", name: "Mars", type: "Planet", x: 72, y: 0, radius: 6 },
      { id: "belt", name: "Asteroid Belt", type: "Field", x: 120, y: 0, radius: 12 }
    ]
  },
  "alpha-centauri": {
    ownerRule: "Neutral authority oversight with corporate lease competition.",
    bodies: [
      { id: "ac-prime", name: "Centauri Prime", type: "Planet", x: 50, y: 0, radius: 7 },
      { id: "ac-ii", name: "Centauri II", type: "Planet", x: 86, y: 0, radius: 5 },
      { id: "ac-haven", name: "Haven", type: "Moon", x: 102, y: 0, radius: 3 },
      { id: "ac-belt", name: "Centauri Belt", type: "Field", x: 126, y: 0, radius: 10 }
    ]
  },
  "barnards-star": {
    ownerRule: "Frontier charter system with low-regulation extraction rights.",
    bodies: [
      { id: "bn-iron", name: "Ironwell", type: "Planet", x: 48, y: 0, radius: 6 },
      { id: "bn-cinder", name: "Cinder", type: "Planet", x: 82, y: 0, radius: 4 },
      { id: "bn-arc", name: "Arcadia", type: "Moon", x: 103, y: 0, radius: 3 },
      { id: "bn-rift", name: "Rift Debris Ring", type: "Field", x: 132, y: 0, radius: 11 }
    ]
  },
  "wolf-359": {
    ownerRule: "High-risk conflict zone with arbitration-based claims.",
    bodies: [
      { id: "wf-halo", name: "Halo", type: "Planet", x: 44, y: 0, radius: 5 },
      { id: "wf-garnet", name: "Garnet", type: "Planet", x: 77, y: 0, radius: 6 },
      { id: "wf-veil", name: "Veil", type: "Moon", x: 92, y: 0, radius: 3 },
      { id: "wf-shards", name: "Shard Belt", type: "Field", x: 126, y: 0, radius: 10 }
    ]
  },
  "tau-ceti": {
    ownerRule: "Treaty-governed commercial corridor with tariff controls.",
    bodies: [
      { id: "tc-verde", name: "Verde", type: "Planet", x: 47, y: 0, radius: 7 },
      { id: "tc-lumen", name: "Lumen", type: "Planet", x: 84, y: 0, radius: 5 },
      { id: "tc-aqua", name: "Aqua Minor", type: "Moon", x: 101, y: 0, radius: 3 },
      { id: "tc-cloud", name: "Tau Ice Cloud", type: "Field", x: 128, y: 0, radius: 11 }
    ]
  },
  "epsilon-eridani": {
    ownerRule: "Semi-private jurisdiction with licensed station authorities.",
    bodies: [
      { id: "ee-kestrel", name: "Kestrel", type: "Planet", x: 46, y: 0, radius: 6 },
      { id: "ee-orion", name: "Orion Reach", type: "Planet", x: 78, y: 0, radius: 5 },
      { id: "ee-lyra", name: "Lyra", type: "Moon", x: 95, y: 0, radius: 3 },
      { id: "ee-crown", name: "Crown Belt", type: "Field", x: 124, y: 0, radius: 10 }
    ]
  }
};

const LEVEL_10_MILESTONE_ROADMAP = [
  "Reach 10 employees",
  "Construct Basic Extractor Yard",
  "Mine 300 Silicates",
  "Complete first Corporate R&D project",
  "Reached Corporation Level 2",
  "Reach 20 employees",
  "Construct Refinery Annex",
  "Produce 150 refined components",
  "Unlock 2 additional research nodes",
  "Reached Corporation Level 3",
  "Expand to 30 employees",
  "Open second extraction contract",
  "Complete 3 market sell contracts",
  "Maintain positive net flow for 3 cycles",
  "Reached Corporation Level 4",
  "Reach 40 employees",
  "Upgrade extraction to Tier 2",
  "Secure long-term logistics agreement",
  "Build strategic reserve of 500 Silicates",
  "Reached Corporation Level 5",
  "Reach 55 employees",
  "Field first defensive fleet detachment",
  "Complete 2 CEO insight programs",
  "Produce first advanced material output",
  "Reached Corporation Level 6",
  "Reach 70 employees",
  "Establish off-world outpost operations",
  "Complete 10 successful market trades",
  "Unlock regional operations charter",
  "Reached Corporation Level 7",
  "Reach 85 employees",
  "Construct second refinery line",
  "Accumulate 1.5M credits in assets",
  "Complete first diplomacy mission",
  "Reached Corporation Level 8",
  "Reach 100 employees",
  "Sustain two profitable supply chains",
  "Deploy first destroyer wing",
  "Complete security compliance audit",
  "Reached Corporation Level 9",
  "Reach 120 employees",
  "Operate three system contracts simultaneously",
  "Maintain liquidity cap above 350,000",
  "Complete strategic expansion review",
  "Reached Corporation Level 10"
];

function normalizeSystems(systems = []) {
  return systems.map((system) => {
    const defaults = SYSTEM_DETAILS[system.id];
    if (!defaults) {
      return system;
    }

    return {
      ...system,
      ownerRule: system.ownerRule || defaults.ownerRule,
      bodies: Array.isArray(system.bodies) && system.bodies.length ? system.bodies : defaults.bodies
    };
  });
}

function normalizeStateShape(rawState) {
  if (!rawState.world) {
    rawState.world = {};
  }
  rawState.world.systems = normalizeSystems(rawState.world.systems || []);

  if (!rawState.corp) {
    rawState.corp = {};
  }

  ensureCorpMiningModel(rawState.corp);
  ensureCorpLiquidityModel(rawState.corp);

  if (!rawState.corp.inventory) {
    rawState.corp.inventory = {};
  }

  if (!Array.isArray(rawState.corp.unlockedTech)) {
    rawState.corp.unlockedTech = [];
  }

  if (!rawState.playerProfile) {
    rawState.playerProfile = {
      isNewPlayer: true,
      registeredAt: Date.now(),
      walkthroughCompleted: false
    };
  }

  if (typeof rawState.playerProfile.walkthroughCompleted !== "boolean") {
    rawState.playerProfile.walkthroughCompleted = false;
  }

  if (!Array.isArray(rawState.corp.milestonesCompleted)) {
    rawState.corp.milestonesCompleted = [];
  }

  if (!Array.isArray(rawState.corp.milestoneRoadmap)) {
    rawState.corp.milestoneRoadmap = [];
  }

  if (rawState.corp.milestoneRoadmap.length < LEVEL_10_MILESTONE_ROADMAP.length) {
    rawState.corp.milestoneRoadmap = LEVEL_10_MILESTONE_ROADMAP.slice();
  }

  return rawState;
}

function ensureCorpMiningModel(corp) {
  if (!corp.mining || typeof corp.mining !== "object") {
    corp.mining = {};
  }

  if (!corp.mining.silicateExtractor || typeof corp.mining.silicateExtractor !== "object") {
    corp.mining.silicateExtractor = {
      active: false,
      startedAt: null,
      lastTickAt: null,
      endsAt: null,
      throughputPerHour: 0,
      operationCostPerHour: 0,
      totalMined: 0,
      totalSpent: 0,
      lastCompletedAt: null
    };
  }

  const extractor = corp.mining.silicateExtractor;
  if (typeof extractor.active !== "boolean") extractor.active = false;
  if (typeof extractor.throughputPerHour !== "number") extractor.throughputPerHour = 0;
  if (typeof extractor.operationCostPerHour !== "number") extractor.operationCostPerHour = 0;
  if (typeof extractor.totalMined !== "number") extractor.totalMined = 0;
  if (typeof extractor.totalSpent !== "number") extractor.totalSpent = 0;
}

function stopExtractorCycle(extractor, timestamp) {
  extractor.active = false;
  extractor.endsAt = timestamp;
  extractor.lastTickAt = timestamp;
  extractor.lastCompletedAt = timestamp;
}

function applyMiningOperations(corp, now = Date.now()) {
  ensureCorpMiningModel(corp);
  ensureCorpLiquidityModel(corp);

  const extractor = corp.mining.silicateExtractor;
  if (!extractor.active) {
    return;
  }

  const lastTick = Number(extractor.lastTickAt || extractor.startedAt || now);
  const maxEnd = Number(extractor.endsAt || now);
  const intervalEnd = Math.min(now, maxEnd);
  const elapsedMs = Math.max(0, intervalEnd - lastTick);

  if (elapsedMs <= 0) {
    if (now >= maxEnd) {
      stopExtractorCycle(extractor, now);
    }
    return;
  }

  const elapsedHours = elapsedMs / (60 * 60 * 1000);
  const throughput = Math.max(0, Number(extractor.throughputPerHour || 0));
  const efficiency = (corp.unlockedTech || []).includes("tt-basic-extraction") ? 1.2 : 1;
  const projectedMined = elapsedHours * throughput * efficiency;
  const projectedCost = elapsedHours * Math.max(0, Number(extractor.operationCostPerHour || 0));

  let affordabilityRatio = 1;
  if (projectedCost > 0) {
    const byCredits = corp.finances.credits / projectedCost;
    const byLiquidity = corp.finances.liquidity / projectedCost;
    affordabilityRatio = Math.max(0, Math.min(1, byCredits, byLiquidity));
  }

  const actualMined = Math.floor(projectedMined * affordabilityRatio);
  const actualCost = Math.round(projectedCost * affordabilityRatio);

  if (actualCost > 0) {
    corp.finances.credits = Math.max(0, corp.finances.credits - actualCost);
    corp.finances.liquidity = Math.max(0, corp.finances.liquidity - actualCost);
    extractor.totalSpent += actualCost;
  }

  if (actualMined > 0) {
    if (!corp.inventory.Silicates) {
      corp.inventory.Silicates = 0;
    }
    corp.inventory.Silicates += actualMined;
    extractor.totalMined += actualMined;
    corp.finances.dailyRevenue += Math.round(actualMined * 2.4);
  }

  const consumedMs = Math.round(elapsedMs * affordabilityRatio);
  extractor.lastTickAt = lastTick + consumedMs;

  if (affordabilityRatio < 1 || now >= maxEnd) {
    stopExtractorCycle(extractor, now);
  }
}

function ensureCorpLiquidityModel(corp) {
  if (!corp.finances) {
    corp.finances = {};
  }

  if (typeof corp.finances.credits !== "number") {
    corp.finances.credits = 0;
  }

  if (typeof corp.finances.assets !== "number") {
    corp.finances.assets = corp.finances.credits;
  }

  if (typeof corp.finances.dailyRevenue !== "number") {
    corp.finances.dailyRevenue = 0;
  }

  if (typeof corp.finances.dailyCosts !== "number") {
    corp.finances.dailyCosts = 0;
  }

  recalculateLiquidityModel(corp);

  if (typeof corp.finances.liquidity !== "number") {
    corp.finances.liquidity = Math.min(corp.finances.liquidityCap, corp.finances.credits);
  }

  corp.finances.liquidity = Math.max(0, Math.min(corp.finances.liquidity, corp.finances.liquidityCap, corp.finances.credits));

  if (typeof corp.finances.lastLiquidityTick !== "number") {
    corp.finances.lastLiquidityTick = Date.now();
  }
}

function recalculateLiquidityModel(corp) {
  const finances = corp.finances;
  const netFlow = Math.max(0, Number(finances.dailyRevenue || 0) - Number(finances.dailyCosts || 0));
  const assetBackstop = Math.max(90000, Math.round(Number(finances.assets || 0) * 0.08));
  const creditBackstop = Math.max(30000, Math.round(Number(finances.credits || 0) * 0.3));

  finances.liquidityCap = Math.max(assetBackstop, creditBackstop);
  finances.liquidityRegenPerHour = Math.max(2500, Math.round(netFlow * 0.18 + finances.liquidityCap * 0.04));
}

function applyLiquidityTick(corp, now = Date.now()) {
  ensureCorpLiquidityModel(corp);

  const finances = corp.finances;
  const elapsedMs = Math.max(0, now - Number(finances.lastLiquidityTick || now));
  if (elapsedMs <= 0) {
    return;
  }

  const regenPerMs = Number(finances.liquidityRegenPerHour || 0) / (60 * 60 * 1000);
  if (regenPerMs <= 0) {
    finances.lastLiquidityTick = now;
    return;
  }

  const gained = Math.floor(elapsedMs * regenPerMs);
  if (gained > 0) {
    finances.liquidity = Math.min(finances.liquidityCap, finances.credits, Number(finances.liquidity || 0) + gained);
  }

  finances.lastLiquidityTick = now;
}

function deepClone(input) {
  return JSON.parse(JSON.stringify(input));
}

function level2MilestoneName(reqId) {
  const map = {
    hire10: "Reach 10 employees",
    extractor: "Construct Basic Extractor Yard",
    mine300Silicates: "Mine 300 Silicates",
    firstRnD: "Complete first Corporate R&D project"
  };
  return map[reqId] || reqId;
}

function evaluateLevelProgress(profileState) {
  const corp = profileState.corp;
  const inventory = corp.inventory || {};
  const buildings = corp.buildings || [];
  const unlockedTech = corp.unlockedTech || [];

  const requirements = [
    {
      id: "hire10",
      title: "Hire 10 Employees",
      progress: Number(corp.employeeCount || 0),
      target: 10,
      complete: Number(corp.employeeCount || 0) >= 10
    },
    {
      id: "extractor",
      title: "Construct Basic Extractor Yard",
      progress: buildings.some((b) => b.name === "Basic Extractor Yard") ? 1 : 0,
      target: 1,
      complete: buildings.some((b) => b.name === "Basic Extractor Yard")
    },
    {
      id: "mine300Silicates",
      title: "Mine 300 Silicates",
      progress: Number(inventory.Silicates || 0),
      target: 300,
      complete: Number(inventory.Silicates || 0) >= 300
    },
    {
      id: "firstRnD",
      title: "Complete Basic Extraction Analytics",
      progress: unlockedTech.includes("tt-basic-extraction") ? 1 : 0,
      target: 1,
      complete: unlockedTech.includes("tt-basic-extraction")
    }
  ];

  corp.levelProgress = {
    level2: {
      requirements,
      allCompleted: requirements.every((req) => req.complete)
    }
  };

  requirements.forEach((req) => {
    const milestoneName = level2MilestoneName(req.id);
    if (req.complete && !corp.milestonesCompleted.includes(milestoneName)) {
      corp.milestonesCompleted.push(milestoneName);
    }
  });

  if (corp.level < 2 && corp.levelProgress.level2.allCompleted) {
    corp.level = 2;
    if (!corp.milestonesCompleted.includes("Reached Corporation Level 2")) {
      corp.milestonesCompleted.push("Reached Corporation Level 2");
    }

    if (!corp.unlocks.marketSectors.includes("Strategic Materials")) {
      corp.unlocks.marketSectors.push("Strategic Materials");
    }

    corp.employeeCap = Math.max(corp.employeeCap, 35);
    corp.buildingSlots = Math.max(corp.buildingSlots, 3);
    corp.unlocks.maxFleetSize = Math.max(corp.unlocks.maxFleetSize, 16);
  }
}

function createStarterCorporationState(baseState, ceoName, corpName) {
  const next = deepClone(baseState);

  next.corp = {
    ...next.corp,
    ceo: ceoName,
    corporationName: corpName,
    level: 1,
    levelCap: 40,
    milestonesCompleted: [],
    milestoneRoadmap: [
      ...LEVEL_10_MILESTONE_ROADMAP
    ],
    employeeCap: 20,
    employeeCount: 0,
    buildingSlots: 2,
    buildings: [{ name: "Headquarters", tier: 1, status: "Operational" }],
    military: {
      lightFighters: 0,
      destroyers: 0,
      siegeEngines: 0,
      attackValue: 0,
      defenseValue: 0,
      modifiers: {
        rdBonusPct: 0,
        ceoLeadershipPct: 0
      }
    },
    finances: {
      ...next.corp.finances,
      credits: 150000,
      liabilities: 0,
      assets: 150000,
      dailyRevenue: 0,
      dailyCosts: 0,
      liquidity: 90000,
      liquidityCap: 90000,
      liquidityRegenPerHour: 2800,
      lastLiquidityTick: Date.now(),
      taxRatePct: 14,
      bondYieldPct: 0
    },
    inventory: {},
    mining: {
      silicateExtractor: {
        active: false,
        startedAt: null,
        lastTickAt: null,
        endsAt: null,
        throughputPerHour: 0,
        operationCostPerHour: 0,
        totalMined: 0,
        totalSpent: 0,
        lastCompletedAt: null
      }
    },
    unlocks: {
      marketSectors: ["Raw Materials"],
      maxUpgradeTier: 1,
      maxFleetSize: 8
    },
    investments: [],
    unlockedTech: []
  };

  next.queues = {
    corporateRnD: [],
    ceoInsight: []
  };

  next.playerProfile = {
    isNewPlayer: true,
    registeredAt: Date.now(),
    walkthroughCompleted: false
  };

  evaluateLevelProgress(next);
  ensureCorpMiningModel(next.corp);
  ensureCorpLiquidityModel(next.corp);
  return next;
}

function getSeedState() {
  return {
    world: {
      lawName: "Interstellar Settlement Protocol",
      lawYear: 2147,
      systems: [
        {
          id: "sol",
          name: "Sol",
          gdpIndex: 98,
          pirateDensity: 11,
          activityLevel: 95,
          ownerRule: "No direct ownership. Mining rights are leased.",
          bodies: [
            { id: "earth", name: "Earth", type: "Planet", x: 0, y: 0, radius: 8 },
            { id: "luna", name: "Luna", type: "Moon", x: 26, y: 0, radius: 3 },
            { id: "mars", name: "Mars", type: "Planet", x: 72, y: 0, radius: 6 },
            { id: "belt", name: "Asteroid Belt", type: "Field", x: 120, y: 0, radius: 12 }
          ]
        },
        {
          id: "alpha-centauri",
          name: "Alpha Centauri",
          gdpIndex: 84,
          pirateDensity: 15,
          activityLevel: 77,
          ownerRule: "Neutral authority oversight with corporate lease competition.",
          bodies: [
            { id: "ac-prime", name: "Centauri Prime", type: "Planet", x: 50, y: 0, radius: 7 },
            { id: "ac-ii", name: "Centauri II", type: "Planet", x: 86, y: 0, radius: 5 },
            { id: "ac-haven", name: "Haven", type: "Moon", x: 102, y: 0, radius: 3 },
            { id: "ac-belt", name: "Centauri Belt", type: "Field", x: 126, y: 0, radius: 10 }
          ]
        },
        {
          id: "barnards-star",
          name: "Barnard's Star",
          gdpIndex: 66,
          pirateDensity: 22,
          activityLevel: 59,
          ownerRule: "Frontier charter system with low-regulation extraction rights.",
          bodies: [
            { id: "bn-iron", name: "Ironwell", type: "Planet", x: 48, y: 0, radius: 6 },
            { id: "bn-cinder", name: "Cinder", type: "Planet", x: 82, y: 0, radius: 4 },
            { id: "bn-arc", name: "Arcadia", type: "Moon", x: 103, y: 0, radius: 3 },
            { id: "bn-rift", name: "Rift Debris Ring", type: "Field", x: 132, y: 0, radius: 11 }
          ]
        },
        {
          id: "wolf-359",
          name: "Wolf 359",
          gdpIndex: 58,
          pirateDensity: 31,
          activityLevel: 51,
          ownerRule: "High-risk conflict zone with arbitration-based claims.",
          bodies: [
            { id: "wf-halo", name: "Halo", type: "Planet", x: 44, y: 0, radius: 5 },
            { id: "wf-garnet", name: "Garnet", type: "Planet", x: 77, y: 0, radius: 6 },
            { id: "wf-veil", name: "Veil", type: "Moon", x: 92, y: 0, radius: 3 },
            { id: "wf-shards", name: "Shard Belt", type: "Field", x: 126, y: 0, radius: 10 }
          ]
        },
        {
          id: "tau-ceti",
          name: "Tau Ceti",
          gdpIndex: 71,
          pirateDensity: 18,
          activityLevel: 64,
          ownerRule: "Treaty-governed commercial corridor with tariff controls.",
          bodies: [
            { id: "tc-verde", name: "Verde", type: "Planet", x: 47, y: 0, radius: 7 },
            { id: "tc-lumen", name: "Lumen", type: "Planet", x: 84, y: 0, radius: 5 },
            { id: "tc-aqua", name: "Aqua Minor", type: "Moon", x: 101, y: 0, radius: 3 },
            { id: "tc-cloud", name: "Tau Ice Cloud", type: "Field", x: 128, y: 0, radius: 11 }
          ]
        },
        {
          id: "epsilon-eridani",
          name: "Epsilon Eridani",
          gdpIndex: 62,
          pirateDensity: 25,
          activityLevel: 55,
          ownerRule: "Semi-private jurisdiction with licensed station authorities.",
          bodies: [
            { id: "ee-kestrel", name: "Kestrel", type: "Planet", x: 46, y: 0, radius: 6 },
            { id: "ee-orion", name: "Orion Reach", type: "Planet", x: 78, y: 0, radius: 5 },
            { id: "ee-lyra", name: "Lyra", type: "Moon", x: 95, y: 0, radius: 3 },
            { id: "ee-crown", name: "Crown Belt", type: "Field", x: 124, y: 0, radius: 10 }
          ]
        }
      ],
      resourceCatalog: [
        "Silicates",
        "Helium-3",
        "Nickel",
        "Titanium",
        "Carbon",
        "Water Ice",
        "Rare Earths",
        "Thorium",
        "Hydrogen",
        "Lithium",
        "Cobalt",
        "Uranium",
        "Exotic Matter"
      ],
      refineryChains: [
        {
          id: "silicates-chain",
          input: "Silicates",
          outputs: ["Aerogel", "Quantum Insulators"],
          requiresResearch: ["Material Compression I", "Nano-Lattice Weaving"]
        },
        {
          id: "he3-chain",
          input: "Helium-3",
          outputs: ["Plasma Conduits", "Dark-Matter Capacitors"],
          requiresResearch: ["Containment Physics I", "Exotic Energy Routing"]
        }
      ]
    },
    corp: {
      id: "corp-001",
      ceo: "You",
      corporationName: "ISP Foundry Holdings",
      level: 1,
      levelCap: 40,
      milestonesCompleted: ["HQ Constructed", "First 10 Employees"],
      milestoneRoadmap: [
        ...LEVEL_10_MILESTONE_ROADMAP
      ],
      employeeCap: 100,
      employeeCount: 38,
      buildingSlots: 3,
      buildings: [
        { name: "Headquarters", tier: 1, status: "Operational" },
        { name: "Basic Extractor Yard", tier: 1, status: "Operational" },
        { name: "Refinery Annex", tier: 1, status: "Constructing" }
      ],
      military: {
        lightFighters: 14,
        destroyers: 2,
        siegeEngines: 0,
        attackValue: 284,
        defenseValue: 219,
        modifiers: {
          rdBonusPct: 5,
          ceoLeadershipPct: 3
        }
      },
      finances: {
        credits: 2450000,
        liabilities: 800000,
        assets: 6050000,
        dailyRevenue: 210000,
        dailyCosts: 156000,
        liquidity: 415000,
        liquidityCap: 415000,
        liquidityRegenPerHour: 22000,
        lastLiquidityTick: Date.now(),
        inflationBySystem: {
          Sol: 2.1,
          "Alpha Centauri": 1.8,
          "Barnard's Star": 1.1
        },
        taxRatePct: 14,
        bondYieldPct: 4.8
      },
      inventory: {
        Silicates: 900,
        "Helium-3": 260,
        Titanium: 180
      },
      mining: {
        silicateExtractor: {
          active: false,
          startedAt: null,
          lastTickAt: null,
          endsAt: null,
          throughputPerHour: 0,
          operationCostPerHour: 0,
          totalMined: 0,
          totalSpent: 0,
          lastCompletedAt: null
        }
      },
      unlocks: {
        marketSectors: ["Raw Materials", "Logistics Services"],
        maxUpgradeTier: 2,
        maxFleetSize: 45
      },
      unlockedTech: ["tt-basic-extraction"]
    },
    queues: {
      corporateRnD: [
        {
          id: "rnd-001",
          name: "Material Compression I",
          effect: "+8% refining throughput",
          durationHours: 9,
          startedAt: Date.now() - 2 * 60 * 60 * 1000
        },
        {
          id: "rnd-002",
          name: "Fleet Coordination Matrix",
          effect: "+12 fleet cap",
          durationHours: 16,
          startedAt: null
        }
      ],
      ceoInsight: [
        {
          id: "ceo-001",
          name: "Executive Negotiation Lab",
          effect: "+6% trade spread efficiency",
          durationHours: 6,
          startedAt: Date.now() - 60 * 60 * 1000
        },
        {
          id: "ceo-002",
          name: "Leadership Cohesion Seminar",
          effect: "+4% morale multiplier",
          durationHours: 8,
          startedAt: null
        }
      ]
    },
    market: {
      orderBook: [
        { id: "ord-001", type: "sell", item: "Silicates", quantity: 1200, unitPrice: 58, seller: "Nova Ridge LLC" },
        { id: "ord-002", type: "buy", item: "Helium-3", quantity: 500, unitPrice: 185, buyer: "Tau Vector Inc." }
      ],
      mercenaryContracts: [
        {
          id: "merc-001",
          provider: "Black Orbit Security",
          unitType: "Destroyer Wing",
          strength: 340,
          durationHours: 48,
          ratePerHour: 5200
        }
      ]
    },
    conglomerates: [
      {
        id: "cong-001",
        name: "Helios Combine",
        level: 2,
        memberCount: 5,
        maxMembers: 8,
        pooledResources: {
          credits: 8200000,
          titanium: 14000,
          helium3: 2300
        }
      }
    ],
    forums: {
      categories: [
        "General Discussion",
        "Trading",
        "Conglomerate Recruitment",
        "Off-Topic",
        "Politics & Law",
        "Tutorials & Guides"
      ],
      threads: [
        {
          id: "thr-001",
          category: "Politics & Law",
          title: "Legal strategies against predatory mineral leases",
          author: "LexNova",
          likes: 14,
          createdAt: Date.now() - 18 * 60 * 60 * 1000,
          replies: [
            {
              id: "rep-001",
              author: "Iron Meridian",
              content: "Arbitration timing matters more than filing volume in Sol jurisdiction.",
              likes: 4,
              createdAt: Date.now() - 12 * 60 * 60 * 1000
            }
          ]
        }
      ]
    },
    missions: [
      {
        id: "ms-001",
        title: "Asteroid Belt Distress Relay",
        type: "Rescue",
        risk: "Medium",
        reward: "85,000 Credits + Reputation",
        text: "A civilian tug lost guidance near Belt Sector C. Escort and recover crew.",
        canShiftControl: false
      },
      {
        id: "ms-002",
        title: "Ghost Signal in Barnard Orbit",
        type: "Story",
        risk: "High",
        reward: "Prototype Sensor Grid + Territory Influence",
        text: "Investigate encrypted beacon linked to dormant pirate logistics.",
        canShiftControl: true
      }
    ],
    combatReports: [],
    chatLog: {
      global: [],
      local: [],
      trade: [],
      private: []
    }
  };
}

function ensureStateFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(statePath)) {
    const seed = normalizeStateShape(getSeedState());
    fs.writeFileSync(statePath, JSON.stringify(seed, null, 2), "utf8");
    return seed;
  }

  const raw = fs.readFileSync(statePath, "utf8");
  const parsed = JSON.parse(raw);
  const normalized = normalizeStateShape(parsed);
  fs.writeFileSync(statePath, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

let state = ensureStateFile();
let saveTimer = null;
let accountsSaveTimer = null;

function ensureAccountsFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const seedState = normalizeStateShape(getSeedState());

  if (!fs.existsSync(accountsPath)) {
    const dummyState = createStarterCorporationState(seedState, "Test Director", "Protocol Sandbox Dynamics");
    const seedAccounts = {
      accounts: {
        dummy: {
          id: "dummy",
          email: "dummy@isp.local",
          password: "dummy-password",
          walkthroughCompleted: false,
          state: dummyState
        }
      }
    };

    fs.writeFileSync(accountsPath, JSON.stringify(seedAccounts, null, 2), "utf8");
    return seedAccounts;
  }

  const raw = fs.readFileSync(accountsPath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed.accounts || typeof parsed.accounts !== "object") {
    parsed.accounts = {};
  }

  if (!parsed.accounts.dummy) {
    parsed.accounts.dummy = {
      id: "dummy",
      email: "dummy@isp.local",
      password: "dummy-password",
      walkthroughCompleted: false,
      state: createStarterCorporationState(seedState, "Test Director", "Protocol Sandbox Dynamics")
    };
  }

  Object.values(parsed.accounts).forEach((account) => {
    account.state = normalizeStateShape(account.state || createStarterCorporationState(seedState, "New CEO", "Frontier Protocol Ventures"));
    if (typeof account.walkthroughCompleted !== "boolean") {
      account.walkthroughCompleted = Boolean(account.state.playerProfile?.walkthroughCompleted);
    }
    account.state.playerProfile.walkthroughCompleted = account.walkthroughCompleted;
    evaluateLevelProgress(account.state);
  });

  fs.writeFileSync(accountsPath, JSON.stringify(parsed, null, 2), "utf8");
  return parsed;
}

let accountsStore = ensureAccountsFile();

function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
    saveTimer = null;
  }, 300);
}

function scheduleAccountsSave() {
  if (accountsSaveTimer) {
    clearTimeout(accountsSaveTimer);
  }

  accountsSaveTimer = setTimeout(() => {
    fs.writeFileSync(accountsPath, JSON.stringify(accountsStore, null, 2), "utf8");
    accountsSaveTimer = null;
  }, 300);
}

export function getState() {
  return state;
}

export function mutateState(mutator) {
  mutator(state);
  scheduleSave();
  return state;
}

export function appendChatMessage(channel, message) {
  mutateState((draft) => {
    if (!draft.chatLog[channel]) {
      draft.chatLog[channel] = [];
    }

    draft.chatLog[channel].push(message);

    if (draft.chatLog[channel].length > 120) {
      draft.chatLog[channel] = draft.chatLog[channel].slice(-120);
    }
  });
}

export function createCombatReport(payload) {
  const report = {
    id: `cmb-${Date.now()}`,
    createdAt: Date.now(),
    ...payload
  };

  mutateState((draft) => {
    draft.combatReports.unshift(report);
    draft.combatReports = draft.combatReports.slice(0, 50);
  });

  return report;
}

function sanitizeAccount(account) {
  return {
    id: account.id,
    email: account.email,
    walkthroughCompleted: account.walkthroughCompleted,
    state: deepClone(account.state)
  };
}

export function getAccountById(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  applyMiningOperations(account.state.corp);
  applyLiquidityTick(account.state.corp);
  scheduleAccountsSave();
  return sanitizeAccount(account);
}

export function authenticateAccount(email, password) {
  const account = Object.values(accountsStore.accounts || {}).find(
    (item) => item.email?.toLowerCase() === String(email || "").toLowerCase() && item.password === password
  );

  if (!account) {
    return null;
  }

  applyMiningOperations(account.state.corp);
  applyLiquidityTick(account.state.corp);
  scheduleAccountsSave();

  return sanitizeAccount(account);
}

export function getDummyAccount() {
  applyMiningOperations(accountsStore.accounts.dummy.state.corp);
  applyLiquidityTick(accountsStore.accounts.dummy.state.corp);
  scheduleAccountsSave();
  return sanitizeAccount(accountsStore.accounts.dummy);
}

export function markWalkthroughCompleted(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  account.walkthroughCompleted = true;
  account.state.playerProfile.walkthroughCompleted = true;
  scheduleAccountsSave();
  return sanitizeAccount(account);
}

export function resetWalkthroughCompletion(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  account.walkthroughCompleted = false;
  account.state.playerProfile.walkthroughCompleted = false;
  scheduleAccountsSave();
  return sanitizeAccount(account);
}

export function resetDummyAccountProgress() {
  const dummy = accountsStore.accounts?.dummy;
  if (!dummy) {
    return null;
  }

  const seedState = normalizeStateShape(getSeedState());
  dummy.state = createStarterCorporationState(seedState, "Test Director", "Protocol Sandbox Dynamics");
  dummy.walkthroughCompleted = false;
  dummy.state.playerProfile.walkthroughCompleted = false;

  scheduleAccountsSave();
  return sanitizeAccount(dummy);
}

export function mutateAccountState(accountId, mutator) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  applyMiningOperations(account.state.corp);
  applyLiquidityTick(account.state.corp);
  mutator(account.state);
  applyMiningOperations(account.state.corp);
  ensureCorpMiningModel(account.state.corp);
  ensureCorpLiquidityModel(account.state.corp);
  evaluateLevelProgress(account.state);
  scheduleAccountsSave();
  return sanitizeAccount(account);
}
