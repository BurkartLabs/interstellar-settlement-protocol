// server/tariffService.js: concession-holder tariffs, stored and charged (ISP-230, AB#925; docs/design/WARFARE.md,
// "Tariffs"). The rules are server/game/tariffs.js; who holds a system, and whether its benefits are in force, is the
// concession register (server/concessions.js, ISP-227): only a holder in `granted` has tariff rights, so in `grace`
// (benefits suspended) or after a lapse nothing is charged.
//
// chargeTariff is the one settlement function: every exchange sale (a listing filled, a sale to the NPC standing bid)
// and every transfer into a system calls it, and tests/integration/tariffs.test.js lists those call sites and fails when
// a path that books sale income or a transfer fee does not (P-HALF-FIX). It books what the payer owes as "tariff" and
// accrues it for the holder, less the ISA's levy; tariffTick pays holders once a UTC day. A holder, and for a
// conglomerate holder each member, pays no tariff in its own system: paying yourself would only feed the levy.
//
// A condominium system (61 Cygni, 70 Ophiuchi) has two holders, and the design gives each half the fee share. Each
// files its own rate; the system charges the lower of the two, and the revenue is split between them. So either may
// lower the tariff, and raising it takes both (WARFARE.md does not say; this is the choice, flagged in the PR).
//
// The records live in tariffs.json in the data directory, apart from the concession register: per system, each holder's
// { holder, grantedAt, pct, pending, history } and each holder's accrual. A rate is kept against the grant it was filed
// under, so a holder that lapses and is granted the system again starts at 0% (WARFARE.md: a new concession starts at
// 0%). No account id is stored: holders are corporation publicIds and conglomerate ids.
//
// It fails closed (ISP-230): a tariff that cannot be read is 0 and the error is logged; it is never an unbounded charge.

import fs from "node:fs";
import path from "node:path";
import { dataDir, safeWriteFile } from "./game/catalog.js";
import { stationById } from "./game/stations.js";
import { WARFARE_CATALOG } from "./warfare.js";
import { ECONOMY } from "./economy.js";
import { applyCredits } from "./finances.js";
import { saveAccountsNow } from "./game/store.js";
import { getState, mutateAccountState } from "./gameState.js";
import { accountByCorp, findConglomerate, roleOf } from "./game/membership.js";
import { ensureTreasury, moveTreasury } from "./game/conglomerates.js";
import { publicConcession } from "./concessions.js";
import { parameterInForce, salesTaxBaseAt } from "./lobbyingService.js"; // ISP-239 (AB#934): the rules in force
import { stationTaxAt } from "./game/stationTax.js"; // ISP-212b (AB#4655)
import { fileRate, levyOf, listingRate, rateAt, rateProblem, settle, tariffOn } from "./game/tariffs.js";
import { transferBase as baseAt } from "../public/scripts/tariffs.js"; // ISP-231 (AB#926): the client quotes with it too

const FILE = path.join(dataDir, "tariffs.json");
const DAY_MS = 86_400_000;
const TERMS = WARFARE_CATALOG.tariffs;
const keyOf = (h) => `${h.type}:${h.id}`;
let store = readStore();

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return parsed && typeof parsed === "object" && parsed.systems ? parsed : { systems: {}, paidDay: null, levyTotal: 0 };
  } catch {
    return { systems: {}, paidDay: null, levyTotal: 0 };
  }
}
const save = () => safeWriteFile(FILE, JSON.stringify(store));

/** ISP-264 (AB#960): the store as held, for a player's data export and for erasing an account (server/accountData.js). */
export const dataStore = Object.freeze({
  file: "tariffs.json",
  read: () => store,
  rewrite(fn) { if (!store || typeof store !== "object") return; fn(store); safeWriteFile(FILE, JSON.stringify(store)); } // nothing held yet: nothing to write
});
const systemRecord = (systemId) => (store.systems[systemId] ||= { rates: {}, accrued: {}, holders: {} });

/** A system's tariff cap (%): its rule's; 0 for a never-concedable system or one without a rule. */
export function tariffCap(systemId) {
  // ISP-239 (AB#934): the rule table's cap, or a lobbying campaign's while one holds
  return Number(parameterInForce(systemId, "tariffCapPct")) || 0;
}

/** The system a station is in, or null. */
export function systemOfStation(stationId) {
  return stationById(stationId)?.systemId || null;
}

/** The system's holders whose benefits are in force now (granted, not in grace): [{ holder: { type, id }, grantedAt }]. */
function holdersInForce(systemId, now) {
  return publicConcession(systemId, now).holders.filter((h) => h.benefits).map((h) => ({ holder: { type: h.holder.type, id: h.holder.id }, grantedAt: h.grantedAt }));
}

