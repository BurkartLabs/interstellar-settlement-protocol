// ISP-234 (AB#929): the tariff and dumping profile of the ISP probe, the same shape as marketsProbe.js, combatProbe.js
// and conglomerateProbe.js. Two parts:
//   A. Tariffs. A concession holder sweeps its tariff from the cap down to 0 in the catalog's steps, one day's trade at
//      each step, while one trader bot per good sells the system's trade mix at the station or routes around the tariff.
//      It prints what the holder keeps at each step and the step that keeps the most, with the ISA's levy checked
//      against the rule, and checks a condominium's lower-rate charge and revenue split.
//   B. Dumping. An incumbent rival fills the order book's daily demand for one item at its normal value. A flooder with
//      goods to move either sells them to the NPC standing bid (its twin week, the baseline) or undercuts the rival in
//      the book and sends what the book does not take to the bid (the flood week). The ITC watch runs at the next two
//      00:00 UTC ticks, finding and then levying. It prints each flood's damage to the rival, as a share of the rival's
//      daily revenue, and the flooder's net against its twin after the duty.
//
// BOT NUMBERS (P-PROXY, DOCTRINE P-005). A bot is not a player. What these numbers measure is whether the tariff's levy
// puts the holder's best rate below the cap, and whether the dumping lines make a damaging flood cost the flooder, on
// the server's real settlement code and an assumed market; they are not a fact about how anybody sets a tariff, trades
// or floods.
//
// WHAT IS REAL AND WHAT IS ASSUMED:
//   - Real (the server's own code, with the clock moved): the concession (petitionConcession, reviewConcessions on 14
//     days of control readings), filing a rate (setTariff: the holder docked, the steps, 72 hours' notice on an
//     increase, a decrease at once), the rate each sale pays and its levy (chargeTariff, reached through paySeller, the
//     settlement of a filled listing), the holder's accrual and the day's payout (tariffSummary, tariffTick), the
//     condominium's lower rate and split. For dumping: the settlement of each listing fill (paySeller, which logs the
//     own-priced sale for the watch and withholds duty owed), sales to the standing bid through its route (the bid's
//     drift with the day's volume), the price history (recordTrade), and the watch (itcTick: finding, then levy).
//   - Assumed: the trade. A system's day of trade is WARFARE.md's worked-example mix ("placeholders for ECONOMY.md to
//     price"), each good at its NPC base price; a trader leaves when the tariff on a unit exceeds one jump's logistics
//     fee (5 a unit, WARFARE.md), and a good that leaves pays no tariff (the transfer is not simulated). The book's
//     demand is fixed and price-blind: probe buyers take the cheapest listing first, up to the item's normal daily
//     volume. The rival does not answer the flood (it keeps its price). The normal value's seven days are seeded at the
//     item's NPC base price and volume, as if the market traded there. The flooder sells to the bid in lots of 100
//     (walking the curve as the design intends; Bug #2356: one lot is paid the opening bid for all of it), and nobody
//     else sells to the bid that week. The book's player-to-player share (DEPTH's 25% check) is an input here, not a
//     measurement.

import request from "supertest";
import { accountsStore } from "../../server/game/store.js";
import { getAccountById, getState, mutateAccountState, mutateState, ensureBidShape, bidQuotaFor } from "../../server/gameState.js";
import { recordControlDay, resetControlHistory } from "../../server/controlService.js";
import { petitionConcession, publicConcession, resetConcessions, reviewConcessions } from "../../server/concessions.js";
import { levyOf } from "../../server/game/tariffs.js";
import { resetTariffs, setTariff, tariffCap, tariffSummary, tariffTick, tariffView } from "../../server/tariffService.js";
import { findingsFor, itcTick, resetItc } from "../../server/itcService.js";
import { paySeller } from "../../server/marketSettlement.js";
import { recordTrade } from "../../server/priceHistory.js";
import { WARFARE_CATALOG as W } from "../../server/warfare.js";
import { ECONOMY } from "../../server/economy.js";

