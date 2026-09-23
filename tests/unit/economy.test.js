import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { ECONOMY, economyProblems, loadEconomy, buildCostFor, operationCostPerHourFor, startupCostFor } from "../../server/economy.js";
import { officeLeaseCost, officeRenewalCost, OFFICE_TERMS_DAYS } from "../../public/scripts/ceoEffects.js";

// AB#726 (ISP-40): the economy's numbers live in data/economy.json and the server reads them from there. This was a
// move with no value changed, so every value is pinned here to what the code held before the move.

const root = path.resolve(import.meta.dirname, "..", "..");

const BEFORE_THE_MOVE = {
  employees: { hireCost: 2000, payrollPerDay: 150 },                       // server/index.js hire: hired * 2000, hired * 150
  office: { rentPerDay: 1000, termDays: [7, 14, 21, 28] },                  // ceoEffects.js OFFICE_PER_DAY, OFFICE_TERMS_DAYS (Bug #1032)
  buildings: {                                                              // build-extractor routes, build-assembly-facility, build-refinery
    extractorYardCost: 50000, extractorYardAssetValue: 36000, assemblyFacilityCost: 60000, assemblyFacilityAssetValue: 40000,
    refineryCost: 75000, refineryAssetValue: 55000, supplyForecastCostMultiplier: 0.94
  },
  operations: { costPerThroughputUnit: 16, minCostPerHour: 600, startupShareOfHourlyCost: 0.35, minStartupCost: 500, throughputReferencePerHour: 420 },
  probes: { buildCost: 8000, assetValue: 5000 },                            // gameState.js PROBE_BUILD_COST, PROBE_ASSET_VALUE
  expeditions: { launchCost: 3000 },                                        // gameState.js EXPEDITION_LAUNCH_COST
  exchange: { salesTaxPct: 8 },                                             // gameState.js BASE_EXCHANGE_SALES_TAX_PCT
  // AB#718 replaced the flat 2 a unit with a fee by distance; 2 a unit is still the in-system rate.
  logistics: { sameSystemFeePerUnit: 2, perJumpFeePerUnit: 3, sameSystemTransitMinutes: 30, perJumpTransitMinutes: 120 },
  npcBuyers: [                                                              // gameState.js NPC_BUY_SEED
    { item: "Silicates", buyer: "GEX Commodities Authority", unitPrice: 24, dailyQty: 1000000 },
    { item: "Helium-3", buyer: "Lunar Helium Consortium", unitPrice: 92, dailyQty: 250000 },
    { item: "Nickel", buyer: "Belt Refining Cooperative", unitPrice: 18, dailyQty: 750000 },
    { item: "Titanium", buyer: "Olympus Heavy Industries", unitPrice: 64, dailyQty: 400000 },
    { item: "Carbon", buyer: "ISA Materials Exchange", unitPrice: 12, dailyQty: 1500000 },
    { item: "Rare Earths", buyer: "Synthorium Trading House", unitPrice: 140, dailyQty: 120000 }
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

  it("every value is a finite positive number, every buyer is named, and the loaded economy cannot be changed at run time", () => {
    expect(economyProblems(ECONOMY)).toEqual([]);
    expect(Object.isFrozen(ECONOMY)).toBe(true);
    expect(Object.isFrozen(ECONOMY.npcBuyers[0])).toBe(true);
    expect(Object.isFrozen(ECONOMY.office.termDays)).toBe(true);
  });

  it("a file with a zero, a negative, a string, a missing buyer or no buyers is refused at startup", () => {
    const bad = [
      [{ ...BEFORE_THE_MOVE, employees: { hireCost: 0, payrollPerDay: 150 } }, /employees.hireCost/],
      [{ ...BEFORE_THE_MOVE, exchange: { salesTaxPct: -8 } }, /exchange.salesTaxPct/],
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
    const serverDir = path.join(root, "server");
    const found = [];
    for (const file of fs.readdirSync(serverDir).filter((f) => f.endsWith(".js"))) {
      const lines = fs.readFileSync(path.join(serverDir, file), "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const pattern of LEFT_BEHIND) if (pattern.test(line)) found.push(`server/${file}:${i + 1} ${line.trim()}`);
      });
    }
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
