// The first-session economy model (AB#727, ISP-41): the cheapest path from a new corporation's credits to its first
// extractor and what that extractor earns at 10, 100 and 250 t/h, computed from data/economy.json and the lease
// catalog. A model, not play: it takes the rules below as written and plays perfectly. `npm run economy:model` prints
// it; ECONOMY.md quotes the output, and tests/unit/economyModel.test.js keeps the two in step.
//
// AB#2334: every tonne used to be priced at the flat base bid (24). Since ISP-87 the standing bid falls as the day's
// quota fills and recovers only part of the way overnight, so a yard's output is sold along that curve here, from the
// opening bid a corporation settles into when it sells the same amount every day. One corporation alone in the world:
// others selling into the same order are not modelled.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { operationCostPerHourFor, startupCostFor, bestThroughputFor, npcBidFor, npcBidAfterRecovery } from "../server/economy.js";
import { taxBreakdown } from "../public/scripts/exchangeTax.js";

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
  yardsPerLease: { value: 2, where: "server/routes/corporation.js, a new lease's buildingSlots: 2" },
  minThroughput: { value: 10, where: "server/routes/mining.js, start-mining clamps throughput to 10..250" },
  maxThroughput: { value: 250, where: "server/routes/mining.js, start-mining clamps throughput to 10 and the yard's tier cap, 250 at tier 1 (server/economy.js BASE_THROUGHPUT_CAP)" },
  maxCycleHours: { value: 72, where: "server/routes/mining.js, start-mining hours max 72" },
  downtimeStartPerSecond: { value: 0.00005, where: "server/gameState.js, extractorDowntimeProbPerSec" },
  recoveryPerSecond: { value: 0.000276, where: "server/game/mining.js, RECOVERY_PROB_PER_SEC" },
  minDowntimeMinutes: { value: 15, where: "server/game/mining.js, MIN_DOWNTIME_MS" }
};

/**
 * A day of selling `units` into a standing bid, one unit at a time along npcBidFor from the day's opening bid, as
 * ECONOMY.md's ISP-87 section states the rule. The order takes at most its quota a day; the rest is not sold to it.
 */
export function bidDay(units, { base, opening = base, npcBid }) {
  const sold = Math.min(Math.max(0, Math.floor(units)), npcBid.quotaPerDay);
  const drift = npcBid.driftAtFullQuotaPct / 100;
  // The opening bid as the volume that would have brought the base down to it, so the curve continues from there.
  const offset = opening >= base || drift <= 0 ? 0 : ((1 - opening / base) / drift) * npcBid.quotaPerDay;
  let gross = 0;
  for (let k = 0; k < sold; k += 1) gross += npcBidFor(base, offset + k, npcBid);
  return { units: Math.floor(units), sold, gross, opening, close: npcBidFor(base, offset + sold, npcBid) };
}

/** The day a corporation settles into selling the same units every day: each night recovers from the last close. */
export function steadyBidDay(units, base, npcBid) {
  let opening = base;
  let day = bidDay(units, { base, opening, npcBid });
  for (let i = 0; i < 100; i += 1) {
    const next = npcBidAfterRecovery(base, day.close, npcBid);
    if (next === opening) break;
    opening = next;
    day = bidDay(units, { base, opening, npcBid });
  }
  return day;
}

const round = (n) => Math.round(n);
const fmt = (n) => (n < 0 ? "-" : "") + Math.abs(round(n)).toLocaleString("en-US");

