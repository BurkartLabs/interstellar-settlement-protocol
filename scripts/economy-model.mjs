// The first-session economy model (AB#727, ISP-41): the cheapest path from a new corporation's credits to its first
// extractor and what that extractor earns at 10, 100 and 250 t/h, computed from data/economy.json and the lease
// catalog. A model, not play: it takes the rules below as written and plays perfectly. `npm run economy:model` prints
// it; ECONOMY.md quotes the output, and tests/unit/economyModel.test.js keeps the two in step.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { operationCostPerHourFor, startupCostFor, bestThroughputFor } from "../server/economy.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

/**
 * The rules the model needs that live in code rather than in data/economy.json, with where each one is. The unit test
 * reads those files and fails when a value here no longer matches, so the model cannot drift from the game quietly.
 */
export const CODE_RULES = {
  startingCredits: { value: 250_000, where: "server/gameState.js, a new corporation's finances.credits" },
  startingStation: { value: "earth-station-prime", where: "server/gameState.js, currentStationId" },
  employeesPerLease: { value: 5, where: "public/scripts/leaseStaffing.js, EMPLOYEES_PER_LEASE" },
  minThroughput: { value: 10, where: "server/routes/mining.js, start-mining clamps throughput to 10..250" },
  maxThroughput: { value: 250, where: "server/routes/mining.js, start-mining clamps throughput to 10..250" },
  maxCycleHours: { value: 72, where: "server/routes/mining.js, start-mining hours max 72" },
  downtimeStartPerSecond: { value: 0.00005, where: "server/gameState.js, extractorDowntimeProbPerSec" },
  recoveryPerSecond: { value: 0.000276, where: "server/gameState.js, recoveryProbPerSec" },
  minDowntimeMinutes: { value: 15, where: "server/gameState.js, minDowntimeMs" }
};

const round = (n) => Math.round(n);
const fmt = (n) => (n < 0 ? "-" : "") + Math.abs(round(n)).toLocaleString("en-US");

/** The model, as numbers: pure, from an economy object, the lease catalog and the code rules. */
export function computeModel(economy, leases, rules = CODE_RULES) {
  const r = Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, v.value]));
  const lease = [...leases].sort((a, b) => a.cost - b.cost)[0];
  const officeDays = Math.min(...economy.office.termDays);
  const silicates = economy.npcBuyers.find((b) => b.item === "Silicates");
  const keep = 1 - economy.exchange.salesTaxPct / 100;

  // The purchases, cheapest first-extractor path, in the order the rules require them.
  const steps = [];
  let credits = r.startingCredits;
  const buy = (what, cost, why) => { credits -= cost; steps.push({ what, cost, credits, why }); };
  buy(`Rent an office, ${officeDays} days`, economy.office.rentPerDay * officeDays, "a lease needs an office");
  buy(`Hire ${r.employeesPerLease} employees`, economy.employees.hireCost * r.employeesPerLease, `a lease needs ${r.employeesPerLease} on payroll`);
  buy(`Lease ${lease.name}`, lease.cost, "the cheapest body with lease terms");
  buy("Build an extractor yard", economy.buildings.extractorYardCost, "no research discount yet");
  const sunk = r.startingCredits - credits;

  // Running an extractor at T t/h, a fixed cost per hour (payroll and office rent), and expected uptime.
  const fixedPerHour = (economy.employees.payrollPerDay * r.employeesPerLease + economy.office.rentPerDay) / 24;
  const meanUpHours = 1 / r.downtimeStartPerSecond / 3600;
  const meanDownHours = r.minDowntimeMinutes / 60 + 1 / r.recoveryPerSecond / 3600;
  const uptime = meanUpHours / (meanUpHours + meanDownHours);
  const rows = [10, 100, 250].map((t) => {
    // AB#775's curve, from server/economy.js — not reimplemented here, so the two can never diverge again (AB#1754).
    const cost = operationCostPerHourFor(t, economy.operations);
    const startup = startupCostFor(cost, economy.operations);
    const revenue = t * silicates.unitPrice * keep;
    const perHour = (u) => u * (revenue - cost) - fixedPerHour - startup / r.maxCycleHours;
    const paybackHours = (u) => (perHour(u) > 0 ? (sunk + startup) / perHour(u) : Infinity);
    // Back to the starting credits: the purchases and the first startup, earned back.
    return { t, cost, startup, revenue, perHourIdeal: perHour(1), perHourExpected: perHour(uptime), paybackIdeal: paybackHours(1), paybackExpected: paybackHours(uptime) };
  });
  // The throughput that actually pays best under the curve, at this price and no research — what T-018 calls
  // "the decision". Also from server/economy.js, for the same reason the rows above are.
  const best = bestThroughputFor({ unitPrice: silicates.unitPrice, taxPct: economy.exchange.salesTaxPct, min: r.minThroughput, max: r.maxThroughput }, economy.operations);
  return { rules: r, lease, officeDays, steps, sunk, credits, fixedPerHour, uptime, meanUpHours, meanDownHours, rows, silicates, keep, best };
}