/** A holder's rate record, if it was filed under the grant in force now; else null (a new grant starts at 0%). */
function rateRecord(systemId, { holder, grantedAt }) {
  const r = store.systems[systemId]?.rates?.[keyOf(holder)];
  return r && r.grantedAt === grantedAt ? r : null;
}

/** The system's rate at `at`: the lowest of its holders' (0 for a holder that has filed none), capped; 0 with no holder. */
function systemRate(systemId, holders, at) {
  if (!holders.length) return 0;
  return Math.min(tariffCap(systemId), ...holders.map((h) => rateAt(rateRecord(systemId, h), at)));
}

/** Whether `corp` is one of the holders, or a member of a holding conglomerate. */
function isHolderSide(corp, holders) {
  return Boolean(corp) && holders.some(({ holder }) => (holder.type === "corp" ? corp.publicId === holder.id : Boolean(corp.conglomerateId) && corp.conglomerateId === holder.id));
}

/**
 * The public view of a system's tariff at `now`: { systemId, cap, pct, pending: { pct, effectiveAt } | null, held }.
 * `pending` is the rate the system will charge when the earliest filed increase takes effect, if that changes it.
 */
export function tariffView(systemId, now = Date.now()) {
  const holders = holdersInForce(systemId, now);
  const pct = systemRate(systemId, holders, now);
  const effectiveAt = holders.map((h) => rateRecord(systemId, h)?.pending?.effectiveAt).filter((t) => t > now).sort((a, b) => a - b)[0];
  const next = effectiveAt ? systemRate(systemId, holders, effectiveAt) : pct;
  return { systemId, cap: tariffCap(systemId), pct, pending: next !== pct ? { pct: next, effectiveAt } : null, held: holders.length > 0 };
}

/** The rate `corp` pays on a sale or transfer settled at `stationId` at `now`: 0 on its own side. Fails closed to 0. */
export function tariffRateFor(corp, stationId, now = Date.now()) {
  try {
    const systemId = systemOfStation(stationId);
    if (!systemId || !(tariffCap(systemId) > 0)) return 0;
    const holders = holdersInForce(systemId, now);
    if (!holders.length || isHolderSide(corp, holders)) return 0;
    return systemRate(systemId, holders, now);
  } catch (error) {
    console.error(`[tariffs] the rate at ${stationId} could not be read, so none is charged: ${error?.message || error}`);
    return 0;
  }
}

/**
 * The one settlement function (ISP-230). Charge `corp` the tariff on `base` credits settled at `stationId`: a sale's
 * gross, or a transfer's goods at normal value. `postedPct` is a listing's rate when it was posted: it pays the lower
 * of that and today's. Books the amount as "tariff" and accrues it to the holders, less the levy. Returns { pct, amount },
 * and for a tariff charged its settlement record too (ISP-241, AB#937: what an arbitration case reads): { base,
 * postedPct, stationId, systemId, at, levy, to: [{ type, id, share }] }, each holder with the share it was accrued.
 * Never throws: a failure charges nothing and is logged.
 */
export function chargeTariff(corp, { stationId, base, postedPct = null, now = Date.now() }) {
  try {
    const pct = listingRate(postedPct, tariffRateFor(corp, stationId, now));
    const amount = tariffOn(Math.floor(Number(base) || 0), pct);
    if (!(amount > 0)) return { pct, amount: 0 };
    const systemId = systemOfStation(stationId);
    const holders = holdersInForce(systemId, now);
    const levy = levyOf(amount, pct, tariffCap(systemId), TERMS);
    const rec = systemRecord(systemId);
    const share = Math.floor((amount - levy) / holders.length);
    const to = [];
    holders.forEach(({ holder }, i) => {
      const key = keyOf(holder);
      const credited = share + (i === 0 ? amount - levy - share * holders.length : 0);
      rec.holders[key] = holder;
      rec.accrued[key] = (rec.accrued[key] || 0) + credited;
      to.push({ type: holder.type, id: holder.id, share: credited });
    });
    rec.levy = (rec.levy || 0) + levy;
    applyCredits(corp, -amount, "tariff", now);
    save();
    return { pct, amount, base: Math.floor(Number(base) || 0), postedPct: Number.isFinite(postedPct) ? postedPct : null, stationId, systemId, at: now, levy, to };
  } catch (error) {
    console.error(`[tariffs] a tariff at ${stationId} was not charged: ${error?.message || error}`);
    return { pct: 0, amount: 0 };
  }
}

