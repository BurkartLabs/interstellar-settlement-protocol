// ISP-271 (AB#967): the warfare economy together. conglomerateProbe.js (ISP-219) and tariffProbe.js (ISP-234) each
// balanced one system alone; this plays rival factions in one world, where control wins concessions, concessions earn
// tariffs, and the tariffs pay for more control: the loop that could snowball until one faction holds everything. Then
// it sweeps what each warfare lever returns as its spend grows.
//
// BOT NUMBERS (P-PROXY, DOCTRINE P-005). Factions are bots on fixed policies in an assumed economy; the numbers measure
// whether the rules let one of them run away, not how anybody plays.
//
// WHAT IS REAL AND WHAT IS ASSUMED:
//   - Real (the server's code, with the clock moved): the activity counters (recordExtraction, recordSale), the daily
//     dominance computation and its control readings (dominanceTick, recordControlDay), eligibility (14 days of 40%
//     and a 1.5x lead; 7 and 30% at Barnard's Star), petitions, counter-petitions and reviews (petitionConcession,
//     concessionTick), each system's rule, the upkeep that grows with every concession held (k x base each), grace and
//     lapse, filing a tariff with its notice (setTariff), charging it with the ISA's levy (chargeTariff) and paying it
//     out (tariffTick). For the levers: patents filed and paid (filePatent, recordResearchUse, patentTick), and a
//     lobbying campaign's move (openCampaign, pledge, lobbyingTick, parameterInForce).
//   - Assumed: a faction's activity. Each spends a daily budget on control in the systems its policy picks: a credit
//     spent there buys 0.8/18 tonnes extracted (18 a tonne, AB#965's bot mining cost) and 1 credit of sales (0.2 of it,
//     at five of turnover a credit of margin). The base budget is funded by an economy that breaks even, so it is not
//     charged; what a faction reinvests from its warfare income is. Everybody else in the galaxy is one "locals"
//     corporation with the same small activity in every system, which is what a lead is measured against. Each held
//     system's third-party trade (TRADE, after WARFARE.md's worked examples) pays its tariff whatever the rate: traders
//     routing round a tariff is tariffProbe.js's measurement, not this one's. Factions are docked wherever they
//     petition or file (no travel), and are corporations, not conglomerates, so Lacaille 9352 (conglomerates only) is
//     out of every faction's reach and nobody works Ross 154 (control there is leases only; no faction holds a lease).
//   - Not played: arbitration, whose awards are bounded by the claim the evidence proves and its three open cases a
//     pair (server/arbitration.js), and whose records (overcharges, readiness, royalties) this world does not make;
//     conglomerates; combat. The report names each.

import { accountsStore } from "../../server/game/store.js";
import { mutateAccountState } from "../../server/gameState.js";
import { applyCredits } from "../../server/finances.js";
import { recordExtraction, recordSale } from "../../server/game/dominanceCounters.js";
import { dominanceTick, resetDominanceCache } from "../../server/dominanceService.js";
import { controlNow, resetControlHistory } from "../../server/controlService.js";
import { concessionRecordForTests, concessionTick, petitionConcession, resetConcessions, upkeepFor } from "../../server/concessions.js";
import { chargeTariff, resetTariffs, setTariff, tariffCap, tariffTick } from "../../server/tariffService.js";
import { levyOf } from "../../server/game/tariffs.js";
import { WARFARE_CATALOG as W } from "../../server/warfare.js";
import { allStations } from "../../server/game/stations.js";
import { filePatent, patentTick, recordResearchUse, resetPatentsForTests } from "../../server/patents.js";
import { RESEARCH_LIBRARY } from "../../server/game/catalog.js";
import { openCampaign, pledge, lobbyingTick, parameterInForce, baseOf, resetLobbying } from "../../server/lobbyingService.js";

export const DAY = 86_400_000;
const HOUR = 3_600_000;
const raw = (id) => accountsStore.accounts[id];

