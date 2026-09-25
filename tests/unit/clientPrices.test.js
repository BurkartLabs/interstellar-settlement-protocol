import { describe, it, expect } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { clientSources } from "../helpers/clientSource.js";
import { ECONOMY } from "../../server/economy.js";
import { clientPrices } from "../../public/scripts/clientPrices.js";

// AB#1430: the browser quoted and computed hire, payroll, construction and probe prices from its own copies of the
// numbers in data/economy.json, so the first balance change would have shown one price and charged another.
const PRICES = {
  hireCost: ECONOMY.employees.hireCost,
  payrollPerDay: ECONOMY.employees.payrollPerDay,
  extractorYardCost: ECONOMY.buildings.extractorYardCost,
  extractorYardAssetValue: ECONOMY.buildings.extractorYardAssetValue,
  assemblyFacilityCost: ECONOMY.buildings.assemblyFacilityCost,
  refineryCost: ECONOMY.buildings.refineryCost,
  refineryAssetValue: ECONOMY.buildings.refineryAssetValue,
  probeBuildCost: ECONOMY.probes.buildCost
};

describe("the browser's prices come from data/economy.json (AB#1430)", () => {
  it("GET /api/bootstrap sends them, and clientPrices reads each one", async () => {
    const { app } = await getApp();
    const { economy } = (await request(app).get("/api/bootstrap")).body;
    expect(clientPrices(economy)).toEqual(PRICES);
  }, 30_000);

  it("with no economy loaded every price is NaN, never a plausible number", () => {
    for (const [name, value] of Object.entries(clientPrices(undefined))) expect(value, name).toBeNaN();
  });

  it("no client module restates one of them, as a number or as quoted text", () => {
    // A bare number cannot be scanned for (60,000 credits and 60,000 ms look alike), so this matches the shapes the
    // prices were restated in, as server/'s own scan does (tests/unit/economy.test.js): money shown as text, and the
    // code that held a price in a literal.
    const values = [...new Set(Object.values(PRICES))];
    const money = values.map((v) => v.toLocaleString("en-US").replace(",", "[,_]?"));
    const SHAPES = [
      new RegExp(`[$¤](?:${money.join("|")})(?![\\d,])`), // "$2,000", "¤8,000" in copy
      new RegExp(`\\b(?:${money.join("|")}) a day\\b`), // "150 a day"
      /toCurrency\(\d+\)/, // toCurrency(2000)
      /\b(?:buildCost|cost|assetValue|[A-Z_]*COST)\s*=\s*\d/, // const buildCost = 50000
      /\bhired\s*\*\s*\d/, // hired * 2000
      /\*\s*\d+\)?\s*<\/td>|staff\s*\*\s*\d/, // staff * 150
      /\+\s*\d{4,};/ // assets + 36000;
    ];
    const sources = clientSources();
    expect([...sources.keys()]).toContain("public/scripts/walkthrough.js"); // the scan reaches the copy as well as the maths
    const found = [];
    for (const [file, text] of sources) {
      text.split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return; // comments may cite a number
        if (SHAPES.some((shape) => shape.test(line))) found.push(`${file}:${i + 1} ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });
});