/** Which in-force holder the corporation may set a rate for: itself, or its conglomerate as founder or director. */
function holderSetBy(corp, holders) {
  return holders.find(({ holder }) => {
    if (holder.type === "corp") return corp.publicId === holder.id;
    const role = roleOf(findConglomerate(holder.id), corp.publicId);
    return role === "founder" || role === "director";
  }) || null;
}

/**
 * File a new rate for `systemId` on behalf of `corp`, docked in the system (WARFARE.md: set at the system's ISA Claims &
 * Leases). Returns { ok, view } or { status, error }.
 */
export function setTariff(corp, systemId, pct, now = Date.now()) {
  const entry = corp?.publicId ? holderSetBy(corp, holdersInForce(systemId, now)) : null;
  if (!entry) return { status: 403, error: "Only the holder of this system's ISA concession, with its benefits in force, may set its tariff." };
  if ((corp.currentSystemId || "sol") !== systemId) return { status: 409, error: "A tariff is filed at the system's ISA Claims & Leases: travel there first." }; // as a petition is (ISP-227)
  const problem = rateProblem(pct, tariffCap(systemId), TERMS);
  if (problem) return { status: 400, error: problem };
  const rec = systemRecord(systemId);
  const key = keyOf(entry.holder);
  const current = rateRecord(systemId, entry) || { holder: entry.holder, grantedAt: entry.grantedAt, pct: 0, pending: null, history: [] };
  rec.rates[key] = fileRate(current, pct, now, TERMS);
  save();
  return { ok: true, view: tariffView(systemId, now) };
}

/** The price a transfer's goods are tariffed at: the last 7 complete days' volume-weighted closes (at least minTradedDays traded), else the NPC bid's base price, else 0. */
export function normalValue(item, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const since = new Date(now - 7 * DAY_MS).toISOString().slice(0, 10);
  const days = (getState().market?.priceHistory?.[item] || []).filter((b) => b.day < today && b.day >= since && b.volume > 0);
  if (days.length >= WARFARE_CATALOG.dumping.minTradedDays) {
    const volume = days.reduce((s, b) => s + b.volume, 0);
    return days.reduce((s, b) => s + (Number.isFinite(b.value) ? b.value : b.close * b.volume), 0) / volume; // ISP-232 (AB#927): the traded value
  }
  return Number((ECONOMY.npcBuyers || []).find((b) => b.item === item)?.unitPrice) || 0;
}

/** The tariff base of a transfer's lines: units x normal value, in whole credits. */
export function transferBase(lines, now = Date.now()) {
  return baseAt(lines, Object.fromEntries((lines || []).map((l) => [l.item, normalValue(l.item, now)])));
}

/** Pay one holder its accrual; true when paid. A holder that cannot be found keeps its accrual for the next day. */
function payHolder(holder, credits, now) {
  if (holder.type === "corp") {
    const account = accountByCorp(holder.id);
    if (!account?.state?.corp) return false;
    return Boolean(mutateAccountState(account.id, (state) => applyCredits(state.corp, credits, "tariff-revenue", now)));
  }
  const c = findConglomerate(holder.id);
  if (!c) return false;
  ensureTreasury(c, now);
  moveTreasury(c, { at: now, kind: "tariff-revenue", amount: credits, note: "concession tariff" });
  saveAccountsNow();
  return true;
}

/**
 * Once a UTC day: pay each holder what its tariffs accrued (a former holder too: it earned them), and count the levy, a
 * sink (taken from the payers, never paid out). Idempotent per day. Returns what moved.
 */
export function tariffTick(now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (store.paidDay === day) return [];
  const paid = [];
  for (const [systemId, rec] of Object.entries(store.systems)) {
    for (const [key, owed] of Object.entries(rec.accrued || {})) {
      const credits = Math.floor(owed);
      if (credits > 0 && payHolder(rec.holders[key], credits, now)) {
        delete rec.accrued[key];
        rec.paid = { ...(rec.paid || {}), [key]: (rec.paid?.[key] || 0) + credits }; // ISP-231 (AB#926): collected to date
        paid.push({ systemId, holder: rec.holders[key], credits });
      }
    }
    store.levyTotal = (store.levyTotal || 0) + (rec.levy || 0);
    rec.levy = 0;
    for (const [key, r] of Object.entries(rec.rates || {})) rec.rates[key] = settle(r, now);
  }
  store.paidDay = day;
  save();
  return paid;
}

