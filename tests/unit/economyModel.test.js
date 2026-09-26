import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_RULES, computeModel, leaseCatalog, modelText, bidDay, steadyBidDay } from "../../scripts/economy-model.mjs";
import { economyNumbers, operationCostPerHourFor, startupCostFor, bestThroughputFor, npcBidFor, npcBidAfterRecovery } from "../../server/economy.js";
import { EMPLOYEES_PER_LEASE } from "../../public/scripts/leaseStaffing.js";

// AB#727: ECONOMY.md explains every key of data/economy.json and quotes the model; this keeps both true.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const economy = JSON.parse(read("data/economy.json"));
const doc = read("ECONOMY.md").replace(/\r\n/g, "\n");

describe("ECONOMY.md (AB#727)", () => {
  it("lists every key in data/economy.json, and no key the file does not have", () => {
    // Array positions fold into their list: office.termDays.0 is office.termDays, npcBuyers.2.unitPrice is npcBuyers.unitPrice.
    const keys = [...new Set(economyNumbers(economy).map(([k]) => k.split(".").filter((p) => !/^\d+$/.test(p)).join(".")))];
    const listed = [...doc.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
    expect(listed.sort()).toEqual(keys.sort());
    for (const b of economy.npcBuyers) expect(doc, b.item).toContain(`${b.item} ${b.unitPrice}`);
  });

  it("quotes exactly what npm run economy:model prints", () => {
    const quoted = doc.match(/<!-- economy-model:start -->\n```text\n([\s\S]*?)\n```\n<!-- economy-model:end -->/)?.[1];
    expect(quoted).toBe(modelText().trimEnd());
  });

  it("says it is a model, states T-018, and cites the prior art", () => {
    expect(doc).toContain("It is a model, not play");
    expect(doc).toContain("24 x T x 0.92");
    expect(doc).toMatch(/Virtual Economic Theory: How MMOs Really Work/);
  });

  it("npm run economy:model is the script", () => {
    expect(JSON.parse(read("package.json")).scripts["economy:model"]).toBe("node scripts/economy-model.mjs");
  });
});

/** Every line of server source, as one string: a rule counts wherever in server/ it now lives (AB#1719). */
function serverSource() {
  const root = path.join(process.cwd(), "server");
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.push(full);
    }
  };
  walk(root);
  return files.map((f) => fs.readFileSync(f, "utf8")).join(String.fromCharCode(10));
}

describe("the model reads the game, not a copy of it (AB#727)", () => {
  it("each rule taken from the code still says what the model assumes", () => {
    // AB#1719: these rules used to live in server/gameState.js, which AB#737 split into server/game/*.js. Reading
    // the whole of server/ instead of two named files means the next split moves the code without darkening this
    // guard — which is the only thing standing between ECONOMY.md and the code drifting apart.
    const server = serverSource();
    for (const rule of [
      /credits: 250000/,
      /currentStationId: "earth-station-prime"/,
      /Math\.max\(10, Math\.min\(throughputCap, amount\)\)/, // AB#793: the yard's tier cap
      /export const BASE_THROUGHPUT_CAP = 250;/, // ... which is 250 at tier 1, the model's yard
      /hours, \{ fallback: 24, min: 1, max: 72 \}/,
      /let probPerSec = 0\.00005;/,
      /const RECOVERY_PROB_PER_SEC = 0\.000276;/, // AB#2296: now module constants in server/game/mining.js
      /const MIN_DOWNTIME_MS = 15 \* 60 \* 1000;/,
      /buildingSlots: 2,\s+extractorIds: \[\]/ // AB#2334: a new lease's two slots, the model's yards per lease
    ]) {
      expect(server, String(rule)).toMatch(rule);
    }
    expect(CODE_RULES.startingCredits.value).toBe(250_000);
    // AB#1202: staff per lease is a module the lease route imports, so the model is checked against its value.
    expect(CODE_RULES.employeesPerLease.value).toBe(EMPLOYEES_PER_LEASE);
  });

  it("the path and the payback follow from the numbers", () => {
    const m = computeModel(economy, leaseCatalog());
    expect(m.lease).toEqual({ name: "Earth", cost: 20_000 });
    expect(m.steps.map((s) => s.cost)).toEqual([7_000, 10_000, 20_000, 50_000]);
    expect(m.credits).toBe(163_000);
    const [t10, t100, t250] = m.rows;
    expect(t10.perHourIdeal).toBeLessThan(0);
    expect(t10.paybackIdeal).toBe(Infinity);
    // AB#775's curve, not the pre-fix straight line: 250 t/h no longer pays back fastest — it barely pays back at
    // all under perfect play, and loses once real downtime (perHourExpected) is counted (AB#1754).
    expect(t250.perHourExpected).toBeLessThan(0);
    expect(t250.paybackExpected).toBe(Infinity);
    expect(t100.paybackIdeal).toBeLessThan(t250.paybackIdeal);
    // The best real setting sits well under the cap, which is the point of the curve (T-018).
    expect(m.best.throughput).toBeLessThan(250);
    expect(m.best.profitPerHour).toBeGreaterThan(t250.perHourIdeal);
  });

  it("never disagrees with server/economy.js for the same inputs — the class of drift AB#1754 was", () => {
    for (const t of [10, 40, 100, 146, 250]) {
      const cost = operationCostPerHourFor(t, economy.operations);
      expect(cost, `cost at ${t} t/h`).toBe(operationCostPerHourFor(t));
      expect(startupCostFor(cost, economy.operations), `startup at ${t} t/h`).toBe(startupCostFor(cost));
    }
    const silicates = economy.npcBuyers.find((b) => b.item === "Silicates");
    const best = bestThroughputFor({ unitPrice: silicates.unitPrice, taxPct: economy.exchange.salesTaxPct, min: 10, max: 250 });
    const m = computeModel(economy, leaseCatalog());
    expect(m.flatBest).toEqual(best); // AB#2334: the flat-price figure, kept for comparison
  });

  it("a margin at or below zero makes every setting lose, and the model says never", () => {
    const worse = { ...economy, operations: { ...economy.operations, costPerThroughputUnit: 23 } };
    const m = computeModel(worse, leaseCatalog());
    expect(m.rows.every((r) => r.paybackIdeal === Infinity)).toBe(true);
    expect(m.best.profitPerHour).toBeLessThan(0);
  });
});

