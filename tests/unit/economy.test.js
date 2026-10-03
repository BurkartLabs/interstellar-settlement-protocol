import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { ECONOMY, economyProblems, loadEconomy, buildCostFor, operationCostPerHourFor, startupCostFor, yardMaxTier, yardTierFor, yardUpkeepPerHourFor } from "../../server/economy.js";
import { officeLeaseCost, officeRenewalCost, OFFICE_TERMS_DAYS } from "../../public/scripts/ceoEffects.js";

// AB#726 (ISP-40): the economy's numbers live in data/economy.json and the server reads them from there. This was a
// move with no value changed, so every value is pinned here to what the code held before the move.

const root = path.resolve(import.meta.dirname, "..", "..");

const BEFORE_THE_MOVE = {
  employees: { hireCost: 2000, payrollPerDay: 150 },                       // server/routes/corporation.js hire: hired * 2000, hired * 150
  office: { rentPerDay: 1000, termDays: [7, 14, 21, 28] },                  // ceoEffects.js OFFICE_PER_DAY, OFFICE_TERMS_DAYS (Bug #1032)
  leases: { royaltyPointsByLeasesHeld: { 2: 1, 3: 2, 5: 3 } },              // ISP-302 (AB#2285): new, not moved
  buildings: {                                                              // build-extractor routes, build-assembly-facility, build-refinery
    extractorYardCost: 50000, extractorYardAssetValue: 36000, assemblyFacilityCost: 60000, assemblyFacilityAssetValue: 40000,
    refineryCost: 75000, refineryAssetValue: 55000, supplyForecastCostMultiplier: 0.94,
    extractorYardUpkeepPctPerDay: 2,                                        // ISP-301 (AB#2284): new, not moved
    extractorYardPriceGrowth: 1.25,                                         // ISP-303 (AB#2286): new, not moved
    extractorYardsInStartingKit: 2,                                         // ISP-309 (AB#2305): new, not moved
    assemblyFacilityUpgrades: [                                             // ISP-102 (AB#794): new, not moved
      { toTier: 2, upgradeCost: 30000, assetValue: 21000, offlineHours: 2, fabricationTimePct: 50 },
      { toTier: 3, upgradeCost: 60000, assetValue: 42000, offlineHours: 4, fabricationTimePct: 25, goods: [{ item: "Catalyst Beds", quantity: 20 }] } // ISP-192 (AB#886)
    ],
    refineryUpgrades: [                                                     // ISP-102 (AB#794): tier 3; tier 2 is the Refinery Complex
      { toTier: 3, upgradeCost: 150000, assetValue: 105000, offlineHours: 8, outputMultiplier: 2 },
      { toTier: 4, upgradeCost: 250000, assetValue: 175000, offlineHours: 12, outputMultiplier: 2.5, goods: [{ item: "Superconducting Coils", quantity: 10 }] } // ISP-192 (AB#886)
    ],
    extractorYardUpgrades: [                                                // ISP-101 (AB#793): new, not moved
      { toTier: 2, upgradeCost: 40000, assetValue: 28000, offlineHours: 6, throughputReferencePerHour: 525, throughputCap: 313 },
      { toTier: 3, upgradeCost: 60000, assetValue: 42000, offlineHours: 12, throughputReferencePerHour: 656, throughputCap: 391 },
      { toTier: 4, upgradeCost: 90000, assetValue: 63000, offlineHours: 18, throughputReferencePerHour: 820, throughputCap: 488 },
      { toTier: 5, upgradeCost: 135000, assetValue: 94500, offlineHours: 24, throughputReferencePerHour: 1025, throughputCap: 610 },
      // AB#2308: AB#791's curve continued, x1.25 cap and T_ref, x1.5 price, 70% book value, 6 h more offline a tier.
      { toTier: 6, upgradeCost: 202500, assetValue: 141750, offlineHours: 30, throughputReferencePerHour: 1282, throughputCap: 763 },
      { toTier: 7, upgradeCost: 303750, assetValue: 212625, offlineHours: 36, throughputReferencePerHour: 1602, throughputCap: 954 },
      { toTier: 8, upgradeCost: 455625, assetValue: 318938, offlineHours: 42, throughputReferencePerHour: 2003, throughputCap: 1192 }
    ],
    ferricMiningComplexCost: 90000, ferricMiningComplexAssetValue: 65000,   // ISP-96 (AB#786): new, not moved
    ferricMiningComplexMetalMultiplier: 1.25,
    refineryComplexCost: 100000, refineryComplexAssetValue: 70000,          // ISP-97 (AB#787): new, not moved
    refineryComplexOutputMultiplier: 1.5,
    cryoVaporExtractorArrayCost: 80000, cryoVaporExtractorArrayAssetValue: 58000, // ISP-98 (AB#788): new, not moved
    cryoVaporExtractorArrayMiningMultiplier: 1.2,
    orbitalShipyardCost: 150000, orbitalShipyardAssetValue: 105000, // ISP-170 (AB#864): new, not moved
    synthesisArrayCost: 200000, synthesisArrayAssetValue: 140000 // ISP-189 (AB#883): new, not moved
  },
  operations: { costPerThroughputUnit: 16, minCostPerHour: 600, startupShareOfHourlyCost: 0.35, minStartupCost: 500, throughputReferencePerHour: 420 },
  probes: { buildCost: 8000, assetValue: 5000 },                            // gameState.js PROBE_BUILD_COST, PROBE_ASSET_VALUE
  expeditions: { launchCost: 3000 },                                        // gameState.js EXPEDITION_LAUNCH_COST
  // AB#2329: new, not moved; sized in docs/design/belts.md (AB#1050).
  belts: { reserveStandardExpeditions: 14, respawnChancePerHour: 0.2, rarityStepWeight: 0.25, compositionJitter: 0.25 },
  exchange: { salesTaxPct: 8, maxPriceMultipleOfBid: 5 },                   // gameState.js BASE_EXCHANGE_SALES_TAX_PCT; Bug #4797's line
  // AB#718 replaced the flat 2 a unit with a fee by distance; 2 a unit is still the in-system rate.
  logistics: { sameSystemFeePerUnit: 2, perJumpFeePerUnit: 3, sameSystemTransitMinutes: 30, perJumpTransitMinutes: 120 },
  // ISP-297 (AB#1789, AB#1741): the Salvage Assignment, ECONOMY.md "The way back from broke".
  // AB#4689 (docs/design/desk-work.md section 7, accepted in Decision AB#4704): new, not moved.
  desk: {
    openPackets: 3, payByTier: [40, 80, 160], pointsByTier: [1, 2, 3], paidAssignmentsPerDay: 20, overCapPayPct: 25,
    surveyNoisePctByTier: [15, 30, 45], surveyReserveTolerancePct: 20, auditCleanSharePct: 30, auditTwoClauseSharePct: 50,
    dispatchTolerancePct: 5, contractPoints: 10, reputationThresholdMultiplier: 10
  },
  salvage: { creditsThreshold: 3000, hoursRequired: 4, payoutCredits: 3000, cooldownHours: 8 },
  npcBid: { quotaPerDay: 7000, driftAtFullQuotaPct: 50, recoveryPerDayPct: 60, floorPct: 55 }, // ISP-87
  npcAsks: { askMultiple: 1.5, dailyQty: [{ item: "Silicates", qty: 3000 }, { item: "Helium-3", qty: 40 }, { item: "Nickel", qty: 300 }, { item: "Titanium", qty: 80 }, { item: "Carbon", qty: 400 }, { item: "Rare Earths", qty: 40 }] }, // ISP-122 (AB#815)
  npcBuyers: [                                                              // gameState.js NPC_BUY_SEED
    { item: "Silicates", buyer: "GEX Commodities Authority", unitPrice: 24, dailyQty: 1000000 },
    { item: "Helium-3", buyer: "Lunar Helium Consortium", unitPrice: 92, dailyQty: 250000 },
    { item: "Nickel", buyer: "Belt Refining Cooperative", unitPrice: 18, dailyQty: 750000 },
    { item: "Titanium", buyer: "Olympus Heavy Industries", unitPrice: 64, dailyQty: 400000 },
    { item: "Carbon", buyer: "ISA Materials Exchange", unitPrice: 12, dailyQty: 1500000 },
    { item: "Rare Earths", buyer: "Synthorium Trading House", unitPrice: 140, dailyQty: 120000 },
    // AB#2341: the six products no track story owns, base from docs/design/tier3-recipes.md section 4, a day of one
    // Refinery's output as the quantity (the design's per-product quota, for when npcBidFor takes one).
    { item: "Aerogel", buyer: "Meridian Glassworks", unitPrice: 41, dailyQty: 240 },
    { item: "Quantum Insulators", buyer: "Meridian Glassworks", unitPrice: 74, dailyQty: 90 },
    { item: "Armour Plating", buyer: "Olympus Heavy Industries", unitPrice: 118, dailyQty: 103 },
    { item: "Precision Frames", buyer: "Olympus Heavy Industries", unitPrice: 94, dailyQty: 86 },
    { item: "Carbon Fibre Sheets", buyer: "Tycho Carbon Works", unitPrice: 21, dailyQty: 480 },
    { item: "Graphene Lattice", buyer: "Tycho Carbon Works", unitPrice: 37, dailyQty: 180 },
    // AB#830: new, not moved. The Fuel track's bids (docs/design/tier3-recipes.md section 4): raw items at the raw
    // quota of 7,000; products at a day of one Refinery's output, which the bid does not read yet.
    { item: "Deuterium", buyer: "Lunar Helium Consortium", unitPrice: 40, dailyQty: 7000 },
    { item: "Water Ice", buyer: "Lunar Helium Consortium", unitPrice: 8, dailyQty: 7000 },
    { item: "Hydrogen", buyer: "Lunar Helium Consortium", unitPrice: 6, dailyQty: 7000 },
    { item: "Plasma Conduits", buyer: "Lunar Helium Consortium", unitPrice: 159, dailyQty: 80 },
    { item: "Dark-Matter Capacitors", buyer: "Lunar Helium Consortium", unitPrice: 423, dailyQty: 20 },
    { item: "Fusion Pellets", buyer: "Lunar Helium Consortium", unitPrice: 198, dailyQty: 160 },
    { item: "Cryogenic Coolant", buyer: "Lunar Helium Consortium", unitPrice: 54, dailyQty: 360 },
    // AB#832: the Rare Metals track's bids (tier3-recipes.md section 4), all to Synthorium Trading House.
    { item: "Thorium", buyer: "Synthorium Trading House", unitPrice: 160, dailyQty: 7000 },
    { item: "Cobalt", buyer: "Synthorium Trading House", unitPrice: 110, dailyQty: 7000 },
    { item: "Sensor Arrays", buyer: "Synthorium Trading House", unitPrice: 215, dailyQty: 54 },
    { item: "Catalyst Substrates", buyer: "Synthorium Trading House", unitPrice: 215, dailyQty: 36 },
    { item: "Rare-Earth Magnets", buyer: "Synthorium Trading House", unitPrice: 276, dailyQty: 120 },
    { item: "Thorium Fuel Rods", buyer: "Synthorium Trading House", unitPrice: 552, dailyQty: 30 },
    // AB#833: the Light Metals track's, on the same rule.
    { item: "Lithium", buyer: "Synthorium Trading House", unitPrice: 70, dailyQty: 7000 },
    { item: "Bauxite", buyer: "Belt Refining Cooperative", unitPrice: 14, dailyQty: 7000 },
    { item: "Aluminium Ingots", buyer: "Olympus Heavy Industries", unitPrice: 64, dailyQty: 240 },
    { item: "Aluminium-Lithium Alloy", buyer: "Olympus Heavy Industries", unitPrice: 114, dailyQty: 160 },
    { item: "Battery Cells", buyer: "Synthorium Trading House", unitPrice: 123, dailyQty: 120 },
    // AB#831: the Nickel-Iron track's raw item and products (docs/design/tier3-recipes.md section 4).
    { item: "Iron Ore", buyer: "Belt Refining Cooperative", unitPrice: 10, dailyQty: 7000 },
    { item: "Nickel-Iron Alloy", buyer: "Belt Refining Cooperative", unitPrice: 35, dailyQty: 384 },
    { item: "Pressure Vessels", buyer: "Olympus Heavy Industries", unitPrice: 129, dailyQty: 100 },
    { item: "Structural Alloys", buyer: "Belt Refining Cooperative", unitPrice: 25, dailyQty: 288 },
    { item: "Magnetic Cores", buyer: "Belt Refining Cooperative", unitPrice: 50, dailyQty: 96 },
    // AB#834: the cross-track products (docs/design/tier3-recipes.md section 4).
    { item: "Fusion Reactor Cores", buyer: "Lunar Helium Consortium", unitPrice: 2243, dailyQty: 8 },
    { item: "Compact Fission Modules", buyer: "Synthorium Trading House", unitPrice: 932, dailyQty: 12 },
    { item: "Lightweight Spaceframes", buyer: "Olympus Heavy Industries", unitPrice: 451, dailyQty: 30 },
    { item: "Ion Thrusters", buyer: "Olympus Heavy Industries", unitPrice: 1283, dailyQty: 12 },
    // AB#884: the Tier 4 bids, docs/design/v0.11-tier4.md section 3
    { item: "Uranium", buyer: "Synthorium Trading House", unitPrice: 220, dailyQty: 7000 },
    { item: "Exotic Matter", buyer: "ISA Materials Exchange", unitPrice: 900, dailyQty: 7000 },
    { item: "Platinum-Group Metals", buyer: "Olympus Heavy Industries", unitPrice: 400, dailyQty: 7000 },
    { item: "Metallic Hydrogen", buyer: "Lunar Helium Consortium", unitPrice: 260, dailyQty: 7000 },
    { item: "Antimatter", buyer: "ISA Materials Exchange", unitPrice: 4865, dailyQty: 4 }, // Bug AB#4663: 2 a day before the 12 h cycle
    { item: "Superconducting Coils", buyer: "Synthorium Trading House", unitPrice: 1481, dailyQty: 12 },
    { item: "Field Emitters", buyer: "ISA Materials Exchange", unitPrice: 1833, dailyQty: 6 },
    { item: "Breeder Reactor Cores", buyer: "Synthorium Trading House", unitPrice: 2708, dailyQty: 6 },
    { item: "Antimatter Drives", buyer: "Olympus Heavy Industries", unitPrice: 4869, dailyQty: 4 },
    { item: "Catalyst Beds", buyer: "Belt Refining Cooperative", unitPrice: 1125, dailyQty: 15 }
  ]
};