/** A credit of control spend buys this many tonnes extracted and this much of sales. */
const TONNES_PER_CREDIT = 0.8 / 18;
const SALES_PER_CREDIT = 0.2 * 5;
/** Everybody else, in every system, every day: tonnes and sales credits. */
export const LOCALS = { tonnes: 800, sales: 20_000 };
/** A faction's base control budget a day, and the spend a policy puts into one system. */
export const BASE_BUDGET = 60_000;
const PER_SYSTEM = 30_000;
/** The share of a day's warfare income a faction reinvests in control the next day. */
export const REINVEST = 1;
export const START_CREDITS = 500_000;
/** Third-party trade a day at each system's station, in credits: WARFARE.md's worked examples, 300,000 elsewhere. */
const TRADE = { "tau-ceti": 570_000, "alpha-centauri": 700_000 };
const tradeAt = (systemId) => TRADE[systemId] ?? 300_000;

/** The factions: a policy each; one starts with twice the budget, to see whether a head start runs away. */
export const FACTIONS = [
  { name: "Head Start", policy: "focused", budgetFactor: 2 },
  { name: "Focused", policy: "focused", budgetFactor: 1 },
  { name: "Broad", policy: "broad", budgetFactor: 1 },
  { name: "Challenger", policy: "challenger", budgetFactor: 1 }
];

export const CONCEDABLE = Object.keys(W.systemRules);
const stationOf = (systemId) => allStations().find((s) => s.systemId === systemId)?.id ?? null;

/** The rate that keeps the most for the holder after the ISA's levy, in the catalog's steps: cap / 1.5 on today's rule. */
export function bestRate(systemId) {
  const cap = tariffCap(systemId);
  let best = { pct: 0, keep: 0 };
  for (let pct = 0; pct <= cap + 1e-9; pct = Math.round((pct + W.tariffs.stepPct) * 100) / 100) {
    const keep = 100_000 * pct / 100 - levyOf(100_000 * pct / 100, pct, cap, W.tariffs);
    if (keep > best.keep) best = { pct, keep };
  }
  return best.pct;
}

const keyOf = (f) => `corp:${f.publicId}`;

/** Where a faction spends today: a policy over the latest control scores. */
function targetsFor(f, i, budget, scores, holdersOf) {
  const n = f.policy === "broad" ? Math.max(1, Math.min(8, Math.floor(budget / (PER_SYSTEM / 2)))) : Math.max(1, Math.floor(budget / PER_SYSTEM));
  const reachable = CONCEDABLE.filter((s) => W.systemRules[s].weights?.leases !== 1 && !(W.systemRules[s].overrides?.holders || W.holders || ["corp", "conglomerate"]).every((h) => h !== "corp"));
  const mine = (s) => scores[s]?.find((h) => `${h.type}:${h.id}` === keyOf(f))?.score || 0;
  const top = (s) => scores[s]?.find((h) => `${h.type}:${h.id}` !== keyOf(f))?.score || 0;
  const held = reachable.filter((s) => holdersOf(s).includes(keyOf(f)));
  // Before any reading, each faction starts in a different part of the galaxy.
  const order = reachable.map((s, k) => ({ s, k: (k + i * 4) % reachable.length }));
  const rank = {
    focused: (s) => mine(s) - top(s),
    broad: (s) => mine(s) - top(s) / 2,
    challenger: (s) => (holdersOf(s).length && !holdersOf(s).includes(keyOf(f)) ? 1 - top(s) : 0) + mine(s) - top(s)
  }[f.policy];
  const ranked = order.sort((a, b) => rank(b.s) - rank(a.s) || a.k - b.k).map((x) => x.s);
  return [...new Set([...held, ...ranked])].slice(0, Math.max(n, held.length));
}

/**
 * The world: FACTIONS and the locals for `days` days. Returns { days: [{ day, held: { name: count }, ... }], factions,
 * refusals }. `register` makes an account and returns { id }; `setTime` moves the clock.
 */