// AB#2334: the model priced every tonne at the flat base bid; it sells along the standing bid now (ISP-87).
describe("the model sells along the standing bid (AB#2334)", () => {
  const bid = economy.npcBid;
  const base = economy.npcBuyers.find((b) => b.item === "Silicates").unitPrice;

  it("a day's sales are npcBidFor unit by unit from the opening bid, and the order takes no more than its quota", () => {
    expect(bidDay(0, { base, npcBid: bid })).toMatchObject({ sold: 0, gross: 0, close: base });
    let quota = 0;
    for (let k = 0; k < bid.quotaPerDay; k += 1) quota += npcBidFor(base, k, bid);
    expect(bidDay(bid.quotaPerDay, { base, npcBid: bid }).gross).toBe(quota);
    expect(quota).toBe(126_299); // 18.04 a tonne, against 168,000 at the flat 24
    expect(bidDay(bid.quotaPerDay + 500, { base, npcBid: bid })).toMatchObject({ sold: bid.quotaPerDay, units: bid.quotaPerDay + 500 });
    // From a lower opening the curve continues where that bid sits: the first unit is paid the opening bid.
    expect(bidDay(1, { base, opening: 20, npcBid: bid }).gross).toBe(20);
  });

  it("settles on the opening bid the night's recovery gives the close it leads to", () => {
    const day = steadyBidDay(146 * 24, base, bid);
    expect(npcBidAfterRecovery(base, day.close, bid)).toBe(day.opening);
    // The row AB#2334 was filed on: a 146 t/h yard's day averages 17, not 24.
    expect([day.opening, day.close, (day.gross / day.sold).toFixed(2)]).toEqual([20, 14, "17.00"]);
  });

  it("puts the best setting well under the flat-price one, and a third yard in the red", () => {
    const m = computeModel(economy, leaseCatalog());
    expect(m.best).toMatchObject({ throughput: 60, profitPerHour: 224 });
    expect(m.flatBest).toMatchObject({ throughput: 146, profitPerHour: 606 });
    expect(m.yards.map((y) => [y.yards, y.leases, y.throughput, Math.round(y.profitPerDay)])).toEqual([
      [1, 1, 74, 3234], [2, 1, 37, 3479], [3, 2, 39, 1009], [4, 2, 38, -2837]
    ]);
  });

  it("ECONOMY.md's T-018 table is the model's arithmetic, row by row", () => {
    const section = doc.slice(doc.indexOf("## T-018"), doc.indexOf("The maximum is at"));
    const rows = [...section.matchAll(/^\| (\d+) \| ([\d.]+) \| ([\d,]+) \| ([\d,]+) \| (-?[\d,]+) \| (-?[\d,]+) \|$/gm)];
    expect(rows.length).toBe(7);
    const n = (s) => Number(s.replace(/,/g, ""));
    for (const [, t, avg, rev, cost, profit, flat] of rows) {
      const day = steadyBidDay(Number(t) * 24, base, bid);
      const revenue = Math.round((day.gross * 0.92) / 24);
      const c = operationCostPerHourFor(Number(t), economy.operations);
      expect([(day.gross / day.sold).toFixed(2), revenue, c, Math.round((day.gross * 0.92) / 24 - c), Math.round(Number(t) * base * 0.92 - c)], `T = ${t}`)
        .toEqual([avg, n(rev), n(cost), n(profit), n(flat)]);
    }
  });
});