describe("data/economy.json (AB#726)", () => {
  it("holds every value the code held before the move, unchanged", () => {
    expect(ECONOMY).toEqual(BEFORE_THE_MOVE);
  });

  it("the rules the server applies with them give the prices the balance pass set", () => {
    expect(buildCostFor(50000, false)).toBe(50000);
    expect(buildCostFor(50000, true)).toBe(47000);
    // ISP-86: the running cost curves — base x T x (1 + (T / T_ref)^2) — so that the throughput a player sets is
    // a decision. Under the floor it is still the floor; at the top of the range it is half again the straight
    // line it replaced (4,000 -> 5,417), which is what makes the top of the range a real cost. T_ref was chosen
    // against the probe, not by eye: at 500 a researched corporation kept 98% of the best profit at the top of
    // the range, and at 350 the always-maximum bot went bankrupt inside a week.
    expect(operationCostPerHourFor(10)).toBe(600);
    expect(operationCostPerHourFor(40)).toBe(646);
    expect(operationCostPerHourFor(250)).toBe(5417);
    expect(startupCostFor(600)).toBe(500);
    expect(startupCostFor(4000)).toBe(1400);
  });

  // ISP-301 (AB#2284), ECONOMY.md "Sinks that scale with income" sink 1. Chosen, not derived: the Board has not seen it.
  // ISP-308 (AB#2304, the Director's ruling on AB#2287): the first two yards, a new lease's starting kit, are free; where
  // that line falls is a balance call the Board has not seen either.
  it("a corporation's first two yards cost what they did at every throughput, and each later yard exactly 41.67 an hour more", () => {
    const { minCostPerHour, costPerThroughputUnit, throughputReferencePerHour } = ECONOMY.operations;
    const before = (t) => Math.max(minCostPerHour, Math.round(t * costPerThroughputUnit * (1 + (t / throughputReferencePerHour) ** 2)));
    expect(ECONOMY.buildings.extractorYardsInStartingKit).toBe(2);
    expect(yardUpkeepPerHourFor(0)).toBe(0);
    expect(yardUpkeepPerHourFor(1)).toBe(0);
    expect(yardUpkeepPerHourFor(2)).toBe(41.67);
    expect(yardUpkeepPerHourFor(5)).toBe(41.67);
    expect(yardUpkeepPerHourFor(-1)).toBe(0);
    for (let t = 10; t <= 250; t += 1) {
      expect(operationCostPerHourFor(t), `default, ${t} t/h`).toBe(before(t));
      expect(operationCostPerHourFor(t, undefined, { yardIndex: 0 }), `first yard, ${t} t/h`).toBe(before(t));
      expect(operationCostPerHourFor(t, undefined, { yardIndex: 1 }), `second yard, ${t} t/h`).toBe(before(t));
      expect(operationCostPerHourFor(t, undefined, { yardIndex: 2 }) - before(t), `third yard, ${t} t/h`).toBeCloseTo(41.67, 10);
      expect(operationCostPerHourFor(t, undefined, { yardIndex: 3 }) - before(t), `fourth yard, ${t} t/h`).toBeCloseTo(41.67, 10);
    }
  });

  it("a one-lease, two-yard corporation, the starting kit, pays no upkeep at any throughput; the line follows the key", () => {
    for (const yardIndex of [0, 1]) {
      for (let t = 10; t <= 250; t += 1) expect(yardUpkeepPerHourFor(yardIndex), `yard ${yardIndex + 1}, ${t} t/h`).toBe(0);
    }
    const oneFree = { ...ECONOMY.buildings, extractorYardsInStartingKit: 1 };
    expect(yardUpkeepPerHourFor(1, oneFree)).toBe(41.67);
    const threeFree = { ...ECONOMY.buildings, extractorYardsInStartingKit: 3 };
    expect(yardUpkeepPerHourFor(2, threeFree)).toBe(0);
    expect(yardUpkeepPerHourFor(3, threeFree)).toBe(41.67);
  });

  it("every value is a finite positive number, every buyer is named, and the loaded economy cannot be changed at run time", () => {
    expect(economyProblems(ECONOMY)).toEqual([]);
    expect(Object.isFrozen(ECONOMY)).toBe(true);
    expect(Object.isFrozen(ECONOMY.npcBuyers[0])).toBe(true);
    expect(Object.isFrozen(ECONOMY.office.termDays)).toBe(true);
  });

  it("a file with a zero, a negative, a string, a missing buyer or no buyers is refused at startup", () => {
    const bad = [
      [{ ...BEFORE_THE_MOVE, employees: { hireCost: 0, payrollPerDay: 150 } }, /employees.hireCost/],
      [{ ...BEFORE_THE_MOVE, exchange: { salesTaxPct: -8, maxPriceMultipleOfBid: 5 } }, /exchange.salesTaxPct/],
      [{ ...BEFORE_THE_MOVE, probes: { buildCost: "8000", assetValue: 5000 } }, /probes.buildCost/],
      [{ ...BEFORE_THE_MOVE, office: { rentPerDay: 1000, termDays: [7, null] } }, /office.termDays.1/],
      [{ ...BEFORE_THE_MOVE, npcBuyers: [{ item: "Carbon", unitPrice: 12, dailyQty: 5 }] }, /npcBuyers.0 needs an item and a buyer/],
      [{ ...BEFORE_THE_MOVE, npcBuyers: [] }, /at least one buyer/]
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-economy-"));
    try {
      for (const [economy, message] of bad) {
        const file = path.join(dir, "economy.json");
        fs.writeFileSync(file, JSON.stringify(economy));
        expect(() => loadEconomy(file)).toThrow(message);
      }
      fs.writeFileSync(path.join(dir, "broken.json"), "{ not json");
      expect(() => loadEconomy(path.join(dir, "broken.json"))).toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no numeric literal for these constants is left in server/", () => {
    const LEFT_BEHIND = [
      /\bEXPEDITION_LAUNCH_COST\s*=\s*\d/,
      /\bPROBE_BUILD_COST\s*=\s*\d/,
      /\bPROBE_ASSET_VALUE\s*=\s*\d/,
      /\bBASE_EXCHANGE_SALES_TAX_PCT\s*=\s*\d/,
      /\bBASE_BUILD_COST\s*=\s*\d/,
      /\bASSET_VALUE\s*=\s*\d/,
      /\bBUILD_COST\s*=\s*\d/,
      /\bVALID_DURATIONS\s*=\s*\[/,
      /\bNPC_BUY_SEED\s*=\s*\[/,
      /\bLOGISTICS_FEE_PER_UNIT\s*=\s*\d/,
      /\bhired\s*\*\s*\d/,
      /\bdurationDays\s*\*\s*1000\b/,
      /\bthroughput\w*\s*\*\s*16\b/,
      /\*\s*0\.35\b/,
      /\*\s*0\.94\b/,
      /Math\.round\(50000/,
      /"GEX Commodities Authority"/
    ];
    // server/*.js and, since AB#1815 moved the route handlers there, server/routes/*.js.
    const files = ["server", "server/routes"].flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js")).map((f) => `${d}/${f}`));
    const found = [];
    for (const file of files) {
      const lines = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const pattern of LEFT_BEHIND) if (pattern.test(line)) found.push(`${file}:${i + 1} ${line.trim()}`);
      });
    }
    expect(files).toContain("server/routes/corporation.js"); // the scan reaches the handlers it is meant to police
    expect(found).toEqual([]);
  });

  it("the prices the browser also computes, in modules it shares with the server, agree with the file", () => {
    // ceoEffects.js is loaded by the browser as well, which cannot read data/, so the office price and terms (Bug #1032's
    // single source for the Suites panel and the server) keep their own copy there. This test fails the moment that
    // copy drifts from data/economy.json. (The transfer rates are sent to the browser instead, AB#718.)
    expect(OFFICE_TERMS_DAYS).toEqual(ECONOMY.office.termDays);
    for (const days of ECONOMY.office.termDays) {
      expect(officeLeaseCost(days)).toBe(days * ECONOMY.office.rentPerDay);
      expect(officeRenewalCost([], days)).toBe(days * ECONOMY.office.rentPerDay);
    }
  });
});

describe("the yard's tier count (AB#2308)", () => {
  it("is read from the table: tiers 6 to 8 in data/economy.json make yardMaxTier() 8", () => {
    expect(yardMaxTier()).toBe(8);
    expect(yardTierFor(8).throughputCap).toBe(1192);
  });
});