export const DAY = 86_400_000;
const HOUR = 3_600_000;
const ESCAPE_PER_UNIT = ECONOMY.logistics.sameSystemFeePerUnit + ECONOMY.logistics.perJumpFeePerUnit; // one jump: 5
const basePrice = (item) => Number(ECONOMY.npcBuyers.find((b) => b.item === item)?.unitPrice) || 0;
const corpOf = (id) => getAccountById(id).state.corp;
const raw = (id) => accountsStore.accounts[id];

/** WARFARE.md's worked examples: a day of others' sales at the system's station, in credits by good. */
export const SYSTEMS = [
  { systemId: "tau-ceti", stationId: "verde-trade-hub", name: "Tau Ceti", mix: { Silicates: 120_000, Titanium: 60_000, "Helium-3": 40_000, "Rare Earths": 40_000, "Fusion Pellets": 30_000, "Rare-Earth Magnets": 40_000, "Platinum-Group Metals": 40_000, "Ion Thrusters": 60_000, "Superconducting Coils": 60_000, "Antimatter Drives": 80_000 }, designBest: 2.5 },
  { systemId: "alpha-centauri", stationId: "centauri-prime-station", name: "Alpha Centauri", mix: { Silicates: 300_000, Titanium: 150_000, "Helium-3": 100_000, "Fusion Pellets": 50_000, "Platinum-Group Metals": 50_000, "Catalyst Beds": 50_000 }, designBest: 2 }
];
/** The flood's item: normal value is its NPC base, normal daily volume (and the book's demand) is FLOOD_DEMAND. */
export const FLOOD_ITEM = "Platinum-Group Metals";
export const FLOOD_DEMAND = 2_000;
export const PRICE_FRACTIONS = [0.95, 0.9, 0.85, 0.84, 0.75, 0.6, 0.5];
export const FLOOD_SHARES = [0.1, 0.2, 0.5, 1, 2]; // the flooder's units a day, as a share of the book's daily demand
const FLOOD_STATION = "earth-station-prime"; // Sol: never conceded, so no tariff in the dumping part

async function corp(register, { systemId, stationId, credits = 1_000_000 }) {
  const { id, token } = await register();
  const c = raw(id).state.corp;
  Object.assign(c, { currentSystemId: systemId, currentStationId: stationId });
  c.finances.credits = credits;
  c.inventory = { [stationId]: {} };
  return { id, token, holder: { type: "corp", id: c.publicId, name: c.corporationName } };
}

function readings(systemId, rows, newestAt) {
  for (let i = 13; i >= 0; i -= 1) {
    recordControlDay({ computedAt: newestAt - i * DAY, holders: { [systemId]: { live: ["extraction", "leases"], groups: rows.map(([h, s]) => ({ type: h.type, id: h.id, name: h.name, parts: { extraction: s, leases: s, sales: 0 } })) } } });
  }
}
/** `a` petitions at `t` and is granted 72 hours later on fresh readings (TERRITORY.md's review). Returns the grant time. */
function grant(setTime, a, rows, systemId, t) {
  setTime(t);
  readings(systemId, rows, t - HOUR);
  const p = petitionConcession(a.id, systemId, t);
  if (p.refused) throw new Error(`petition in ${systemId}: ${p.refused.error}`);
  readings(systemId, rows, t + 71 * HOUR);
  setTime(t + 72 * HOUR);
  reviewConcessions(t + 72 * HOUR);
  return t + 72 * HOUR;
}
const kept = (holderId, systemId) => {
  const h = tariffSummary(corpOf(holderId)).holdings.find((x) => x.systemId === systemId);
  return h ? h.accrued + h.paidTotal : 0;
};
const sell = (sellerId, item, quantity, unitPrice, stationId, tariffPct = null) =>
  paySeller({ sellerAccountId: sellerId, item, quantity, unitPrice, stationId, tariffPct }, quantity, "Probe buyer");

