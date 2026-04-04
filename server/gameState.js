import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "..", "data");
const statePath = path.join(dataDir, "state.json");
const accountsPath = path.join(dataDir, "accounts.json");
const PASSWORD_SALT_ROUNDS = 10;

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const SYSTEM_DETAILS = {
  sol: {
    ownerRule: "No direct ownership. Mining rights are leased.",
    bodies: [
      { id: "mercury", name: "Mercury", type: "Planet", x: 58, y: 0, radius: 4 },
      { id: "venus", name: "Venus", type: "Planet", x: 90, y: 0, radius: 6 },
      { id: "earth", name: "Earth", type: "Planet", x: 122, y: 0, radius: 7 },
      { id: "mars", name: "Mars", type: "Planet", x: 156, y: 0, radius: 5 },
      { id: "belt", name: "Asteroid Belt", type: "Field", x: 196, y: 0, radius: 13 },
      { id: "jupiter", name: "Jupiter", type: "Planet", x: 238, y: 0, radius: 12 },
      { id: "saturn", name: "Saturn", type: "Planet", x: 284, y: 0, radius: 11 },
      { id: "uranus", name: "Uranus", type: "Planet", x: 326, y: 0, radius: 9 },
      { id: "neptune", name: "Neptune", type: "Planet", x: 366, y: 0, radius: 9 },
      { id: "luna", name: "Luna", type: "Moon", parentId: "earth", x: 0, y: 0, radius: 2 },
      { id: "phobos", name: "Phobos", type: "Moon", parentId: "mars", x: 0, y: 0, radius: 2 },
      { id: "deimos", name: "Deimos", type: "Moon", parentId: "mars", x: 0, y: 0, radius: 2 },
      { id: "io", name: "Io", type: "Moon", parentId: "jupiter", x: 0, y: 0, radius: 2 },
      { id: "europa", name: "Europa", type: "Moon", parentId: "jupiter", x: 0, y: 0, radius: 2 },
      { id: "ganymede", name: "Ganymede", type: "Moon", parentId: "jupiter", x: 0, y: 0, radius: 3 },
      { id: "callisto", name: "Callisto", type: "Moon", parentId: "jupiter", x: 0, y: 0, radius: 3 },
      { id: "titan", name: "Titan", type: "Moon", parentId: "saturn", x: 0, y: 0, radius: 3 },
      { id: "enceladus", name: "Enceladus", type: "Moon", parentId: "saturn", x: 0, y: 0, radius: 2 }
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
  "Rent an Office",
  "Hire 5 Employees",
  "Reached Corporation Level 1",
  "Purchase a Mining Lease on Mars",
  "Build a Basic Extractor Yard",
  "Mine 300 Silicate",
  "Reached Corporation Level 2",
  "Sell 300 Silicate on the Galactic Exchange",
  "Research Basic Extraction Analytics",
  "Reached Corporation Level 3",
  "Build a Second Extractor Yard",
  "Hire 10 Employees",
  "Research Industrial Safety Protocols",
  "Sell 50,000 Silicate",
  "Reached Corporation Level 4",
  "Research High-Density Energy Routing",
  "Purchase a Second Mining Lease",
  "Build a Third Extractor Yard",
  "Hire 15 Employees",
  "Reached Corporation Level 5",
  "Research Ferric Core Extraction Facility",
  "Hire 25 Employees",
  "Build a Ferric Mining Complex",
  "Reached Corporation Level 6",
  "Research Multi-Stage Refinery Protocols",
  "Build a Refinery Complex",
  "Reached Corporation Level 7",
  "Manufacture 5,000 Iron-Silicate Alloys",
  "Complete 25 Missions",
  "Reached Corporation Level 8",
  "Research Cryo-genic Vapor Extraction Theory",
  "Purchase a Mining Claim on Luna",
  "Build a Cryo-vapor Extractor Array",
  "Sell 500 Cryo-Silicate Foam",
  "Sell 500 Hydrated Ferric Compounds",
  "Reached Corporation Level 9",
  "Research Carbonaceous Slurry Recovery Theory",
  "Purchase a Mining Claim on an Asteroid Belt",
  "Research Asteroid Belt Mining Protocols",
  "Start a Belt Mining Operation",
  "Sell 500 Carbon Silicate Composites",
  "Sell 500 Carbo-Iron Alloys",
  "Sell 500 Hydro-Carbon Emulsion Base",
  "Research Extrasolar Expansion Protocols",
  "Reached Corporation Level 10"
];

function normalizeSystems(systems = []) {
  return systems.map((system) => {
    const defaults = SYSTEM_DETAILS[system.id];
    if (!defaults) {
      return system;
    }

    const isOutdatedSolCatalog =
      system.id === "sol" && (!Array.isArray(system.bodies) || system.bodies.length < 10);

    return {
      ...system,
      ownerRule: system.ownerRule || defaults.ownerRule,
      bodies: isOutdatedSolCatalog
        ? defaults.bodies
        : Array.isArray(system.bodies) && system.bodies.length
          ? system.bodies
          : defaults.bodies
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

  if (!rawState.corp.location) {
    rawState.corp.location = "Earth";
  }

  if (!Array.isArray(rawState.corp.milestonesCompleted)) {
    rawState.corp.milestonesCompleted = [];
  }

  if (!Array.isArray(rawState.corp.milestoneRoadmap)) {
    rawState.corp.milestoneRoadmap = [];
  }

  if (!Array.isArray(rawState.corp.offices)) {
    rawState.corp.offices = [];
  }

  if (!Array.isArray(rawState.corp.miningLeases)) {
    rawState.corp.miningLeases = [];
  }

  if (!Array.isArray(rawState.corp.tradeHistory)) {
    rawState.corp.tradeHistory = [];
  }

  // Normalize each lease: ensure extractorIds array exists
  rawState.corp.miningLeases = rawState.corp.miningLeases.map((l) => ({
    ...l,
    extractorIds: Array.isArray(l.extractorIds) ? l.extractorIds : []
  }));

  rawState.corp.milestoneRoadmap = LEVEL_10_MILESTONE_ROADMAP.slice();

  return rawState;
}

function ensureCorpMiningModel(corp) {
  if (!corp.mining || typeof corp.mining !== "object") {
    corp.mining = {};
  }

  if (!Array.isArray(corp.mining.silicateExtractors)) {
    corp.mining.silicateExtractors = [];
  }

  // Migrate legacy single extractor model into the multi-extractor array only if it has real data.
  const legacyExtractor = corp.mining.silicateExtractor;
  const legacyHasData = Boolean(
    legacyExtractor &&
      (legacyExtractor.active ||
        Number(legacyExtractor.totalMined || 0) > 0 ||
        Number(legacyExtractor.totalSpent || 0) > 0 ||
        Number(legacyExtractor.throughputPerHour || 0) > 0 ||
        legacyExtractor.startedAt ||
        legacyExtractor.endsAt)
  );

  if (legacyHasData && !corp.mining.silicateExtractors.length) {
    corp.mining.silicateExtractors.push({
      id: "ext-basic-1",
      name: "Basic Extractor Yard #1",
      tier: 1,
      ...legacyExtractor
    });
  }

  const builtExtractorCount = (corp.buildings || []).filter((b) => b.name === "Basic Extractor Yard").length;
  while (corp.mining.silicateExtractors.length < builtExtractorCount) {
    const nextIndex = corp.mining.silicateExtractors.length + 1;
    corp.mining.silicateExtractors.push({
      id: `ext-basic-${nextIndex}`,
      name: `Basic Extractor Yard #${nextIndex}`,
      tier: 1,
      active: false,
      startedAt: null,
      lastTickAt: null,
      endsAt: null,
      throughputPerHour: 0,
      operationCostPerHour: 0,
      totalMined: 0,
      totalSpent: 0,
      lastCompletedAt: null
    });
  }

  corp.mining.silicateExtractors = corp.mining.silicateExtractors.map((extractor, index) => {
    const normalized = {
      id: String(extractor.id || `ext-basic-${index + 1}`),
      name: String(extractor.name || `Basic Extractor Yard #${index + 1}`),
      tier: Number(extractor.tier || 1),
      active: Boolean(extractor.active),
      startedAt: extractor.startedAt || null,
      lastTickAt: extractor.lastTickAt || null,
      endsAt: extractor.endsAt || null,
      throughputPerHour: Number(extractor.throughputPerHour || 0),
      operationCostPerHour: Number(extractor.operationCostPerHour || 0),
      totalMined: Number(extractor.totalMined || 0),
      totalSpent: Number(extractor.totalSpent || 0),
      lastCompletedAt: extractor.lastCompletedAt || null,
      leaseId: extractor.leaseId || null
    };
    return normalized;
  });

  // Legacy compatibility surface for existing frontend code paths.
  corp.mining.silicateExtractor = corp.mining.silicateExtractors[0] || {
    id: "ext-basic-0",
    name: "Basic Extractor Yard #0",
    tier: 1,
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

  if (!corp.unlocks || typeof corp.unlocks !== "object") {
    corp.unlocks = {};
  }
  if (typeof corp.unlocks.maxBasicExtractorYards !== "number") {
    corp.unlocks.maxBasicExtractorYards = 1;
  }
}

function stopExtractorCycle(extractor, timestamp) {
  extractor.active = false;
  extractor.endsAt = timestamp;
  extractor.lastTickAt = timestamp;
  extractor.lastCompletedAt = timestamp;
}

function applyMiningOperations(corp, now = Date.now()) {
  ensureCorpMiningModel(corp);

  const extractors = corp.mining.silicateExtractors || [];
  extractors.forEach((extractor) => {
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
      affordabilityRatio = Math.max(0, Math.min(1, byCredits));
    }

    const actualMined = Math.floor(projectedMined * affordabilityRatio);
    const actualCost = Math.round(projectedCost * affordabilityRatio);

    if (actualCost > 0) {
      corp.finances.credits = Math.max(0, corp.finances.credits - actualCost);
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
  });

  corp.mining.silicateExtractor = extractors[0];
}

function deepClone(input) {
  return JSON.parse(JSON.stringify(input));
}

function reqIdToMilestoneName(reqId) {
  const map = {
    officeRented: "Rent an Office",
    hire5: "Hire 5 Employees",
    marsLease: "Purchase a Mining Lease on Mars",
    extractor: "Build a Basic Extractor Yard",
    mine300: "Mine 300 Silicate",
    sell300Silicate: "Sell 300 Silicate on the Galactic Exchange",
    researchBasicExtraction: "Research Basic Extraction Analytics",
    extractor2: "Build a Second Extractor Yard",
    hire10: "Hire 10 Employees",
    researchIndustrialSafety: "Research Industrial Safety Protocols",
    sell50000Silicate: "Sell 50,000 Silicate",
    researchEnergyRouting: "Research High-Density Energy Routing",
    secondLease: "Purchase a Second Mining Lease",
    extractor3: "Build a Third Extractor Yard",
    hire15: "Hire 15 Employees",
    researchFerricCore: "Research Ferric Core Extraction Facility",
    hire25: "Hire 25 Employees",
    ferricMiningComplex: "Build a Ferric Mining Complex",
    researchMultiStageRefinery: "Research Multi-Stage Refinery Protocols",
    refineryComplex: "Build a Refinery Complex",
    manufacture5000Alloys: "Manufacture 5,000 Iron-Silicate Alloys",
    missions25: "Complete 25 Missions",
    researchCryoVapor: "Research Cryo-genic Vapor Extraction Theory",
    lunaLease: "Purchase a Mining Claim on Luna",
    cryoExtractorArray: "Build a Cryo-vapor Extractor Array",
    sell500CryoFoam: "Sell 500 Cryo-Silicate Foam",
    sell500HydratedFerric: "Sell 500 Hydrated Ferric Compounds",
    researchCarbonSlurry: "Research Carbonaceous Slurry Recovery Theory",
    asteroidBeltLease: "Purchase a Mining Claim on an Asteroid Belt",
    researchBeltMining: "Research Asteroid Belt Mining Protocols",
    beltMiningOp: "Start a Belt Mining Operation",
    sell500CarbonSilicate: "Sell 500 Carbon Silicate Composites",
    sell500CarboIron: "Sell 500 Carbo-Iron Alloys",
    sell500HydroCarbon: "Sell 500 Hydro-Carbon Emulsion Base",
    researchExtrasolar: "Research Extrasolar Expansion Protocols"
  };
  return map[reqId] || reqId;
}

function createRequirement(id, title, progress, target) {
  return {
    id,
    title,
    progress,
    target,
    complete: Number(progress || 0) >= Number(target || 0)
  };
}

function evaluateLevelProgress(profileState) {
  const corp = profileState.corp;
  const buildings = corp.buildings || [];
  const unlockedTech = corp.unlockedTech || [];
  const stats = corp.stats || {};
  const miningLeases = corp.miningLeases || [];
  const extractorTotalMined = (corp?.mining?.silicateExtractors || [])
    .reduce((sum, ex) => sum + Number(ex?.totalMined || 0), 0);
  const hasBuilding = (name) => buildings.some((b) => b.name === name);
  const buildingCount = (name) => buildings.filter((b) => b.name === name).length;
  const hasTech = (id) => unlockedTech.includes(id);

  const level1Requirements = [
    createRequirement("officeRented", "Rent an Office", corp.officeRented ? 1 : 0, 1),
    createRequirement("hire5", "Hire 5 Employees", Number(corp.employeeCount || 0), 5)
  ];

  const level2Requirements = [
    createRequirement("marsLease", "Purchase a Mining Lease on Mars", miningLeases.some((l) => (l.body || l) === "Mars") ? 1 : 0, 1),
    createRequirement("extractor", "Build a Basic Extractor Yard", hasBuilding("Basic Extractor Yard") ? 1 : 0, 1),
    createRequirement("mine300", "Mine 300 Silicate", extractorTotalMined, 300)
  ];

  const level3Requirements = [
    createRequirement("sell300Silicate", "Sell 300 Silicate on the Galactic Exchange", Number(stats.silicateSoldOnExchange || 0), 300),
    createRequirement("researchBasicExtraction", "Research Basic Extraction Analytics", hasTech("tt-basic-extraction") ? 1 : 0, 1)
  ];

  const level4Requirements = [
    createRequirement("extractor2", "Build a Second Extractor Yard", buildingCount("Basic Extractor Yard"), 2),
    createRequirement("hire10", "Hire 10 Employees", Number(corp.employeeCount || 0), 10),
    createRequirement("researchIndustrialSafety", "Research Industrial Safety Protocols", hasTech("tt-industrial-safety") ? 1 : 0, 1),
    createRequirement("sell50000Silicate", "Sell 50,000 Silicate", Number(stats.silicateSoldOnExchange || 0), 50000)
  ];

  const level5Requirements = [
    createRequirement("researchEnergyRouting", "Research High-Density Energy Routing", hasTech("tt-energy-routing") ? 1 : 0, 1),
    createRequirement("secondLease", "Purchase a Second Mining Lease", Math.min(miningLeases.length, 2), 2),
    createRequirement("extractor3", "Build a Third Extractor Yard", buildingCount("Basic Extractor Yard"), 3),
    createRequirement("hire15", "Hire 15 Employees", Number(corp.employeeCount || 0), 15)
  ];

  const level6Requirements = [
    createRequirement("researchFerricCore", "Research Ferric Core Extraction Facility", hasTech("tt-ferric-core-extraction") ? 1 : 0, 1),
    createRequirement("hire25", "Hire 25 Employees", Number(corp.employeeCount || 0), 25),
    createRequirement("ferricMiningComplex", "Build a Ferric Mining Complex", hasBuilding("Ferric Mining Complex") ? 1 : 0, 1)
  ];

  const level7Requirements = [
    createRequirement("researchMultiStageRefinery", "Research Multi-Stage Refinery Protocols", hasTech("tt-multi-stage-refinery") ? 1 : 0, 1),
    createRequirement("refineryComplex", "Build a Refinery Complex", hasBuilding("Refinery Complex") ? 1 : 0, 1)
  ];

  const level8Requirements = [
    createRequirement("manufacture5000Alloys", "Manufacture 5,000 Iron-Silicate Alloys", Number(stats.ironSilicateAlloysManufactured || 0), 5000),
    createRequirement("missions25", "Complete 25 Missions", Number(stats.missionsCompleted || 0), 25)
  ];

  const level9Requirements = [
    createRequirement("researchCryoVapor", "Research Cryo-genic Vapor Extraction Theory", hasTech("tt-cryo-vapor-extraction") ? 1 : 0, 1),
    createRequirement("lunaLease", "Purchase a Mining Claim on Luna", miningLeases.some((l) => (l.body || l) === "Luna") ? 1 : 0, 1),
    createRequirement("cryoExtractorArray", "Build a Cryo-vapor Extractor Array", hasBuilding("Cryo-vapor Extractor Array") ? 1 : 0, 1),
    createRequirement("sell500CryoFoam", "Sell 500 Cryo-Silicate Foam", Number(stats.cryoSilicateFoamSold || 0), 500),
    createRequirement("sell500HydratedFerric", "Sell 500 Hydrated Ferric Compounds", Number(stats.hydratedFerricCompoundsSold || 0), 500)
  ];

  const level10Requirements = [
    createRequirement("researchCarbonSlurry", "Research Carbonaceous Slurry Recovery Theory", hasTech("tt-carbonaceous-slurry-recovery") ? 1 : 0, 1),
    createRequirement("asteroidBeltLease", "Purchase a Mining Claim on an Asteroid Belt", miningLeases.some((l) => (l.type || l) === "Asteroid Belt") ? 1 : 0, 1),
    createRequirement("researchBeltMining", "Research Asteroid Belt Mining Protocols", hasTech("tt-asteroid-belt-mining") ? 1 : 0, 1),
    createRequirement("beltMiningOp", "Start a Belt Mining Operation", Number(stats.beltMiningOperationsStarted || 0), 1),
    createRequirement("sell500CarbonSilicate", "Sell 500 Carbon Silicate Composites", Number(stats.carbonSilicateCompositesSold || 0), 500),
    createRequirement("sell500CarboIron", "Sell 500 Carbo-Iron Alloys", Number(stats.carboIronAlloysSold || 0), 500),
    createRequirement("sell500HydroCarbon", "Sell 500 Hydro-Carbon Emulsion Base", Number(stats.hydroCarbonEmulsionBaseSold || 0), 500),
    createRequirement("researchExtrasolar", "Research Extrasolar Expansion Protocols", hasTech("tt-extrasolar-expansion") ? 1 : 0, 1)
  ];

  corp.levelProgress = {
    level1: { requirements: level1Requirements, allCompleted: level1Requirements.every((req) => req.complete) },
    level2: { requirements: level2Requirements, allCompleted: level2Requirements.every((req) => req.complete) },
    level3: { requirements: level3Requirements, allCompleted: level3Requirements.every((req) => req.complete) },
    level4: { requirements: level4Requirements, allCompleted: level4Requirements.every((req) => req.complete) },
    level5: { requirements: level5Requirements, allCompleted: level5Requirements.every((req) => req.complete) },
    level6: { requirements: level6Requirements, allCompleted: level6Requirements.every((req) => req.complete) },
    level7: { requirements: level7Requirements, allCompleted: level7Requirements.every((req) => req.complete) },
    level8: { requirements: level8Requirements, allCompleted: level8Requirements.every((req) => req.complete) },
    level9: { requirements: level9Requirements, allCompleted: level9Requirements.every((req) => req.complete) },
    level10: { requirements: level10Requirements, allCompleted: level10Requirements.every((req) => req.complete) }
  };

  const allRequirements = [
    ...level1Requirements, ...level2Requirements, ...level3Requirements,
    ...level4Requirements, ...level5Requirements, ...level6Requirements,
    ...level7Requirements, ...level8Requirements, ...level9Requirements,
    ...level10Requirements
  ];

  allRequirements.forEach((req) => {
    const milestoneName = reqIdToMilestoneName(req.id);
    if (req.complete && !corp.milestonesCompleted.includes(milestoneName)) {
      corp.milestonesCompleted.push(milestoneName);
    }
  });

  if (corp.level < 1 && corp.levelProgress.level1.allCompleted) {
    corp.level = 1;
    if (!corp.milestonesCompleted.includes("Reached Corporation Level 1")) {
      corp.milestonesCompleted.push("Reached Corporation Level 1");
    }
    corp.employeeCap = Math.max(corp.employeeCap, 20);
    corp.buildingSlots = Math.max(corp.buildingSlots, 2);
    corp.unlocks.maxFleetSize = Math.max(corp.unlocks.maxFleetSize, 8);
    if (!corp.unlocks.marketSectors.includes("Raw Materials")) {
      corp.unlocks.marketSectors.push("Raw Materials");
    }
  }

  if (corp.level < 2 && corp.levelProgress.level2.allCompleted) {
    corp.level = 2;
    if (!corp.milestonesCompleted.includes("Reached Corporation Level 2")) {
      corp.milestonesCompleted.push("Reached Corporation Level 2");
    }
    corp.employeeCap = Math.max(corp.employeeCap, 30);
    corp.buildingSlots = Math.max(corp.buildingSlots, 3);
    corp.unlocks.maxFleetSize = Math.max(corp.unlocks.maxFleetSize, 14);
    if (!corp.unlocks.marketSectors.includes("Logistics Services")) {
      corp.unlocks.marketSectors.push("Logistics Services");
    }
  }

  if (corp.level < 3 && corp.levelProgress.level3.allCompleted) {
    corp.level = 3;
    if (!corp.milestonesCompleted.includes("Reached Corporation Level 3")) {
      corp.milestonesCompleted.push("Reached Corporation Level 3");
    }
    corp.employeeCap = Math.max(corp.employeeCap, 45);
    corp.buildingSlots = Math.max(corp.buildingSlots, 4);
    corp.unlocks.maxFleetSize = Math.max(corp.unlocks.maxFleetSize, 22);
  }

  if (corp.level < 4 && corp.levelProgress.level4.allCompleted) {
    corp.level = 4;
    if (!corp.milestonesCompleted.includes("Reached Corporation Level 4")) {
      corp.milestonesCompleted.push("Reached Corporation Level 4");
    }
    corp.employeeCap = Math.max(corp.employeeCap, 60);
    corp.buildingSlots = Math.max(corp.buildingSlots, 5);
    corp.unlocks.maxFleetSize = Math.max(corp.unlocks.maxFleetSize, 30);
    if (!corp.unlocks.marketSectors.includes("Refined Goods")) {
      corp.unlocks.marketSectors.push("Refined Goods");
    }
  }

  if (corp.level < 5 && corp.levelProgress.level5.allCompleted) {
    corp.level = 5;
    if (!corp.milestonesCompleted.includes("Reached Corporation Level 5")) {
      corp.milestonesCompleted.push("Reached Corporation Level 5");
    }
    corp.employeeCap = Math.max(corp.employeeCap, 80);
    corp.buildingSlots = Math.max(corp.buildingSlots, 6);
    corp.unlocks.maxFleetSize = Math.max(corp.unlocks.maxFleetSize, 40);
    if (!corp.unlocks.marketSectors.includes("Industrial Goods")) {
      corp.unlocks.marketSectors.push("Industrial Goods");
    }
  }

  if (corp.level < 6 && corp.levelProgress.level6.allCompleted) {
    corp.level = 6;
    if (!corp.milestonesCompleted.includes("Reached Corporation Level 6")) {
      corp.milestonesCompleted.push("Reached Corporation Level 6");
    }
    corp.employeeCap = Math.max(corp.employeeCap, 100);
    corp.buildingSlots = Math.max(corp.buildingSlots, 7);
    corp.unlocks.maxFleetSize = Math.max(corp.unlocks.maxFleetSize, 55);
    if (!corp.unlocks.marketSectors.includes("Advanced Materials")) {
      corp.unlocks.marketSectors.push("Advanced Materials");
    }
  }

  if (corp.level < 7 && corp.levelProgress.level7.allCompleted) {
    corp.level = 7;
    if (!corp.milestonesCompleted.includes("Reached Corporation Level 7")) {
      corp.milestonesCompleted.push("Reached Corporation Level 7");
    }
    corp.employeeCap = Math.max(corp.employeeCap, 120);
    corp.buildingSlots = Math.max(corp.buildingSlots, 8);
    corp.unlocks.maxFleetSize = Math.max(corp.unlocks.maxFleetSize, 70);
  }

  if (corp.level < 8 && corp.levelProgress.level8.allCompleted) {
    corp.level = 8;
    if (!corp.milestonesCompleted.includes("Reached Corporation Level 8")) {
      corp.milestonesCompleted.push("Reached Corporation Level 8");
    }
    corp.employeeCap = Math.max(corp.employeeCap, 145);
    corp.buildingSlots = Math.max(corp.buildingSlots, 9);
    corp.unlocks.maxFleetSize = Math.max(corp.unlocks.maxFleetSize, 90);
  }

  if (corp.level < 9 && corp.levelProgress.level9.allCompleted) {
    corp.level = 9;
    if (!corp.milestonesCompleted.includes("Reached Corporation Level 9")) {
      corp.milestonesCompleted.push("Reached Corporation Level 9");
    }
    corp.employeeCap = Math.max(corp.employeeCap, 170);
    corp.buildingSlots = Math.max(corp.buildingSlots, 10);
    corp.unlocks.maxFleetSize = Math.max(corp.unlocks.maxFleetSize, 110);
    if (!corp.unlocks.marketSectors.includes("Military Contracts")) {
      corp.unlocks.marketSectors.push("Military Contracts");
    }
  }

  if (corp.level < 10 && corp.levelProgress.level10.allCompleted) {
    corp.level = 10;
    if (!corp.milestonesCompleted.includes("Reached Corporation Level 10")) {
      corp.milestonesCompleted.push("Reached Corporation Level 10");
    }
    corp.employeeCap = Math.max(corp.employeeCap, 200);
    corp.buildingSlots = Math.max(corp.buildingSlots, 12);
    corp.unlocks.maxFleetSize = Math.max(corp.unlocks.maxFleetSize, 140);
    if (!corp.unlocks.marketSectors.includes("Sovereign Infrastructure")) {
      corp.unlocks.marketSectors.push("Sovereign Infrastructure");
    }
  }
}

function createStarterCorporationState(baseState, ceoName, corpName) {
  const next = deepClone(baseState);

  next.corp = {
    ...next.corp,
    ceo: ceoName,
    corporationName: corpName,
    location: "Earth",
    level: 0,
    levelCap: 40,
    milestonesCompleted: [],
    milestoneRoadmap: [
      ...LEVEL_10_MILESTONE_ROADMAP
    ],
    employeeCap: 8,
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
      taxRatePct: 14,
      bondYieldPct: 0
    },
    inventory: {},
    mining: {
      silicateExtractors: [],
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
      marketSectors: [],
      maxUpgradeTier: 1,
      maxFleetSize: 0,
      maxBasicExtractorYards: 1
    },
    investments: [],
    unlockedTech: [],
    offices: [],
    miningLeases: [],
    tradeHistory: []
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
            { id: "mercury", name: "Mercury", type: "Planet", x: 58, y: 0, radius: 4 },
            { id: "venus", name: "Venus", type: "Planet", x: 90, y: 0, radius: 6 },
            { id: "earth", name: "Earth", type: "Planet", x: 122, y: 0, radius: 7 },
            { id: "mars", name: "Mars", type: "Planet", x: 156, y: 0, radius: 5 },
            { id: "belt", name: "Asteroid Belt", type: "Field", x: 196, y: 0, radius: 13 },
            { id: "jupiter", name: "Jupiter", type: "Planet", x: 238, y: 0, radius: 12 },
            { id: "saturn", name: "Saturn", type: "Planet", x: 284, y: 0, radius: 11 },
            { id: "uranus", name: "Uranus", type: "Planet", x: 326, y: 0, radius: 9 },
            { id: "neptune", name: "Neptune", type: "Planet", x: 366, y: 0, radius: 9 },
            { id: "luna", name: "Luna", type: "Moon", parentId: "earth", x: 0, y: 0, radius: 2 },
            { id: "phobos", name: "Phobos", type: "Moon", parentId: "mars", x: 0, y: 0, radius: 2 },
            { id: "deimos", name: "Deimos", type: "Moon", parentId: "mars", x: 0, y: 0, radius: 2 },
            { id: "io", name: "Io", type: "Moon", parentId: "jupiter", x: 0, y: 0, radius: 2 },
            { id: "europa", name: "Europa", type: "Moon", parentId: "jupiter", x: 0, y: 0, radius: 2 },
            { id: "ganymede", name: "Ganymede", type: "Moon", parentId: "jupiter", x: 0, y: 0, radius: 3 },
            { id: "callisto", name: "Callisto", type: "Moon", parentId: "jupiter", x: 0, y: 0, radius: 3 },
            { id: "titan", name: "Titan", type: "Moon", parentId: "saturn", x: 0, y: 0, radius: 3 },
            { id: "enceladus", name: "Enceladus", type: "Moon", parentId: "saturn", x: 0, y: 0, radius: 2 }
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
        silicateExtractors: [
          {
            id: "ext-basic-1",
            name: "Basic Extractor Yard #1",
            tier: 1,
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
        ],
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
        maxFleetSize: 45,
        maxBasicExtractorYards: 3
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
      npcBuyOrders: [
        {
          id: "npc-buy-silicates-daily",
          item: "Silicates",
          buyer: "GEX Commodities Authority",
          unitPrice: 8,
          totalQtyPerDay: 1000000,
          remainingQty: 1000000,
          lastResetDate: ""
        }
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

  // Ensure NPC buy orders exist in global market state
  if (!normalized.market) normalized.market = {};
  if (!Array.isArray(normalized.market.npcBuyOrders)) {
    normalized.market.npcBuyOrders = [
      {
        id: "npc-buy-silicates-daily",
        item: "Silicates",
        buyer: "GEX Commodities Authority",
        unitPrice: 8,
        totalQtyPerDay: 1000000,
        remainingQty: 1000000,
        lastResetDate: ""
      }
    ];
  }

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
          passwordHash: bcrypt.hashSync("dummy-password", PASSWORD_SALT_ROUNDS),
          createdAt: Date.now(),
          refreshTokens: [],
          notifications: [],
          walkthroughCompleted: false,
          state: dummyState
        }
      }
    };

    try { fs.writeFileSync(accountsPath, JSON.stringify(seedAccounts, null, 2), "utf8"); } catch (e) { console.warn("[warn] Could not write accounts file on init:", e.code); }
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
      passwordHash: bcrypt.hashSync("dummy-password", PASSWORD_SALT_ROUNDS),
      createdAt: Date.now(),
      refreshTokens: [],
      notifications: [],
      walkthroughCompleted: false,
      state: createStarterCorporationState(seedState, "Test Director", "Protocol Sandbox Dynamics")
    };
  }

  Object.values(parsed.accounts).forEach((account) => {
    if (!account.id) {
      account.id = createId("acc");
    }

    account.email = String(account.email || "").toLowerCase();

    if (!account.passwordHash) {
      const legacyPassword = String(account.password || "dummy-password");
      account.passwordHash = bcrypt.hashSync(legacyPassword, PASSWORD_SALT_ROUNDS);
    }

    if (account.password) {
      delete account.password;
    }

    if (typeof account.createdAt !== "number") {
      account.createdAt = Date.now();
    }

    if (!Array.isArray(account.refreshTokens)) {
      account.refreshTokens = [];
    }

    if (!Array.isArray(account.notifications)) {
      account.notifications = [];
    }

    if (!Array.isArray(account.messages)) {
      account.messages = [];
    }

    account.state = normalizeStateShape(account.state || createStarterCorporationState(seedState, "New CEO", "Frontier Protocol Ventures"));
    if (typeof account.walkthroughCompleted !== "boolean") {
      account.walkthroughCompleted = Boolean(account.state.playerProfile?.walkthroughCompleted);
    }
    account.state.playerProfile.walkthroughCompleted = account.walkthroughCompleted;
    evaluateLevelProgress(account.state);
  });

  // On startup: normalize dummy account state to pick up any new fields, but preserve
  // all progress and active sessions. Progress and tokens are only reset on explicit request.
  if (parsed.accounts.dummy) {
    if (parsed.accounts.dummy.state) {
      parsed.accounts.dummy.state = normalizeStateShape(parsed.accounts.dummy.state);
      evaluateLevelProgress(parsed.accounts.dummy.state);
    }
  }

  try { fs.writeFileSync(accountsPath, JSON.stringify(parsed, null, 2), "utf8"); } catch (e) { console.warn("[warn] Could not write accounts file on init:", e.code); }
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

export function saveAccountsNow() {
  if (accountsSaveTimer) {
    clearTimeout(accountsSaveTimer);
    accountsSaveTimer = null;
  }
  fs.writeFileSync(accountsPath, JSON.stringify(accountsStore, null, 2), "utf8");
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

export function resetChatHistory() {
  mutateState((draft) => {
    draft.chatLog = {
      global: [],
      local: [],
      trade: [],
      private: []
    };
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
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt || null,
    walkthroughCompleted: account.walkthroughCompleted,
    state: deepClone(account.state)
  };
}

function sanitizeNotification(notification) {
  return {
    id: notification.id,
    accountId: notification.accountId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    createdAt: notification.createdAt,
    readAt: notification.readAt || null
  };
}

function pushSystemNotification(account, payload) {
  if (!account.notifications) {
    account.notifications = [];
  }

  account.notifications.unshift({
    id: createId("ntf"),
    accountId: account.id,
    type: payload.type || "system",
    title: payload.title || "Notification",
    body: payload.body || "",
    createdAt: Date.now(),
    readAt: null
  });

  account.notifications = account.notifications.slice(0, 120);
}

export function getAccountById(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  applyMiningOperations(account.state.corp);
  evaluateLevelProgress(account.state);
  scheduleAccountsSave();
  return sanitizeAccount(account);
}

export function authenticateAccount(email, password) {
  const account = Object.values(accountsStore.accounts || {}).find(
    (item) => item.email?.toLowerCase() === String(email || "").toLowerCase()
  );

  if (!account) {
    return null;
  }

  const isValidPassword = bcrypt.compareSync(String(password || ""), String(account.passwordHash || ""));
  if (!isValidPassword) {
    return null;
  }

  applyMiningOperations(account.state.corp);
  account.lastLoginAt = Date.now();
  pushSystemNotification(account, {
    type: "auth",
    title: "Secure Access Granted",
    body: "Authentication successful. Welcome back to command."
  });
  scheduleAccountsSave();

  return sanitizeAccount(account);
}

export function createAccount({ email, password, ceoName, corpName }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return { error: "A valid email is required." };
  }

  if (normalizedPassword.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const existing = Object.values(accountsStore.accounts || {}).find((item) => item.email === normalizedEmail);
  if (existing) {
    return { error: "An account with this email already exists." };
  }

  const accountId = createId("acc");
  const seedState = normalizeStateShape(getSeedState());
  const nextState = createStarterCorporationState(
    seedState,
    String(ceoName || "New CEO").trim() || "New CEO",
    String(corpName || "Frontier Protocol Ventures").trim() || "Frontier Protocol Ventures"
  );

  const account = {
    id: accountId,
    email: normalizedEmail,
    passwordHash: bcrypt.hashSync(normalizedPassword, PASSWORD_SALT_ROUNDS),
    walkthroughCompleted: false,
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
    refreshTokens: [],
    notifications: [],
    messages: [],
    state: nextState
  };

  pushSystemNotification(account, {
    type: "system",
    title: "Corporation Registered",
    body: "Your corporation charter is now active under the Interstellar Settlement Protocol."
  });

  pushSystemMessage(account, {
    subject: `ISA Settlement Licence — Ref. ISP-2147-${accountId.toUpperCase()}-AUTH`,
    fromName: "Interstellar Settlement Authority",
    body:
      `To the registered CEO of ${String(corpName || "Frontier Protocol Ventures").trim()},\n\n` +
      `Your corporation has been assessed and approved under the provisions of the Interstellar Settlement Protocol (Earth Assembly Act, 2147).\n\n` +
      `This licence grants your corporation the legal right to:\n` +
      `  — Establish a registered operational presence at any ISA-recognised station\n` +
      `  — Apply for extraction rights across approved bodies within the Sol system\n` +
      `  — Engage in commerce on the Galactic Exchange under your registered charter\n\n` +
      `Your first recommended action is to secure office space at Earth Station Prime. Enclosed is your Founding Charter reference number for all future ISA correspondence.\n\n` +
      `Founding Charter Ref: ISP/${accountId.toUpperCase()}/FC-001\n\n` +
      `Liaison Officer Aria Voss\nInterstellar Settlement Authority — Sol Division`
  });

  accountsStore.accounts[accountId] = account;
  scheduleAccountsSave();

  return { account: sanitizeAccount(account) };
}

export function listAccountNotifications(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  const notifications = (account.notifications || []).map(sanitizeNotification);
  return {
    notifications,
    unreadCount: notifications.filter((item) => !item.readAt).length
  };
}

export function addAccountNotification(accountId, payload) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  pushSystemNotification(account, payload);
  scheduleAccountsSave();
  return sanitizeNotification(account.notifications[0]);
}

export function markNotificationRead(accountId, notificationId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  const target = (account.notifications || []).find((item) => item.id === notificationId);
  if (!target) {
    return null;
  }

  if (!target.readAt) {
    target.readAt = Date.now();
    scheduleAccountsSave();
  }

  return sanitizeNotification(target);
}

export function markAllNotificationsRead(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  const now = Date.now();
  (account.notifications || []).forEach((item) => {
    if (!item.readAt) {
      item.readAt = now;
    }
  });

  scheduleAccountsSave();
  return listAccountNotifications(accountId);
}

// ─── Messaging ───────────────────────────────────────────────────────────────

const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function pushSystemMessage(account, { subject, body, fromName = "ISA System" }) {
  if (!Array.isArray(account.messages)) account.messages = [];
  account.messages.unshift({
    id: createId("msg"),
    fromType: "system",
    fromId: "system",
    fromName,
    toAccountId: account.id,
    toName: account.state?.corp?.corporationName || "",
    subject,
    body,
    sentAt: Date.now(),
    readAt: null,
    folder: "inbox",
    trashedAt: null
  });
}

function purgeExpiredTrash(account) {
  const cutoff = Date.now() - TRASH_TTL_MS;
  account.messages = (account.messages || []).filter(
    (m) => m.folder !== "trash" || Number(m.trashedAt || 0) > cutoff
  );
}

export function listAccountMessages(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  purgeExpiredTrash(account);
  scheduleAccountsSave();
  return (account.messages || []).map((m) => ({ ...m }));
}

export function markMessageRead(accountId, messageId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  const msg = (account.messages || []).find((m) => m.id === messageId);
  if (!msg) return null;
  if (!msg.readAt) {
    msg.readAt = Date.now();
    scheduleAccountsSave();
  }
  return { ...msg };
}

export function moveMessage(accountId, messageId, folder) {
  const validFolders = ["inbox", "archive", "trash"];
  if (!validFolders.includes(folder)) return null;
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  const msg = (account.messages || []).find((m) => m.id === messageId);
  if (!msg) return null;
  msg.folder = folder;
  if (folder === "trash") msg.trashedAt = Date.now();
  else msg.trashedAt = null;
  scheduleAccountsSave();
  return { ...msg };
}

export function sendPlayerMessage(fromAccountId, { toCorpName, subject, body }) {
  const sender = accountsStore.accounts?.[fromAccountId];
  if (!sender) return { error: "Sender not found." };

  const normalizedTarget = String(toCorpName || "").trim().toLowerCase();
  if (!normalizedTarget) return { error: "Recipient corporation name is required." };

  const recipient = Object.values(accountsStore.accounts || {}).find(
    (a) => a.id !== fromAccountId && String(a.state?.corp?.corporationName || "").trim().toLowerCase() === normalizedTarget
  );
  if (!recipient) return { error: `No corporation found matching \"${toCorpName}\".` };

  const trimmedSubject = String(subject || "").trim().slice(0, 200) || "(no subject)";
  const trimmedBody = String(body || "").trim().slice(0, 8000);
  if (!trimmedBody) return { error: "Message body cannot be empty." };

  const sentAt = Date.now();
  const fromName = sender.state?.corp?.corporationName || sender.email;
  const toName = recipient.state?.corp?.corporationName || "";

  // Delivered copy in recipient inbox
  if (!Array.isArray(recipient.messages)) recipient.messages = [];
  recipient.messages.unshift({
    id: createId("msg"),
    fromType: "player",
    fromId: fromAccountId,
    fromName,
    toAccountId: recipient.id,
    toName,
    subject: trimmedSubject,
    body: trimmedBody,
    sentAt,
    readAt: null,
    folder: "inbox",
    trashedAt: null
  });

  // Sent copy in sender outbox
  if (!Array.isArray(sender.messages)) sender.messages = [];
  sender.messages.unshift({
    id: createId("msg"),
    fromType: "player",
    fromId: fromAccountId,
    fromName,
    toAccountId: recipient.id,
    toName,
    subject: trimmedSubject,
    body: trimmedBody,
    sentAt,
    readAt: sentAt,
    folder: "sent",
    trashedAt: null
  });

  scheduleAccountsSave();
  return { ok: true, toName };
}

export function saveDraft(accountId, { draftId, toCorpName, subject, body }) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  if (!Array.isArray(account.messages)) account.messages = [];

  if (draftId) {
    const existing = account.messages.find((m) => m.id === draftId && m.folder === "draft");
    if (existing) {
      existing.toCorpName = String(toCorpName || "").trim();
      existing.subject = String(subject || "").trim().slice(0, 200);
      existing.body = String(body || "").trim().slice(0, 8000);
      existing.updatedAt = Date.now();
      scheduleAccountsSave();
      return { ...existing };
    }
  }

  const draft = {
    id: createId("msg"),
    fromType: "player",
    fromId: accountId,
    fromName: account.state?.corp?.corporationName || "",
    toAccountId: null,
    toCorpName: String(toCorpName || "").trim(),
    toName: "",
    subject: String(subject || "").trim().slice(0, 200),
    body: String(body || "").trim().slice(0, 8000),
    sentAt: Date.now(),
    readAt: Date.now(),
    folder: "draft",
    trashedAt: null
  };
  account.messages.unshift(draft);
  scheduleAccountsSave();
  return { ...draft };
}

export function deleteDraft(accountId, draftId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return false;
  const before = (account.messages || []).length;
  account.messages = (account.messages || []).filter((m) => !(m.id === draftId && m.folder === "draft"));
  if (account.messages.length !== before) {
    scheduleAccountsSave();
    return true;
  }
  return false;
}

export function addSystemMessageToAccount(accountId, { subject, body, fromName = "ISA System" }) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  pushSystemMessage(account, { subject, body, fromName });
  scheduleAccountsSave();
  return (account.messages || [])[0];
}

export function accountExists(accountId) {
  return Boolean(accountsStore.accounts?.[accountId]);
}

export function storeRefreshToken(accountId, token, expiresAt) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return false;
  }

  if (!Array.isArray(account.refreshTokens)) {
    account.refreshTokens = [];
  }

  account.refreshTokens.push({ token, expiresAt: Number(expiresAt || 0) });
  account.refreshTokens = account.refreshTokens
    .filter((item) => item.expiresAt > Date.now())
    .slice(-10);
  scheduleAccountsSave();
  return true;
}

export function revokeRefreshToken(accountId, token) {
  const account = accountsStore.accounts?.[accountId];
  if (!account || !Array.isArray(account.refreshTokens)) {
    return false;
  }

  const before = account.refreshTokens.length;
  account.refreshTokens = account.refreshTokens.filter((item) => item.token !== token);
  if (account.refreshTokens.length !== before) {
    scheduleAccountsSave();
    return true;
  }

  return false;
}

export function hasRefreshToken(accountId, token) {
  const account = accountsStore.accounts?.[accountId];
  if (!account || !Array.isArray(account.refreshTokens)) {
    return false;
  }

  const now = Date.now();
  account.refreshTokens = account.refreshTokens.filter((item) => item.expiresAt > now);
  return account.refreshTokens.some((item) => item.token === token);
}

export function getDummyAccount() {
  applyMiningOperations(accountsStore.accounts.dummy.state.corp);
  evaluateLevelProgress(accountsStore.accounts.dummy.state);
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
  dummy.notifications = [];
  dummy.messages = [];
  dummy.walkthroughCompleted = false;
  dummy.state.playerProfile.walkthroughCompleted = false;

  // Strip any market sell orders belonging to the dummy account from global state
  const dummyId = dummy.id;
  state.market.orderBook = (state.market.orderBook || []).filter(
    (order) => order.type !== "sell" || order.sellerAccountId !== dummyId
  );
  scheduleSave();

  scheduleAccountsSave();
  return sanitizeAccount(dummy);
}

export function mutateAccountState(accountId, mutator) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  applyMiningOperations(account.state.corp);
  mutator(account.state);
  applyMiningOperations(account.state.corp);
  ensureCorpMiningModel(account.state.corp);
  evaluateLevelProgress(account.state);
  scheduleAccountsSave();
  return sanitizeAccount(account);
}