/** The model, as numbers: pure, from an economy object, the lease catalog and the code rules. */
export function computeModel(economy, leases, rules = CODE_RULES) {
  const r = Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, v.value]));
  const lease = [...leases].sort((a, b) => a.cost - b.cost)[0];
  const officeDays = Math.min(...economy.office.termDays);
  const silicates = economy.npcBuyers.find((b) => b.item === "Silicates");
  const keep = 1 - economy.exchange.salesTaxPct / 100;
  const npcBid = economy.npcBid;
  // What a day of `unitsPerDay` sells for after tax, along the bid in steady state (AB#2334).
  const netDay = (unitsPerDay, taxPct = economy.exchange.salesTaxPct) => {
    const day = steadyBidDay(unitsPerDay, silicates.unitPrice, npcBid);
    return { ...day, net: day.gross * (1 - taxPct / 100) };
  };

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
    // AB#2334: a running hour's revenue is the day's sales along the bid, over the hours the yard ran.
    const revenueAt = (u) => netDay(t * 24 * u).net / (24 * u);
    const revenue = revenueAt(1);
    const perHour = (u) => u * (revenueAt(u) - cost) - fixedPerHour - startup / r.maxCycleHours;
    const paybackHours = (u) => (perHour(u) > 0 ? (sunk + startup) / perHour(u) : Infinity);
    // Back to the starting credits: the purchases and the first startup, earned back.
    return { t, cost, startup, revenue, perHourIdeal: perHour(1), perHourExpected: perHour(uptime), paybackIdeal: paybackHours(1), paybackExpected: paybackHours(uptime) };
  });
  // The throughput that actually pays best under the curve, at this price and no research — what T-018 calls
  // "the decision". `flatBest` is server/economy.js's at the flat base bid (what every tonne fetched before AB#2334);
  // `best` walks the same range with each hour priced along the bid, from the same cost function.
  const flatBest = bestThroughputFor({ unitPrice: silicates.unitPrice, taxPct: economy.exchange.salesTaxPct, min: r.minThroughput, max: r.maxThroughput }, economy.operations);
  let best = { throughput: r.minThroughput, profitPerHour: -Infinity };
  for (let t = r.minThroughput; t <= r.maxThroughput; t += 1) {
    const profitPerHour = Math.round(netDay(t * 24).net / 24 - operationCostPerHourFor(t, economy.operations));
    if (profitPerHour > best.profitPerHour) best = { throughput: t, profitPerHour, avgBid: netDay(t * 24).gross / (t * 24) };
  }

  // A corporation of 1 to 4 yards, two to a lease (its two building slots), each lease staffed, all running at the rate
  // that pays best for the whole corporation, at expected uptime, per day: every yard sells into the one order, so each
  // extra yard lowers the price all of them fetch. The lease royalty and yard upkeep are the game's (ISP-302, ISP-308).
  const yards = [1, 2, 3, 4].map((n) => {
    const leases = Math.ceil(n / r.yardsPerLease);
    const tax = taxBreakdown({ basePct: economy.exchange.salesTaxPct, leasesHeld: leases, royaltyPointsByLeasesHeld: economy.leases?.royaltyPointsByLeasesHeld || {} });
    const fixedPerDay = economy.office.rentPerDay + economy.employees.payrollPerDay * r.employeesPerLease * leases;
    let top = null;
    for (let t = r.minThroughput; t <= r.maxThroughput; t += 1) {
      const day = netDay(n * t * 24 * uptime, tax.ratePct);
      let running = 0;
      for (let i = 0; i < n; i += 1) {
        const cost = operationCostPerHourFor(t, economy.operations, { yardIndex: i, buildings: economy.buildings });
        running += uptime * 24 * cost + (24 * startupCostFor(cost, economy.operations)) / r.maxCycleHours;
      }
      const profitPerDay = day.net - running - fixedPerDay;
      if (!top || profitPerDay > top.profitPerDay) top = { yards: n, leases, throughput: t, taxPct: tax.ratePct, units: day.units, sold: day.sold, opening: day.opening, avgBid: day.sold ? day.gross / day.sold : 0, profitPerDay };
    }
    return top;
  });

  // What today's server pays instead (AB#2356, AB#2357): a lot is priced at the bid before it and every day opens at
  // the base, so a corporation that sells a day's output in one lot, up to the quota, is paid the base for all of it.
  return { rules: r, lease, officeDays, steps, sunk, credits, fixedPerHour, uptime, meanUpHours, meanDownHours, rows, silicates, keep, npcBid, best, flatBest, yards };
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
  lines.push(`Silicates sell to ${m.silicates.buyer} at ${m.silicates.unitPrice}, less ${Math.round((1 - m.keep) * 100)}% tax, along the standing bid (ISP-87): it falls ${m.npcBid.driftAtFullQuotaPct}% of base`);
  lines.push(`across the day's ${fmt(m.npcBid.quotaPerDay)} quota, never below ${m.npcBid.floorPct}%, and recovers ${m.npcBid.recoveryPerDayPct}% of the gap overnight. Each unit is sold along it, from the`);
  lines.push("opening bid the corporation settles into selling the same amount every day; revenue/h is that day over the hours run.");
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
  lines.push(`Running cost curves with throughput (operationCostPerHourFor, server/economy.js): the best setting here, no research, is ${m.best.throughput} t/h at ${fmt(m.best.profitPerHour)} an hour`);
  lines.push(`(ideal uptime, running cost only; its tonnes average ${m.best.avgBid.toFixed(2)} before tax). At the flat ${m.silicates.unitPrice} it was ${m.flatBest.throughput} t/h at ${fmt(m.flatBest.profitPerHour)} an hour.`);
  lines.push("Every throughput from the floor to the cap stays startable; the curve is what makes the setting a decision, not a wall.");
  lines.push("");
  lines.push(`One corporation's yards, ${m.rules.yardsPerLease} to a lease, all selling into the one order, at expected uptime, per day (payroll,`);
  lines.push("office, running and startup costs, yard upkeep and the lease royalty counted; lease and yard purchases not):");
  lines.push("  yards | leases | t/h each | tonnes/day | sold to the bid | opening bid | average bid | tax | profit/day");
  for (const y of m.yards) {
    lines.push(`  ${String(y.yards).padStart(5)} | ${String(y.leases).padStart(6)} | ${String(y.throughput).padStart(8)} | ${fmt(y.units).padStart(10)} | ${fmt(y.sold).padStart(15)} | ${String(y.opening).padStart(11)} | ${y.avgBid.toFixed(2).padStart(11)} | ${String(y.taxPct).padStart(2)}% | ${fmt(y.profitPerDay).padStart(10)}`);
  }
  lines.push("Other corporations selling into the same order are not modelled: each one lowers every other's price.");
  lines.push(`Today's server pays a lot at the bid before it and opens every day at ${m.silicates.unitPrice} (AB#2356, AB#2357): one lot a day of up to ${fmt(m.npcBid.quotaPerDay)} t is`);
  lines.push(`paid ${m.silicates.unitPrice} a tonne, the flat figure above. This model prices what ECONOMY.md's rule says, which the game pays once both are fixed.`);
  lines.push("A model, not play: perfect play, no travel, selling every unit to the standing bid as mined, no research.");
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