export async function runWarfareWorld({ register, setTime, start, days = 30, factions = FACTIONS, reinvest = REINVEST, tradeScale = 1 }) {
  resetConcessions(); resetTariffs(); resetControlHistory(); resetDominanceCache();
  const make = async (credits) => {
    const { id } = await register();
    const c = raw(id).state.corp;
    c.finances.credits = credits;
    return { id, publicId: c.publicId, corpName: c.corporationName };
  };
  const fs = [];
  for (const spec of factions) fs.push({ ...spec, ...(await make(START_CREDITS)), income: 0, reinvested: 0, spentOnControl: 0, tariffRevenue: 0, upkeepPaid: 0, feesPaid: 0, heldDays: 0, byK: {} });
  const locals = await make(0);
  const payer = await make(1e12);
  const refusals = {};
  const refuse = (what, r) => { const k = `${what}: ${r?.refused?.code || r?.error || r?.status}`; refusals[k] = (refusals[k] || 0) + 1; };
  const holdersOf = (s) => (concessionRecordForTests(s)?.holders || []).map((h) => `${h.holder.type}:${h.holder.id}`);
  const rateFiled = {};
  const out = [];
  let scores = {};
  for (let day = 1; day <= days; day += 1) {
    const t = start + day * DAY + HOUR;
    setTime(t);
    // 1. control: each faction's budget in the systems its policy picks, and the locals everywhere
    fs.forEach((f, i) => {
      const extra = Math.max(0, Math.round(f.income * reinvest));
      const budget = BASE_BUDGET * f.budgetFactor + extra;
      if (extra > 0) mutateAccountState(f.id, (s) => applyCredits(s.corp, -extra, "mining-ops", t), { sanitize: false, settleMining: false });
      f.reinvested += extra;
      f.spentOnControl += budget;
      const targets = targetsFor(f, i, budget, scores, holdersOf);
      const each = budget / targets.length;
      mutateAccountState(f.id, (s) => {
        for (const sys of targets) {
          recordExtraction(s.corp, sys, each * TONNES_PER_CREDIT, t);
          recordSale(s.corp, stationOf(sys), each * SALES_PER_CREDIT, t);
        }
      }, { sanitize: false, settleMining: false });
      f.targets = targets.length;
    });
    mutateAccountState(locals.id, (s) => {
      for (const sys of CONCEDABLE) { recordExtraction(s.corp, sys, LOCALS.tonnes, t); recordSale(s.corp, stationOf(sys), LOCALS.sales, t); }
    }, { sanitize: false, settleMining: false });
    // 2. the day's readings, reviews, renewals and upkeep
    dominanceTick(t);
    const before = Object.fromEntries(fs.map((f) => [f.id, raw(f.id).state.corp.finances.credits]));
    concessionTick(t);
    scores = Object.fromEntries(CONCEDABLE.map((s) => [s, controlNow(s, t).scores]));
    // 3. petitions where a faction is eligible and holds nothing yet
    for (const f of fs) {
      for (const sys of CONCEDABLE) {
        if (holdersOf(sys).includes(keyOf(f)) || !controlNow(sys, t).eligible.has(keyOf(f))) continue;
        raw(f.id).state.corp.currentSystemId = sys; // docked (no travel)
        const r = petitionConcession(f.id, sys, t);
        if (r.refused) { if (!["already-petitioned", "first-recorded"].includes(r.refused.code)) refuse("petition", r); }
        else f.feesPaid += (W.systemRules[sys].overrides?.concessionPetitionFee ?? W.concessionPetitionFee);
      }
    }
    // 4. holders file their best rate; the day's trade pays it
    for (const sys of CONCEDABLE) {
      for (const key of holdersOf(sys)) {
        const f = fs.find((x) => keyOf(x) === key);
        if (!f) continue;
        const pct = bestRate(sys);
        if (rateFiled[`${sys}:${key}`] !== pct) {
          raw(f.id).state.corp.currentSystemId = sys;
          const r = setTariff(raw(f.id).state.corp, sys, pct, t);
          if (r.ok) rateFiled[`${sys}:${key}`] = pct; else refuse("tariff", r);
        }
      }
      if (holdersOf(sys).length && stationOf(sys)) {
        mutateAccountState(payer.id, (s) => { chargeTariff(s.corp, { stationId: stationOf(sys), base: tradeAt(sys) * tradeScale, now: t }); }, { sanitize: false, settleMining: false });
      }
    }
    const paid = tariffTick(t);
    // 5. the day's warfare income: tariffs in, upkeep and fees out
    for (const f of fs) {
      const revenue = paid.filter((p) => p.holder?.type === "corp" && p.holder.id === f.publicId).reduce((a, p) => a + p.credits, 0);
      const held = CONCEDABLE.filter((s) => holdersOf(s).includes(keyOf(f)));
      const upkeep = held.reduce((a, s) => a + upkeepFor({ type: "corp", id: f.publicId }, s, t), 0);
      f.tariffRevenue += revenue;
      f.upkeepPaid += upkeep;
      f.heldDays += held.length;
      if (held.length) {
        const row = (f.byK[held.length] ||= { days: 0, revenue: 0, upkeep: 0 });
        row.days += 1; row.revenue += revenue; row.upkeep += upkeep;
      }
      f.income = raw(f.id).state.corp.finances.credits - before[f.id];
    }
    out.push({
      day,
      held: Object.fromEntries(fs.map((f) => [f.name, CONCEDABLE.filter((s) => holdersOf(s).includes(keyOf(f))).length])),
      targets: Object.fromEntries(fs.map((f) => [f.name, f.targets])),
      credits: Object.fromEntries(fs.map((f) => [f.name, Math.round(raw(f.id).state.corp.finances.credits)]))
    });
  }
  return { days: out, factions: fs.map(({ name, policy, budgetFactor, spentOnControl, reinvested, tariffRevenue, upkeepPaid, feesPaid, heldDays, byK }) => ({ name, policy, budgetFactor, spentOnControl, reinvested, tariffRevenue, upkeepPaid, feesPaid, heldDays, byK })), refusals, concedable: CONCEDABLE.length, tradeScale };
}