/**
 * ISP-231 (AB#926): what the corporation sees before it commits, and what it holds. `here`: the rate it pays where it is
 * docked (0 on the holder's side) and a pending change it would pay; `systems`: every held system's public tariff (the
 * starmap's panel); `holdings`: each system whose tariff it may set, with its own filed rate, the system's, and what it
 * has collected and is owed; `normalValues`: what goods it holds outside this system are tariffed at when shipped here.
 */
export function tariffSummary(corp, now = Date.now()) {
  const stationId = corp?.currentStationId || null;
  const systemIdHere = systemOfStation(stationId);
  const systems = {};
  const holdings = [];
  for (const systemId of Object.keys(WARFARE_CATALOG.systemRules)) {
    if (!(tariffCap(systemId) > 0)) continue;
    const holders = holdersInForce(systemId, now);
    if (!holders.length) continue;
    systems[systemId] = tariffView(systemId, now);
    const mine = corp?.publicId ? holderSetBy(corp, holders) : null;
    if (!mine) continue;
    const key = keyOf(mine.holder);
    const r = rateRecord(systemId, mine);
    const rec = store.systems[systemId];
    holdings.push({
      systemId, cap: tariffCap(systemId), holder: mine.holder.type, docked: (corp.currentSystemId || "sol") === systemId,
      pct: rateAt(r, now), pending: r?.pending && now < r.pending.effectiveAt ? { pct: r.pending.pct, effectiveAt: r.pending.effectiveAt } : null,
      systemPct: systems[systemId].pct, systemPending: systems[systemId].pending, holders: holders.length,
      accrued: Math.floor(rec?.accrued?.[key] || 0), paidTotal: rec?.paid?.[key] || 0
    });
  }
  let here = null;
  if (systemIdHere) {
    const pct = tariffRateFor(corp, stationId, now);
    const exempt = isHolderSide(corp, holdersInForce(systemIdHere, now));
    here = { stationId, systemId: systemIdHere, cap: tariffCap(systemIdHere), pct, exempt, pending: exempt ? null : systems[systemIdHere]?.pending || null, salesTaxPct: salesTaxBaseAt(stationId, now), stationTax: stationTaxAt(corp, stationId) }; // ISP-239 (AB#934); ISP-212b (AB#4655): the Exchange quotes what the sale will pay
  }
  const normalValues = {};
  for (const [sid, inv] of Object.entries(corp?.inventory || {})) {
    if (systemOfStation(sid) === systemIdHere) continue;
    for (const [item, qty] of Object.entries(inv || {})) if (Number(qty) > 0 && !(item in normalValues)) normalValues[item] = normalValue(item, now);
  }
  return { here, systems, holdings, normalValues };
}

/** ISP-241 (AB#937): a system's filed rates (copies): each holder's { holder, grantedAt, pct, pending, history }. */
export const tariffRates = (systemId) => JSON.parse(JSON.stringify(Object.values(store.systems[systemId]?.rates || {})));

/**
 * ISP-242 (AB#938; WARFARE.md, Enforcement): take up to `amount` of what the ISA holds for `holder` ({ type, id }) in
 * tariff revenue not yet paid, across its systems, for an arbitration award. Returns what was taken.
 */
export function takeTariffAccrual(holder, amount) {
  let left = Math.max(0, Math.floor(amount));
  const key = `${holder.type}:${holder.id}`;
  for (const rec of Object.values(store.systems)) {
    if (!(left > 0)) break;
    const has = Math.floor(rec.accrued?.[key] || 0);
    const x = Math.min(has, left);
    if (x > 0) { rec.accrued[key] = has - x; left -= x; }
  }
  const taken = Math.max(0, Math.floor(amount)) - left;
  if (taken) save();
  return taken;
}
/** ISP-242 (AB#938): an upheld tariff-overcharge case repays the ISA's levy share out of the levy counted. Returns what was taken. */
export function refundLevy(amount) {
  const x = Math.min(Math.max(0, Math.floor(amount)), Math.floor(levyTotal()));
  if (!(x > 0)) return 0;
  store.levyTotal = (store.levyTotal || 0) - x; // may go below the counted total's settled part only by what this day's levies hold
  save();
  return x;
}

/** The levy counted so far: what the ISA kept of every tariff, a sink. */
export const levyTotal = () => (store.levyTotal || 0) + Object.values(store.systems).reduce((s, r) => s + (r.levy || 0), 0);

/** For tests: forget every record (and optionally the file). */
export function resetTariffs({ removeFile = false } = {}) {
  store = { systems: {}, paidDay: null, levyTotal: 0 };
  if (removeFile) fs.rmSync(FILE, { force: true });
}