/** Part A for one system: the holder files the cap, waits out the notice, then steps down to 0, a day of trade a step. */
async function sweepSystem(sys, { register, setTime, t }) {
  const cap = tariffCap(sys.systemId);
  const holder = await corp(register, sys), rival = await corp(register, sys);
  const traders = {};
  for (const item of Object.keys(sys.mix)) traders[item] = await corp(register, sys);
  const granted = grant(setTime, holder, [[holder.holder, 0.6], [rival.holder, 0.2]], sys.systemId, t);
  const filed = setTariff(corpOf(holder.id), sys.systemId, cap, granted);
  if (!filed.ok) throw new Error(`filing the cap in ${sys.systemId}: ${filed.error}`);
  let now = granted + (W.tariffs.noticeHours + 1) * HOUR;
  const steps = [];
  let sales = 0;
  for (let pct = cap; pct >= -1e-9; pct = Math.round((pct - W.tariffs.stepPct) * 100) / 100) {
    setTime(now);
    const set = setTariff(corpOf(holder.id), sys.systemId, pct, now);
    const view = tariffView(sys.systemId, now);
    const before = kept(holder.id, sys.systemId);
    let stay = 0, left = 0, paid = 0, levyRule = 0;
    for (const [item, value] of Object.entries(sys.mix)) {
      const price = basePrice(item);
      const units = Math.round(value / price);
      if ((view.pct / 100) * price > ESCAPE_PER_UNIT) { left += units * price; continue; } // routed one jump away
      const sale = sell(traders[item].id, item, units, price, sys.stationId, view.pct);
      sales += 1;
      stay += units * price;
      paid += sale?.tariffAmount || 0;
      levyRule += levyOf(sale?.tariffAmount || 0, view.pct, cap, W.tariffs);
    }
    const keep = kept(holder.id, sys.systemId) - before;
    steps.push({ pct, filedOk: Boolean(set.ok), charged: view.pct, stay, left, paid, levy: paid - keep, levyRule, keep });
    now += HOUR;
  }
  steps.reverse();
  setTime(now);
  const accrued = tariffSummary(corpOf(holder.id)).holdings.find((x) => x.systemId === sys.systemId)?.accrued || 0;
  const credits = corpOf(holder.id).finances.credits;
  const payout = tariffTick(now).filter((p) => p.systemId === sys.systemId).reduce((s, p) => s + p.credits, 0);
  const best = steps.reduce((a, s) => (s.keep > a.keep ? s : a), steps[0]);
  return { ...sys, cap, steps, best, sales, tick: { accrued, payout, credited: corpOf(holder.id).finances.credits - credits }, end: now + DAY };
}

/** Part A's condominium: two holders, one files the cap and the other a lower rate; one day's Tau-Ceti-sized trade. */
async function condominium({ register, setTime, t }) {
  const sys = { systemId: "61-cygni", stationId: "cygni-condominium" };
  const cap = tariffCap(sys.systemId);
  const x = await corp(register, sys), y = await corp(register, sys), z = await corp(register, sys);
  grant(setTime, x, [[x.holder, 0.45], [y.holder, 0.42], [z.holder, 0.1]], sys.systemId, t);
  resetControlHistory();
  const granted = grant(setTime, y, [[y.holder, 0.46], [z.holder, 0.44], [x.holder, 0.05]], sys.systemId, t + 73 * HOUR);
  const holders = publicConcession(sys.systemId, granted).holders.filter((h) => h.benefits).length;
  const low = cap / 2;
  setTariff(corpOf(x.id), sys.systemId, cap, granted);
  setTariff(corpOf(y.id), sys.systemId, low, granted);
  const now = granted + (W.tariffs.noticeHours + 1) * HOUR;
  setTime(now);
  const charged = tariffView(sys.systemId, now).pct;
  const sale = sell(z.id, "Titanium", 5_000, basePrice("Titanium"), sys.stationId, charged);
  const before = [corpOf(x.id).finances.credits, corpOf(y.id).finances.credits];
  tariffTick(now + DAY); // a new UTC day: the holders are paid
  const split = [corpOf(x.id).finances.credits - before[0], corpOf(y.id).finances.credits - before[1]];
  const tariff = sale?.tariffAmount || 0;
  return { holders, cap, filed: [cap, low], charged, tariff, levyRule: levyOf(tariff, charged, cap, W.tariffs), split, end: now + 2 * DAY };
}