/** The top faction's share of concedable systems on `day`. */
export function topShare(world, day) {
  const row = world.days.find((d) => d.day === day) ?? world.days.at(-1);
  const [name, n] = Object.entries(row.held).sort((a, b) => b[1] - a[1])[0];
  return { day: row.day, name, held: n, share: n / world.concedable };
}

/**
 * The concession lever's return as holdings grow: what the k-th concession adds a day (its system's tariff keep at the
 * best rate, less the upkeep of holding k instead of k - 1, on the real upkeepFor rule at no use discount).
 */
export function concessionCurve(maxK = 8, systemId = "alpha-centauri", tradeScale = 1) {
  const terms = { base: W.concessionUpkeepBase, factor: W.systemRules[systemId]?.overrides?.upkeepFactor ?? 1 };
  const pct = bestRate(systemId);
  const trade = tradeAt("default") * tradeScale;
  const keep = trade * pct / 100 - levyOf(trade * pct / 100, pct, tariffCap(systemId), W.tariffs);
  const rows = [];
  for (let k = 1; k <= maxK; k += 1) {
    const total = (n) => terms.base * n * n * terms.factor; // k concessions at base x k each (upkeepFor), no discount
    const marginalUpkeep = total(k) - total(k - 1);
    rows.push({ k, keep: Math.round(keep), marginalUpkeep, marginal: Math.round(keep - marginalUpkeep), totalNet: Math.round(k * keep - total(k)) });
  }
  return { systemId, pct, trade, rows };
}

