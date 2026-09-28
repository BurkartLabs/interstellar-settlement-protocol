// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ECONOMY } from "../../server/economy.js";
import { appState } from "../../public/scripts/state.js";
import { toCurrency } from "../../public/scripts/helpers.js";
import { renderLeaseManagement, renderOrbitalExecutiveSuites } from "../../public/scripts/views/station.js";

// AB#2314: the game's money is credits, written "¤63,000". toCurrency printed Intl's US dollars, and most of its callers
// added " credits" after it, so the Manage Lease view said "Construction Cost $63,000 credits" beside the construction
// panel's "¤63,000", and a yard's line said "earns $883/hour". Finance, the walkthrough and the how-to page wrote "$"
// by hand. Everything the player reads now says ¤.
const ROOT = process.cwd(); // jsdom: import.meta.url is not a file URL here
const silicates = ECONOMY.npcBuyers.find((b) => b.item === "Silicates");
const textOf = (html) => { const el = document.createElement("div"); el.innerHTML = html; return el.textContent.replace(/\s+/g, " "); };

describe("toCurrency writes credits (AB#2314)", () => {
  it("is the credits sign and a whole, grouped number, rounded as before", () => {
    expect(toCurrency(63000)).toBe("¤63,000");
    expect(toCurrency(883.4)).toBe("¤883");
    expect(toCurrency(0.5)).toBe("¤1");
    expect(toCurrency(0)).toBe("¤0");
    expect(toCurrency(1234567)).toBe("¤1,234,567");
    expect(toCurrency(-1234)).toBe("-¤1,234");
  });
});

describe("the station views show no dollar sign (AB#2314)", () => {
  const extractor = (n) => ({ id: `ext-${n}`, name: `Basic Extractor Yard #${n}`, tier: 1, active: false, leaseId: "lease-1", totalMined: 0, totalSpent: 0 });
  const lease = { id: "lease-1", body: "Earth", resource: "Silicates", buildingSlots: 4, issuedAt: Date.now(), expiresAt: Date.now() + 86400_000 };
  const corp = { unlockedTech: [], buildings: [], offices: [], employeeCount: 5, finances: { credits: 500_000 },
    mining: { silicateExtractors: [extractor(1), extractor(2), extractor(3)] }, miningLeases: [lease] };

  beforeEach(() => {
    appState.economy = { operations: ECONOMY.operations, buildings: ECONOMY.buildings, salesTaxPct: ECONOMY.exchange.salesTaxPct,
      silicateUnitPrice: silicates.unitPrice, silicateBasePrice: silicates.unitPrice, npcBid: ECONOMY.npcBid };
    appState.data = { corp };
  });

  it("Manage Lease: the construction cost, the asset value and every yard's earns, costs and upkeep line", () => {
    const text = textOf(renderLeaseManagement({ name: "ISA Claims & Leases Division", factionCode: "ISA-CL" }, lease, { corp }));
    expect(text).toMatch(/Construction Cost ?¤[\d,]+/);
    expect(text).toMatch(/earns ¤[\d,]+\/hour, costs ¤[\d,]+\/hour/);
    expect(text).toMatch(/including ¤\d+\.\d\d\/hour upkeep/); // the third yard pays upkeep
    expect(text).not.toMatch(/¤[\d,.]+ credits/);
    expect(text).not.toContain("$");
  });

  it("the Orbital Executive Suites: rent and hiring", () => {
    const text = textOf(renderOrbitalExecutiveSuites({ name: "Orbital Executive Suites", factionCode: "OES" }, { corp }));
    expect(text).toMatch(/¤[\d,]+/);
    expect(text).not.toContain("$");
  });
});

// Bug #2498: the Station's Construction and Facilities cards and the Starmap's office rent each wrote the sign by hand
// (constructionPanel.js had its own money()); they go through toCurrency, so a change to it reaches them too.
describe("the Station's cards and the Starmap write credits through toCurrency (Bug #2498)", () => {
  for (const name of ["constructionPanel.js", "stationFacilities.js", "starmap.js"]) {
    it(`${name} builds no credits sign by hand`, () => {
      const src = readFileSync(path.join("public", "scripts", name), "utf8");
      expect(src).not.toMatch(/¤\$\{/);
      expect(src).not.toMatch(/const money\s*=/);
    });
  }
});

describe("no script formats money in dollars (AB#2314)", () => {
  it("has no USD currency style and no \"$\" written before a number", () => {
    const dir = path.join(ROOT, "public/scripts");
    const found = [];
    for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith(".js")) continue;
      const file = path.join(e.parentPath, e.name);
      readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, ""); // comments may talk about dollars
        if (/currency:\s*["']USD["']|\$\$\{|["'`]\$\d/.test(code)) found.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(found).toEqual([]);
  });
});
