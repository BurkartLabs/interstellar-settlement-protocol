// The Economy Planner's simulation (AB#4911): a plan's cash, hour by hour, from a player's point of view.
//
// A plan is phases (groups of days), a phase is days, a day is actions. An action is either custom (numbers typed in,
// as the Board's spreadsheet has them) or rule-backed: priced by the same pure modules the game runs
// (public/scripts: the cost curve, the startup cost, the yard upkeep and price, the standing bid, the tax and royalty,
// the research efficiency), fed the game's data files. So a rule-backed plan is what the game would charge and pay,
// and tests/unit/plannerEngine.test.js holds the two together.
//
// Pure: no DOM, no fetch. It loads in node (the tests) and in the browser (tools/planner/app.js).
import { costPerHourFor, startupCostFor, yardUpkeepPerHourFor } from "../../public/scripts/miningProjection.js";
import { npcBidFor, npcBidAfterRecovery } from "../../public/scripts/standingBid.js";
import { taxBreakdown } from "../../public/scripts/exchangeTax.js";
import { nextYardPrice } from "../../public/scripts/yardPrice.js";

export const HOURS = 24;
export const KINDS = ["custom", "office", "hire", "lease", "yard", "cycle", "research"];
// Research the mining tick reads (public/scripts/miningEfficiency.js and the downtime roll).
const BASIC_EXTRACTION = "tt-basic-extraction";
const SUPPLY_FORECAST = "tt-supply-forecast";
const INDUSTRIAL_SAFETY = "tt-industrial-safety";

const num = (v, d = 0) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
const has = (v) => v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v));
let seq = 0;
export const newId = (p = "x") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Every day of a plan in order, numbered from 1, with the phase it belongs to. */
export function flattenDays(plan) {
  const out = [];
  for (const phase of plan.phases || []) for (const day of phase.days || []) out.push({ n: out.length + 1, phase, day });
  return out;
}

/** The hour after which a downtime starts, and how long one lasts, from the mining tick's own probabilities. */
export function uptimeFor(code, safety = false) {
  const p = num(code.downtimeStartPerSecond) * (safety ? 0.92 : 1);
  if (!p) return 1;
  const up = 1 / p / 3600;
  const down = num(code.minDowntimeMinutes) / 60 + 1 / num(code.recoveryPerSecond, 1) / 3600;
  return up / (up + down);
}

/**
 * What a rule-backed action costs or earns, before overrides: { upfront, perHour, perDay, note }. Cycles and yards
 * depend on what was built and researched before them, so `ctx` carries the simulation's state at the action's start.
 */
export function priceAction(a, rules, ctx = {}) {
  const e = rules.economy;
  switch (a.kind) {
    case "office": {
      const term = num(a.termDays, e.office.termDays[0]);
      return { upfront: e.office.rentPerDay * term, perHour: 0, perDay: 0, note: `${term}-day term at ${e.office.rentPerDay}/day${a.renew ? ", renewed" : ""}` };
    }
    case "hire": {
      const n = Math.max(0, Math.floor(num(a.count, 5)));
      return { upfront: e.employees.hireCost * n, perHour: 0, perDay: e.employees.payrollPerDay * n, note: `${n} × ${e.employees.hireCost} to hire, ${e.employees.payrollPerDay}/day payroll each` };
    }
    case "lease": {
      const body = rules.leases.find((l) => l.body === a.body) || rules.leases[0];
      return { upfront: body ? body.cost : 0, perHour: 0, perDay: 0, note: body ? `${body.body} (${body.system})` : "no lease catalogue" };
    }
    case "yard": {
      const owned = num(ctx.yardsOwned);
      const price = nextYardPrice(owned, e.buildings, !!ctx.supplyForecast);
      return { upfront: price, perHour: 0, perDay: 0, note: `yard #${owned + 1}${ctx.supplyForecast ? ", Supply Forecast −6%" : ""}` };
    }
    case "cycle": {
      const t = clampThroughput(a.throughput, rules);
      const yardIndex = Math.max(0, num(a.yard, 1) - 1);
      const run = costPerHourFor(t, e.operations) + yardUpkeepPerHourFor(yardIndex, e.buildings);
      const hours = cycleHours(a, rules);
      return { upfront: startupCostFor(costPerHourFor(t, e.operations), e.operations), perHour: run, perDay: 0, note: `${t} t/h on yard ${yardIndex + 1}, ${hours} h${a.continuous ? ", restarts" : ""}` };
    }
    case "research": {
      const tech = rules.research.find((r) => r.id === a.tech) || rules.research[0];
      return { upfront: tech ? tech.costCredits : 0, perHour: 0, perDay: 0, note: tech ? `${tech.name}, ${tech.durationHours} h: ${tech.effect}` : "no research catalogue" };
    }
    default:
      return { upfront: num(a.upfront), perHour: num(a.perHour), perDay: num(a.perDay), note: a.income ? "income" : "expense" };
  }
}