/**
 * Patents: a holder files on each research node, cheapest first, and three rivals then research it and pay the
 * royalty at the catalog's maximum rate. The curve is cumulative filing spend against royalties received.
 */
export async function patentCurve({ register, setTime, t, users = 3 }) {
  resetPatentsForTests();
  const { id: holderId } = await register();
  const rivals = [];
  for (let i = 0; i < users; i += 1) rivals.push((await register()).id);
  raw(holderId).state.corp.finances.credits = 10_000_000;
  for (const r of rivals) raw(r).state.corp.finances.credits = 10_000_000;
  const nodes = Object.values(RESEARCH_LIBRARY).filter((n) => n.status !== "planned").sort((a, b) => b.costCredits - a.costCredits);
  const rate = W.patents.royaltyMaxPct;
  const rows = [];
  let spent = 0, received = 0;
  const credits = () => raw(holderId).state.corp.finances.credits;
  for (const node of nodes) {
    setTime(t);
    mutateAccountState(holderId, (s) => { s.corp.researchCompletedAt = { ...(s.corp.researchCompletedAt || {}), [node.id]: t - HOUR }; }, { sanitize: false, settleMining: false });
    const before = credits();
    const filed = filePatent(holderId, { kind: "research", subjectId: node.id, ratePct: rate }, t);
    if (filed.refused) { rows.push({ subject: node.id, refused: filed.refused.code }); continue; }
    spent += before - credits();
    const mid = credits();
    for (const r of rivals) mutateAccountState(r, (s) => { recordResearchUse(s.corp, node.id, t + HOUR); }, { sanitize: false, settleMining: false });
    setTime(t + 2 * HOUR);
    patentTick(t + 2 * HOUR);
    received += credits() - mid;
    rows.push({ subject: node.id, cost: node.costCredits, spent, received, ratio: spent ? received / spent : null });
    t += 3 * HOUR;
  }
  return { rate, users, rows: rows.filter((r) => !r.refused), refused: rows.filter((r) => r.refused) };
}

/**
 * Lobbying: a concession holder pledges more and more credits to raise a system's tariff cap, one campaign per step
 * (a fresh world each: the cooldown is not what is measured). The return is what the higher cap lets it keep of the
 * system's trade at its best rate, over the campaign's duration.
 */