// ─── Part B: dumping ────────────────────────────────────────────────────────────

/** A fresh week for the item: its history seeded over the seven normal days, the watch forgotten, the bid at base. */
function freshWeek(item, weekStart, normal, volume) {
  resetItc();
  mutateState((draft) => {
    draft.market.priceHistory ||= {};
    draft.market.priceHistory[item] = [];
    for (let d = 0; d < W.dumping.normalValueDays; d += 1) recordTrade(draft.market.priceHistory, item, normal, volume, weekStart + d * DAY + 12 * HOUR);
  });
  resetBid(item);
}
function resetBid(item) {
  mutateState((draft) => {
    for (const o of draft.market.npcBuyOrders || []) {
      if (o.item !== item) continue;
      ensureBidShape(o);
      Object.assign(o, { soldToday: 0, remainingQty: bidQuotaFor(o), unitPrice: o.basePrice });
    }
  });
}
const bidOrder = (item) => (getState().market?.npcBuyOrders || []).find((o) => o.item === item);

/** The flooder sells `units` to the standing bid through its route, in lots of 100. Returns the refusals, if any. */
async function sellToBid(app, who, item, units) {
  const refused = [];
  mutateAccountState(who.id, (s) => { s.corp.inventory[FLOOD_STATION] = { ...(s.corp.inventory[FLOOD_STATION] || {}), [item]: units }; });
  for (let left = units; left > 0; left -= 100) {
    const res = await request(app).post(`/api/market/npc-orders/${bidOrder(item).id}/sell`).set("Authorization", `Bearer ${who.token}`).send({ quantity: Math.min(100, left) });
    if (res.status !== 200) { refused.push(res.body?.error || res.status); break; }
  }
  return refused;
}

/**
 * One week for a flooder with `units` a day: `price` null is the baseline (all to the bid), else a listing at `price`
 * that the book's buyers take first. The window is days 7 to 9; the watch finds at day 10's tick and levies at day 11's.
 */
async function floodWeek(app, setTime, tokenFor, { flooder, rival }, weekStart, units, price) {
  const item = FLOOD_ITEM, N = basePrice(item), D = FLOOD_DEMAND;
  setTime(weekStart);
  flooder.token = await tokenFor(flooder.id); // the clock runs for months: a token signed now, not at registration
  freshWeek(item, weekStart, N, D);
  const credits0 = corpOf(flooder.id).finances.credits;
  let rivalRevenue = 0, booked = 0;
  const refused = [];
  for (let d = W.dumping.normalValueDays; d < W.dumping.normalValueDays + W.dumping.windowDays; d += 1) {
    setTime(weekStart + d * DAY + 12 * HOUR);
    const taken = price === null ? 0 : Math.min(units, D);
    if (taken > 0) {
      sell(flooder.id, item, taken, price, FLOOD_STATION);
      mutateState((draft) => recordTrade(draft.market.priceHistory, item, price, taken));
      booked += taken;
    }
    const rivalUnits = D - taken;
    if (rivalUnits > 0) {
      sell(rival.id, item, rivalUnits, N, FLOOD_STATION);
      mutateState((draft) => recordTrade(draft.market.priceHistory, item, N, rivalUnits));
      rivalRevenue += rivalUnits * N;
    }
    refused.push(...(await sellToBid(app, flooder, item, units - taken)));
  }
  const tick = weekStart + (W.dumping.normalValueDays + W.dumping.windowDays) * DAY + 60_000;
  setTime(tick);
  itcTick(tick);
  setTime(tick + DAY);
  itcTick(tick + DAY);
  const finding = findingsFor(corpOf(flooder.id).publicId)[0] || null;
  return { net: corpOf(flooder.id).finances.credits - credits0, rivalRevenue, booked, duty: finding?.duty || 0, found: Boolean(finding), leviedPaid: finding?.paid || 0, refused };
}

/**
 * Play the probe. `register()` makes an account through the server and returns { id, token }; `setTime(t)` moves the
 * clock; `tokenFor(id)` signs an access token at the clock's time. `fractions` x `shares` is the flood grid.
 */