const clampThroughput = (v, rules) => Math.min(rules.code.maxThroughput, Math.max(rules.code.minThroughput, Math.round(num(v, 100))));
const cycleHours = (a, rules) => Math.min(rules.code.maxCycleHours, Math.max(1, Math.round(num(a.hours, 24))));

/** An action's numbers after its overrides: a rule-backed action keeps the game's price unless a field is filled. */
function effective(a, priced) {
  if (a.kind === "custom") return priced;
  return {
    ...priced,
    upfront: has(a.upfront) ? num(a.upfront) : priced.upfront,
    perHour: has(a.perHour) ? num(a.perHour) : priced.perHour,
    perDay: has(a.perDay) ? num(a.perDay) : priced.perDay,
    overridden: has(a.upfront) || has(a.perHour) || has(a.perDay)
  };
}

/** One bid per item: where its curve opens today and how much went into today's quota. */
class Bid {
  constructor(base, npcBid) { this.base = base; this.npcBid = npcBid; this.opening = base; this.soldToday = 0; }
  get offset() {
    const drift = this.npcBid.driftAtFullQuotaPct / 100;
    return this.opening >= this.base || drift <= 0 ? 0 : ((1 - this.opening / this.base) / drift) * this.npcBid.quotaPerDay;
  }
  /** Sell up to `units` along the curve; returns { sold, gross }. The quota's excess is not bought. */
  sell(units) {
    const room = Math.max(0, this.npcBid.quotaPerDay - this.soldToday);
    const whole = Math.min(room, Math.floor(units));
    let gross = 0;
    const off = this.offset;
    for (let k = 0; k < whole; k += 1) gross += npcBidFor(this.base, off + this.soldToday + k, this.npcBid);
    this.soldToday += whole;
    return { sold: whole, gross };
  }
  nextDay() {
    const close = npcBidFor(this.base, this.offset + this.soldToday, this.npcBid);
    this.opening = npcBidAfterRecovery(this.base, close, this.npcBid);
    this.soldToday = 0;
  }
}

/**
 * Run a plan. Returns { days, hourly, events, warnings, kpis, phases, priced }:
 *   days    one row per day: income, expenses (and by category), net, cash at the end and at its lowest, tonnes
 *   hourly  cash at the end of every hour (for the chart)
 *   priced  each action's effective numbers, by action id (what the editor shows beside a rule-backed action)
 */