const hours = (h) => (Number.isFinite(h) ? `${h.toFixed(1)} h (day ${Math.ceil(h / 24)})` : "never");

/** The model as the text ECONOMY.md quotes. */
export function renderModel(m) {
  const lines = [];
  lines.push(`Start: ${fmt(m.rules.startingCredits)} credits at ${m.rules.startingStation}.`);
  lines.push("");
  lines.push("Purchase order (the cheapest path to a first extractor):");
  for (const [i, s] of m.steps.entries()) lines.push(`  ${i + 1}. ${s.what.padEnd(28)} -${fmt(s.cost).padStart(7)}  -> ${fmt(s.credits).padStart(8)}   (${s.why})`);
  lines.push(`  Spent before mining: ${fmt(m.sunk)}. Credits left: ${fmt(m.credits)}.`);
  lines.push("");
  lines.push(`Running costs while mining: payroll and office ${m.fixedPerHour.toFixed(2)}/h; each cycle's startup spread over ${m.rules.maxCycleHours} h.`);
  lines.push("(Payroll is charged once AB#1097 lands; until then the game charges less than this.)");
  lines.push(`Silicates sell to ${m.silicates.buyer} at ${m.silicates.unitPrice}, less ${Math.round((1 - m.keep) * 100)}% tax: ${(m.silicates.unitPrice * m.keep).toFixed(2)} a unit.`);
  lines.push(`Expected uptime: ${(m.uptime * 100).toFixed(1)}% (a stoppage every ${m.meanUpHours.toFixed(1)} h on average, lasting ${m.meanDownHours.toFixed(2)} h).`);
  lines.push("");
  lines.push("Pays back = the purchases and the first startup earned back: credits are at the starting figure again.");
  lines.push("  t/h | cost/h | startup | revenue/h | profit/h ideal | profit/h expected | pays back (ideal)   | pays back (expected)");
  for (const r of m.rows) {
    lines.push(`  ${String(r.t).padStart(3)} | ${fmt(r.cost).padStart(6)} | ${fmt(r.startup).padStart(7)} | ${fmt(r.revenue).padStart(9)} | ${fmt(r.perHourIdeal).padStart(14)} | ${fmt(r.perHourExpected).padStart(17)} | ${hours(r.paybackIdeal).padEnd(19)} | ${hours(r.paybackExpected)}`);
  }
  const earning = m.rows.filter((r) => r.perHourExpected > 0).map((r) => `${r.t} t/h`);
  const losing = m.rows.filter((r) => r.perHourExpected <= 0).map((r) => `${r.t} t/h`);
  lines.push(`Credits start to accumulate: at ${earning.join(" and ")} from the first hour of mining (day 1), counted as sold; at ${losing.join(" and ") || "none"}, never: every hour loses.`);
  lines.push("");
  lines.push(`Running cost curves with throughput (operationCostPerHourFor, server/economy.js): the best setting here, no research, is ${m.best.throughput} t/h at ${fmt(m.best.profitPerHour)} an hour.`);
  lines.push("Every throughput from the floor to the cap stays startable; the curve is what makes the setting a decision, not a wall.");
  lines.push("A model, not play: perfect play, no travel, selling every unit at the standing bid, no research.");
  return lines.join("\n");
}

/** The lease catalog: every body with lease terms. */
export function leaseCatalog() {
  const data = readJson("data/systems.json");
  const systems = Array.isArray(data) ? data : data.systems || [];
  return systems.flatMap((s) => (s.bodies || []).filter((b) => Number(b.leaseCost) > 0).map((b) => ({ name: b.name, cost: Number(b.leaseCost) })));
}

export function modelText() {
  return renderModel(computeModel(readJson("data/economy.json"), leaseCatalog()));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(modelText());
}