export async function runTariffProbe({ app, register, setTime, tokenFor, start, systems = SYSTEMS, fractions = PRICE_FRACTIONS, shares = FLOOD_SHARES }) {
  resetConcessions(); resetControlHistory(); resetTariffs(); resetItc();
  let t = start;
  const sweeps = [];
  for (const sys of systems) {
    const s = await sweepSystem(sys, { register, setTime, t });
    sweeps.push(s);
    t = s.end;
  }
  const condo = await condominium({ register, setTime, t });
  t = condo.end;

  const flood = { flooder: await corp(register, { systemId: "sol", stationId: FLOOD_STATION, credits: 50_000_000 }), rival: await corp(register, { systemId: "sol", stationId: FLOOD_STATION, credits: 1_000_000 }) };
  let week = Date.parse(`${new Date(t + 7 * DAY).toISOString().slice(0, 10)}T00:00:00Z`);
  const N = basePrice(FLOOD_ITEM), rivalBase = FLOOD_DEMAND * N * W.dumping.windowDays;
  const cells = [];
  let trades = 0;
  for (const share of shares) {
    const units = Math.round(share * FLOOD_DEMAND);
    const baseline = await floodWeek(app, setTime, tokenFor, flood, week, units, null);
    week += 14 * DAY;
    for (const f of fractions) {
      const price = Math.round(f * N);
      const r = await floodWeek(app, setTime, tokenFor, flood, week, units, price);
      week += 14 * DAY;
      trades += r.booked > 0 ? 1 : 0;
      cells.push({ share, units, fraction: f, price, damagePct: (100 * (rivalBase - r.rivalRevenue)) / rivalBase, net: r.net - baseline.net, duty: r.duty, found: r.found, paid: r.leviedPaid, refused: [...baseline.refused, ...r.refused] });
    }
  }
  resetConcessions(); resetControlHistory(); resetTariffs(); resetItc();
  return { sweeps, condo, cells, trades, sales: sweeps.reduce((s, x) => s + x.sales, 0), N, demand: FLOOD_DEMAND };
}

// ─── The report ────────────────────────────────────────────────────────────────

const n0 = (x) => Math.round(x).toLocaleString("en-US");
const signed = (x) => `${x >= 0 ? "+" : ""}${n0(x)}`;

/** The targets AB#929 names, each PASS or FAIL with its numbers. Never softened here: a miss is reported and filed. */
export function targets(report) {
  const damaging = report.cells.filter((c) => c.damagePct >= 20);
  const profitable = damaging.filter((c) => c.net >= 0);
  const foundProfitable = profitable.filter((c) => c.found);
  const levyOff = report.sweeps.flatMap((s) => s.steps.filter((x) => x.levy !== x.levyRule).map((x) => `${s.name} ${x.pct}%`));
  const condoOk = report.condo.holders === 2 && report.condo.charged === report.condo.filed[1] && report.condo.split.reduce((a, b) => a + b, 0) === report.condo.tariff - report.condo.levyRule && Math.abs(report.condo.split[0] - report.condo.split[1]) <= 1;
  return [
    ...report.sweeps.map((s) => ({ target: `${s.name}: the revenue-maximising tariff is strictly below the cap (${s.cap}%)`, result: s.best.pct < s.cap ? "PASS" : "FAIL", detail: `best ${s.best.pct}% keeps ${n0(s.best.keep)} a day; the cap keeps ${n0(s.steps.at(-1).keep)} (design's worked example: ${s.designBest}%)` })),
    { target: "the ISA levy on every step is isaLevyAtCapPct x rate / cap of the tariff", result: levyOff.length ? "FAIL" : "PASS", detail: levyOff.length ? `off at ${levyOff.join(", ")}` : `${report.sweeps.reduce((s, x) => s + x.steps.length, 0)} steps` },
    { target: "a condominium charges the lower of its holders' rates and splits the revenue", result: condoOk ? "PASS" : "FAIL", detail: `${report.condo.holders} holders filed ${report.condo.filed.join("% and ")}%, charged ${report.condo.charged}%; tariff ${n0(report.condo.tariff)}, levy ${n0(report.condo.levyRule)}, paid ${report.condo.split.map(n0).join(" + ")}` },
    { target: "a flood that damages the rival by 20% or more of its daily revenue is net-negative for the flooder after duty", result: profitable.length ? "FAIL" : "PASS", detail: profitable.length ? `${profitable.length} of ${damaging.length} damaging floods profit (${foundProfitable.length} of them found by the watch): ${profitable.map((c) => `${c.fraction * 100}% x ${c.share}D ${signed(c.net)}`).join(", ")}` : `${damaging.length} damaging floods, all net-negative` }
  ];
}