export function simulate(plan, rules) {
  const s = plan.settings || {};
  const e = rules.economy;
  const capital = num(s.capital, rules.code.startingCredits);
  const basePct = has(s.taxPct) ? num(s.taxPct) : e.exchange.salesTaxPct;
  const flat = flattenDays(plan);
  const extra = Math.max(0, Math.floor(num(s.extraDays, 0)));
  const nDays = flat.length + extra;
  const totalHours = nDays * HOURS;

  // every action with its absolute start hour, in time order (stable within a day)
  const timeline = [];
  for (const { n, phase, day } of flat) {
    (day.actions || []).forEach((a, i) => timeline.push({ a, start: (n - 1) * HOURS + Math.min(23, Math.max(0, Math.floor(num(a.hour)))), order: i, dayN: n, phase }));
  }
  timeline.sort((x, y) => x.start - y.start || x.dayN - y.dayN || x.order - y.order);

  const warnings = [];
  const events = [];
  const priced = {};
  const charges = [];   // { from, to, perHour, perDay, income, cat, label }
  const lumps = [];     // { hour, amount, cat, label }  (negative = cost)
  const cycles = [];    // mining runs: { from, to, yardIndex, t, item, perHour, startupEvery, startup }
  const researchDone = []; // { hour, id }
  const leaseHours = [];   // hours a lease starts counting toward the royalty
  const yards = [];        // hours each yard exists, in build order
  let researchFree = 0;

  const doneBy = (id, hour) => researchDone.some((r) => r.id === id && r.hour <= hour);
  for (const item of timeline) {
    const { a, start } = item;
    const ctx = { yardsOwned: yards.filter((h) => h <= start).length, supplyForecast: doneBy(SUPPLY_FORECAST, start) };
    const p = effective(a, priceAction(a, rules, ctx));
    priced[a.id] = p;
    const label = a.name || defaultName(a, rules);
    const durationH = has(a.durationDays) && num(a.durationDays) > 0 ? num(a.durationDays) * HOURS : Infinity;
    const until = Math.min(totalHours, start + durationH);
    switch (a.kind) {
      case "custom": {
        const sign = a.income ? 1 : -1;
        if (p.upfront) lumps.push({ hour: start, amount: sign * p.upfront, cat: a.income ? "income" : (a.category || "other"), label });
        if (p.perHour || p.perDay) charges.push({ from: start, to: until, perHour: p.perHour, perDay: p.perDay, sign, cat: a.income ? "income" : (a.category || "other"), label });
        break;
      }
      case "office": {
        const term = num(a.termDays, e.office.termDays[0]) * HOURS;
        for (let h = start; h < (a.renew ? totalHours : start + 1); h += term) lumps.push({ hour: h, amount: -p.upfront, cat: "office", label });
        if (p.perHour || p.perDay) charges.push({ from: start, to: until, perHour: p.perHour, perDay: p.perDay, sign: -1, cat: "office", label });
        break;
      }
      case "hire":
        lumps.push({ hour: start, amount: -p.upfront, cat: "staff", label });
        charges.push({ from: start, to: until, perHour: p.perHour, perDay: p.perDay, sign: -1, cat: "staff", label });
        break;
      case "lease":
        lumps.push({ hour: start, amount: -p.upfront, cat: "leases", label });
        leaseHours.push(start);
        break;
      case "yard":
        lumps.push({ hour: start, amount: -p.upfront, cat: "buildings", label });
        yards.push(start);
        break;
      case "research": {
        const tech = rules.research.find((r) => r.id === a.tech);
        if (!tech) { warnings.push({ day: item.dayN, text: `${label}: no such technology` }); break; }
        const missing = (tech.prereqs || []).filter((id) => !researchDone.some((r) => r.id === id));
        if (missing.length) warnings.push({ day: item.dayN, text: `${tech.name} needs ${missing.map((id) => rules.research.find((r) => r.id === id)?.name || id).join(", ")} first` });
        const begins = Math.max(start, researchFree);
        const ends = begins + tech.durationHours;
        researchFree = ends;
        lumps.push({ hour: start, amount: -p.upfront, cat: "research", label });
        researchDone.push({ hour: ends, id: tech.id });
        events.push({ hour: ends, text: `${tech.name} completes` });
        if (begins > start) events.push({ hour: begins, text: `${tech.name} starts (queued behind earlier research)` });
        break;
      }
      case "cycle": {
        const yardIndex = Math.max(0, num(a.yard, 1) - 1);
        if (yards.filter((h) => h <= start).length <= yardIndex) warnings.push({ day: item.dayN, text: `${label}: yard ${yardIndex + 1} is not built by then, so it mines nothing` });
        const hours = cycleHours(a, rules);
        const end = a.continuous ? until : Math.min(until, start + hours);
        cycles.push({ from: start, to: end, every: hours, yardIndex, t: clampThroughput(a.throughput, rules), item: a.item || "Silicates", perHour: p.perHour, startup: p.upfront, label, needsYardBy: yardIndex });
        break;
      }
      default:
        warnings.push({ day: item.dayN, text: `unknown action kind ${a.kind}` });
    }
  }

  // the hour loop
  const bids = {};
  const buyer = (item) => e.npcBuyers.find((b) => b.item === item);
  const downtime = !!s.downtime;
  let cash = capital;
  const hourly = [cash];
  const days = [];
  let row = null;
  const stock = {};
  for (let h = 0; h < totalHours; h += 1) {
    const dayN = Math.floor(h / HOURS) + 1;
    if (h % HOURS === 0) {
      if (row) days.push(row);
      for (const b of Object.values(bids)) if (h > 0) b.nextDay();
      const f = flat[dayN - 1];
      row = { day: dayN, phaseId: f ? f.phase.id : null, income: 0, expenses: 0, byCat: {}, tonnes: 0, sold: 0, gross: 0, low: cash, open: cash };
    }
    const add = (amount, cat) => {
      cash += amount;
      if (amount >= 0) row.income += amount; else row.expenses -= amount;
      row.byCat[cat] = (row.byCat[cat] || 0) + amount;
    };
    for (const l of lumps) if (l.hour === h) add(l.amount, l.cat);
    for (const c of charges) {
      if (h < c.from || h >= c.to) continue;
      if (c.perHour) add(c.sign * c.perHour, c.cat);
      if (c.perDay && (h - c.from) % HOURS === 0) add(c.sign * c.perDay, c.cat);
    }
    // mining: cost, startups, tonnes, and the sale along the bid
    const efficiency = (doneBy(BASIC_EXTRACTION, h) ? 1.1 : 1) * (doneBy(SUPPLY_FORECAST, h) ? 1.06 : 1);
    const uptime = downtime ? uptimeFor(rules.code, doneBy(INDUSTRIAL_SAFETY, h)) : 1;
    const leases = leaseHours.filter((x) => x <= h).length;
    const taxPct = taxBreakdown({ basePct, leasesHeld: leases, royaltyPointsByLeasesHeld: e.leases.royaltyPointsByLeasesHeld }).ratePct;
    for (const c of cycles) {
      if (h < c.from || h >= c.to) continue;
      if (yards.filter((y) => y <= h).length <= c.needsYardBy) continue;
      if ((h - c.from) % c.every === 0) add(-c.startup, "mining");
      add(-c.perHour, "mining");
      const tonnes = c.t * efficiency * uptime;
      stock[c.item] = (stock[c.item] || 0) + tonnes;
      row.tonnes += tonnes;
    }
    for (const item of Object.keys(stock)) {
      const b = buyer(item);
      if (!b) continue;
      const bid = (bids[item] ||= new Bid(b.unitPrice, e.npcBid));
      const { sold, gross } = bid.sell(stock[item]);
      if (!sold) continue;
      stock[item] -= sold;
      row.sold += sold;
      row.gross += gross;
      add(gross * (1 - taxPct / 100), "sales");
    }
    row.low = Math.min(row.low, cash);
    hourly.push(cash);
  }
  if (row) days.push(row);
  for (const d of days) {
    d.net = d.income - d.expenses;
    d.cash = hourly[d.day * HOURS];
    d.gainLoss = d.cash - capital;
    d.avgBid = d.sold ? d.gross / d.sold : 0;
  }
  return { capital, days, hourly, events: events.sort((a, b) => a.hour - b.hour), warnings, priced, phases: phaseSummary(plan, days), kpis: kpis(days, capital), unsold: stock };
}

