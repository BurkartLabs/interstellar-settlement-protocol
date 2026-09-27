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
import { fileRate, levyOf, listingRate, rateAt, rateProblem, settle, tariffOn } from "./game/tariffs.js";

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
const systemRecord = (systemId) => (store.systems[systemId] ||= { rates: {}, accrued: {}, holders: {} });

/** A system's tariff cap (%): its rule's; 0 for a never-concedable system or one without a rule. */
export function tariffCap(systemId) {
  return Number(WARFARE_CATALOG.systemRules[systemId]?.tariffCapPct) || 0;
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
 * of that and today's. Books the amount as "tariff" and accrues it to the holders, less the levy. Returns { pct, amount }.
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
    holders.forEach(({ holder }, i) => {
      const key = keyOf(holder);
      rec.holders[key] = holder;
      rec.accrued[key] = (rec.accrued[key] || 0) + share + (i === 0 ? amount - levy - share * holders.length : 0);
    });
    rec.levy = (rec.levy || 0) + levy;
    applyCredits(corp, -amount, "tariff", now);
    save();
    return { pct, amount };
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
    return days.reduce((s, b) => s + b.close * b.volume, 0) / volume;
  }
  return Number((ECONOMY.npcBuyers || []).find((b) => b.item === item)?.unitPrice) || 0;
}

/** The tariff base of a transfer's lines: units x normal value, in whole credits. */
export function transferBase(lines, now = Date.now()) {
  return Math.floor((lines || []).reduce((s, l) => s + (Number(l.quantity) || 0) * normalValue(l.item, now), 0));
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

/** The levy counted so far: what the ISA kept of every tariff, a sink. */
export const levyTotal = () => (store.levyTotal || 0) + Object.values(store.systems).reduce((s, r) => s + (r.levy || 0), 0);

/** For tests: forget every record (and optionally the file). */
export function resetTariffs({ removeFile = false } = {}) {
  store = { systems: {}, paidDay: null, levyTotal: 0 };
  if (removeFile) fs.rmSync(FILE, { force: true });
}