/** The report as text, headed with what it is (P-PROXY). */
export function formatReport(report) {
  const lines = [];
  lines.push("ISP tariff and dumping probe (ISP-234, AB#929). BOT NUMBERS (P-PROXY): bots on fixed policies in an assumed market, not players.");
  lines.push(`${report.sales} tariffed trader sales; ${report.cells.length} flood weeks with ${report.trades} flooding.`);
  for (const s of report.sweeps) {
    lines.push("");
    lines.push(`A. ${s.name} (cap ${s.cap}%): one day of the worked example's trade (${n0(Object.values(s.mix).reduce((a, b) => a + b, 0))} credits) at each step; a good leaves when rate x price > ${ESCAPE_PER_UNIT} a unit.`);
    lines.push("   tariff | sales that stay | tariff paid | ISA levy | holder keeps");
    for (const x of s.steps) lines.push(`   ${`${x.pct.toFixed(2)}%`.padStart(6)} | ${n0(x.stay).padStart(15)} | ${n0(x.paid).padStart(11)} | ${n0(x.levy).padStart(8)} | ${n0(x.keep).padStart(12)}${x === s.best ? "  <- most" : ""}${x.charged !== x.pct ? `  (charged ${x.charged}%)` : ""}`);
    lines.push(`   The day's tick paid the holder ${n0(s.tick.payout)} (accrued ${n0(s.tick.accrued)}; credits moved ${n0(s.tick.credited)}).`);
  }
  lines.push("");
  lines.push(`A. Condominium (61 Cygni, cap ${report.condo.cap}%): ${report.condo.holders} holders filed ${report.condo.filed.join("% and ")}%, the system charged ${report.condo.charged}%. A 5,000 Titanium sale paid ${n0(report.condo.tariff)}; levy ${n0(report.condo.levyRule)}; the holders were paid ${report.condo.split.map(n0).join(" and ")}.`);
  lines.push("");
  lines.push(`B. Dumping: ${FLOOD_ITEM}, normal value ${n0(report.N)}, book demand ${n0(report.demand)} a day (the rival fills it at normal value). Window ${W.dumping.windowDays} days; the watch's lines: ${W.dumping.priceThresholdPct}% of normal value, ${W.dumping.volumeThresholdPct}% of normal volume, ${n0(W.dumping.minValue)} minimum.`);
  lines.push("   Flooder net = its credits over the window and the two ticks, less its twin week's (the same units to the standing bid in lots of 100).");
  lines.push("   units/day | price (of N) | rival damage | found | duty      | flooder net vs twin");
  for (const c of report.cells) lines.push(`   ${n0(c.units).padStart(9)} | ${`${n0(c.price)} (${Math.round(c.fraction * 100)}%)`.padStart(12)} | ${`${c.damagePct.toFixed(0)}%`.padStart(12)} | ${(c.found ? "yes" : "no").padEnd(5)} | ${n0(c.duty).padStart(9)} | ${signed(c.net).padStart(12)}${c.damagePct >= 20 && c.net >= 0 ? "  <- profits" : ""}${c.refused.length ? `  refused: ${c.refused.join("; ")}` : ""}`);
  lines.push("");
  for (const t of targets(report)) lines.push(`${t.result.padEnd(8)} ${t.target}: ${t.detail}`);
  return lines.join("\n");
}