export async function lobbyingCurve({ register, setTime, t, systemId = "alpha-centauri", pledges = [5_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000] }) {
  const p = W.lobbying.parameters.tariffCapPct;
  const rows = [];
  const keepAt = (cap) => {
    let best = 0;
    for (let pct = 0; pct <= cap + 1e-9; pct = Math.round((pct + W.tariffs.stepPct) * 100) / 100) {
      const amt = tradeAt(systemId) * pct / 100;
      best = Math.max(best, amt - levyOf(amt, pct, cap, W.tariffs));
    }
    return best;
  };
  for (const credits of pledges) {
    resetLobbying();
    const { id } = await register();
    const c = raw(id).state.corp;
    c.finances.credits = credits + 100_000;
    c.standing = { ...(c.standing || {}), [p.faction]: W.standing.max ?? 100 };
    Object.assign(c, { currentSystemId: systemId });
    setTime(t);
    const base = Number(baseOf(systemId, "tariffCapPct"));
    const opened = openCampaign(c, { parameter: "tariffCapPct", systemId, direction: "raise" }, t);
    if (!opened.ok) { rows.push({ credits, refused: opened.error || opened.status }); continue; }
    const pl = pledge(c, opened.campaign.id, { side: "for", credits }, t + HOUR);
    if (!pl.ok) { rows.push({ credits, refused: pl.error || pl.status }); continue; }
    const end = t + (W.lobbying.pledgeHours + 1) * HOUR;
    setTime(end);
    lobbyingTick(end);
    const cap = Number(parameterInForce(systemId, "tariffCapPct", end + HOUR));
    const extra = (keepAt(cap) - keepAt(base)) * W.lobbying.durationDays;
    rows.push({ credits, base, cap, shift: Math.round((cap - base) * 100) / 100, extraKeep: Math.round(extra), ratio: extra / credits });
    t = end + DAY;
  }
  return { systemId, maxShift: p.maxShift, spendScale: p.spendScale, rows };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const n0 = (x) => Math.round(Number(x) || 0).toLocaleString("en-US");

/** The targets, PASS or FAIL. Printed, never asserted: misses are filed as balance bugs. */
export function targets({ world, concession, patents, lobbying }) {
  const first = (rows) => rows.find((r) => r.marginal < 0)?.k;
  const top30 = topShare(world, 30);
  const growing = (rows, f) => rows.length > 2 && rows.slice(1).every((r, i) => f(r) > f(rows[i]) + 1e-9);
  const conGrows = growing(concession.rows, (r) => r.marginal);
  const patGrows = growing(patents.rows, (r) => r.ratio);
  const lobbyRows = lobbying.rows.filter((r) => !r.refused);
  const lobGrows = growing(lobbyRows, (r) => r.ratio);
  return [
    { target: "the top faction holds no more than 50% of concedable systems at day 30", result: top30.share <= 0.5 ? "PASS" : "FAIL", detail: `${top30.name} holds ${top30.held} of ${world.concedable} (${pct(top30.share)})` },
    { target: "concessions: the return does not grow without bound as holdings grow", result: conGrows ? "FAIL" : "PASS", detail: `concession number ${first(concession.rows) ?? "none of 8"} is the first to lose money a day (${concession.rows.map((r) => `k${r.k} ${n0(r.marginal)}`).join(", ")})` },
    { target: "patents: return per credit of filing does not grow as filing spend grows", result: patGrows ? "FAIL" : "PASS", detail: patents.rows.length ? `${n0(patents.rows[0].spent)} spent returns ${patents.rows[0].ratio.toFixed(1)}x; ${n0(patents.rows.at(-1).spent)} spent returns ${patents.rows.at(-1).ratio.toFixed(1)}x` : "no patent filed" },
    { target: "lobbying: return per credit pledged does not grow as the pledge grows", result: !lobbyRows.length ? "NOT RUN" : lobGrows ? "FAIL" : "PASS", detail: lobbyRows.length ? lobbyRows.map((r) => `${n0(r.credits)}: +${r.shift} cap, ${r.ratio.toFixed(2)}x`).join("; ") : lobbying.rows.map((r) => `${n0(r.credits)} refused ${r.refused}`).join("; ") },
    { target: "arbitration: an award is bounded by its claim (not played)", result: "NOT RUN", detail: "awards are the proven overcharge or shortfall, three open cases a pair (server/arbitration.js); this world makes no records to claim on" }
  ];
}

export function formatReport({ world, concession, patents, lobbying, rich = null, richCurve = null }) {
  const lines = [];
  lines.push("ISP warfare economy together (ISP-271, AB#967). BOT NUMBERS (P-PROXY): factions on fixed policies in an assumed economy; the numbers measure whether the rules let one run away, not how anybody plays.");
  lines.push(`World: ${world.days.length} days, ${world.concedable} concedable systems, factions ${FACTIONS.map((f) => `${f.name} (${f.policy}${f.budgetFactor > 1 ? `, ${f.budgetFactor}x budget` : ""})`).join(", ")}; base budget ${n0(BASE_BUDGET)} a day, warfare income reinvested x${REINVEST}; locals ${n0(LOCALS.tonnes)} t and ${n0(LOCALS.sales)} of sales a day in every system.`);
  lines.push("");
  lines.push("Concessions held, by day:");
  lines.push(`  day | ${FACTIONS.map((f) => f.name).join(" | ")}`);
  for (const d of world.days) if (d.day % 3 === 0 || d.day === 7 || d.day === world.days.length) lines.push(`  ${String(d.day).padStart(3)} | ${FACTIONS.map((f) => String(d.held[f.name]).padStart(f.name.length)).join(" | ")}`);
  for (const day of [...new Set([7, 30, world.days.length])]) { const s = topShare(world, day); lines.push(`Top faction at day ${s.day}: ${s.name}, ${s.held} of ${world.concedable} (${pct(s.share)})`); }
  lines.push("");
  lines.push("Each faction's warfare account over the run:");
  for (const f of world.factions) lines.push(`  ${f.name}: control spent ${n0(f.spentOnControl)} (${n0(f.reinvested)} of it reinvested income); tariffs ${n0(f.tariffRevenue)}, upkeep ${n0(f.upkeepPaid)}, petition fees ${n0(f.feesPaid)}; ${f.heldDays} concession-days; by holdings: ${Object.entries(f.byK).map(([k, r]) => `k${k} ${r.days}d, ${n0((r.revenue - r.upkeep) / r.days)}/day net`).join("; ") || "none"}`);
  lines.push(`  refused: ${Object.entries(world.refusals).map(([k, v]) => `${v}x ${k}`).join("; ") || "nothing"}`);
  lines.push("");
  for (const c of [concession, richCurve].filter(Boolean)) {
    lines.push(`Concession lever (${c.systemId}'s rule, ${n0(c.trade)} of trade a day, best rate ${c.pct}%): what the k-th concession adds a day, net of the extra upkeep:`);
    lines.push(`  ${c.rows.map((r) => `k${r.k} ${n0(r.marginal)} (all k: ${n0(r.totalNet)})`).join(" | ")}`);
  }
  lines.push(`Patent lever (${patents.users} rivals each pay a ${patents.rate}% royalty; dearest research first): cumulative filing spend and royalties:`);
  lines.push(`  ${patents.rows.filter((_, i) => i % 5 === 0 || i === patents.rows.length - 1).map((r) => `${n0(r.spent)} -> ${n0(r.received)} (${r.ratio.toFixed(1)}x)`).join(" | ")}`);
  lines.push(`Lobbying lever (tariff cap at ${lobbying.systemId}, max shift ${lobbying.maxShift}, spend scale ${n0(lobbying.spendScale)}): pledge, cap moved, extra kept over the campaign:`);
  lines.push(`  ${lobbying.rows.map((r) => (r.refused ? `${n0(r.credits)} refused (${r.refused})` : `${n0(r.credits)} -> +${r.shift} (${n0(r.extraKeep)}, ${r.ratio.toFixed(2)}x)`)).join(" | ")}`);
  lines.push("");
  if (rich) {
    lines.push(`Sensitivity, not a target: the same world with ${rich.tradeScale}x the trade in every held system (the brake is the upkeep, sized against the trade):`);
    for (const d of rich.days) if (d.day % 6 === 0 || d.day === rich.days.length) lines.push(`  day ${String(d.day).padStart(3)}: ${FACTIONS.map((f) => `${f.name} ${d.held[f.name]}`).join(", ")}`);
    const s = topShare(rich, 30);
    lines.push(`  top faction at day ${s.day}: ${s.name}, ${s.held} of ${rich.concedable} (${pct(s.share)})`);
    const e = topShare(rich, rich.days.length);
    if (e.day !== 30) lines.push(`  top faction at day ${e.day}: ${e.name}, ${e.held} of ${rich.concedable} (${pct(e.share)})`);
    for (const f of rich.factions) lines.push(`  ${f.name}: control ${n0(f.spentOnControl)} (${n0(f.reinvested)} reinvested); tariffs ${n0(f.tariffRevenue)}, upkeep ${n0(f.upkeepPaid)}`);
  }
  for (const t of targets({ world, concession, patents, lobbying })) lines.push(`${t.result.padEnd(7)} ${t.target}: ${t.detail}`);
  return lines.join("\n");
}