function phaseSummary(plan, days) {
  return (plan.phases || []).map((p) => {
    const mine = days.filter((d) => d.phaseId === p.id);
    if (!mine.length) return { id: p.id, name: p.name, days: 0 };
    return { id: p.id, name: p.name, days: mine.length, from: mine[0].day, to: mine[mine.length - 1].day, income: sum(mine, "income"), expenses: sum(mine, "expenses"), net: sum(mine, "net"), endCash: mine[mine.length - 1].cash, low: Math.min(...mine.map((d) => d.low)) };
  });
}
const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);

function kpis(days, capital) {
  if (!days.length) return { capital, lowest: { cash: capital, day: 0 }, breakEven: null, broke: null, lastNet: 0, endCash: capital };
  const lowest = days.reduce((m, d) => (d.low < m.cash ? { cash: d.low, day: d.day } : m), { cash: capital, day: 0 });
  let breakEven = null;
  for (let i = 0; i < days.length; i += 1) if (days[i].cash >= capital && (i === 0 ? false : days[i - 1].cash < capital)) breakEven = days[i].day;
  const broke = days.find((d) => d.low < 0);
  return { capital, lowest, breakEven, broke: broke ? broke.day : null, lastNet: days[days.length - 1].net, endCash: days[days.length - 1].cash, day1Spend: days[0].expenses };
}

