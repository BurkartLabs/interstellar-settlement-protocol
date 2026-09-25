import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_RULES, computeModel, leaseCatalog, modelText } from "../../scripts/economy-model.mjs";
import { economyNumbers, operationCostPerHourFor, startupCostFor, bestThroughputFor } from "../../server/economy.js";
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
      /Math\.max\(10, Math\.min\(250, amount\)\)/,
      /hours, \{ fallback: 24, min: 1, max: 72 \}/,
      /let probPerSec = 0\.00005;/,
      /const recoveryProbPerSec = 0\.000276;/,
      /const minDowntimeMs = 15 \* 60 \* 1000;/
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
    expect(m.best).toEqual(best);
  });

  it("a margin at or below zero makes every setting lose, and the model says never", () => {
    const worse = { ...economy, operations: { ...economy.operations, costPerThroughputUnit: 23 } };
    const m = computeModel(worse, leaseCatalog());
    expect(m.rows.every((r) => r.paybackIdeal === Infinity)).toBe(true);
    expect(m.best.profitPerHour).toBeLessThan(0);
  });
});