export function defaultName(a, rules) {
  switch (a.kind) {
    case "office": return "Office rent";
    case "hire": return `Hire ${num(a.count, 5)}`;
    case "lease": return `Lease ${a.body || rules?.leases?.[0]?.body || ""}`.trim();
    case "yard": return "Extractor yard";
    case "cycle": return `Mining cycle, yard ${num(a.yard, 1)}`;
    case "research": return rules?.research?.find((r) => r.id === a.tech)?.name || "Research";
    default: return a.income ? "Income" : "Expense";
  }
}

/** A new action of a kind, with the defaults the editor offers. */
export function newAction(kind, rules) {
  const base = { id: newId("a"), kind, hour: 0 };
  switch (kind) {
    case "office": return { ...base, termDays: rules.economy.office.termDays[0], renew: true };
    case "hire": return { ...base, count: rules.code.employeesPerLease };
    case "lease": return { ...base, body: rules.leases[0]?.body };
    case "yard": return base;
    case "cycle": return { ...base, yard: 1, throughput: 100, hours: 24, continuous: true, item: "Silicates" };
    case "research": return { ...base, tech: rules.research[0]?.id };
    default: return { ...base, kind: "custom", name: "New expense", income: false, upfront: "", perHour: "", perDay: "" };
  }
}

export const newDay = () => ({ id: newId("d"), note: "", actions: [] });
export const newPhase = (name = "New phase") => ({ id: newId("p"), name, collapsed: false, days: [newDay()] });

/** A deep copy of a day with fresh ids, for "duplicate" and "repeat". */
export function cloneDay(day) {
  return { ...day, id: newId("d"), actions: (day.actions || []).map((a) => ({ ...a, id: newId("a") })) };
}

/** The Board's spreadsheet of 2026-10-03, as custom actions: the example plan, and the test's fixture. */
export function boardSheetPlan() {
  const c = (name, o) => ({ id: newId("a"), kind: "custom", name, hour: 0, upfront: "", perHour: "", perDay: "", income: false, ...o });
  return {
    id: newId("plan"), name: "Board sheet, 2026-10-03",
    settings: { capital: 250000, taxPct: 8, downtime: false, extraDays: 0 },
    phases: [
      { id: newId("p"), name: "Day 1: setup", collapsed: false, days: [{ id: newId("d"), note: "", actions: [
        c("Office Lease", { perDay: 2000, category: "office" }),
        c("Hiring", { upfront: 20000, perDay: 1500, category: "staff" }),
        c("Mining Lease", { upfront: 50000, category: "leases" }),
        c("BEY Construction", { upfront: 100000, category: "buildings" }),
        c("Cycle #1", { perHour: 1860, category: "mining" }),
        c("Research", { upfront: 2000, category: "research" }),
        c("Travel", { upfront: 1000, category: "travel" })
      ] }] },
      { id: newId("p"), name: "Week 1: earning", collapsed: false, days: [
        { id: newId("d"), note: "", actions: [c("Cycle #1 sales", { perHour: 1440, income: true }), c("Cycle #2 sales", { perHour: 1440, income: true })] },
        ...Array.from({ length: 5 }, () => newDay())
      ] }
    ]
  };
}
