// server/upkeep.js: what a corporation's ships and troops cost to keep (ISP-173, AB#867), docs/design/v0.10-combat.md
// section 7. Settled by the 5-second mining ticker right after payroll, for every account, online or not, for the time
// since it was last settled, the way payroll is (server/payroll.js): a day costs the same in one slice or in thousands.
//
// upkeep a day = the units' base upkeep (data/units.json) x (1 + (S / K)^2), S the corporation's total supply across
// fleets and garrisons, K its logistics capacity: 40 x the Orbital Shipyard's tier (40 without one). Total upkeep grows
// with the cube of fleet size, so a fleet has a best size below the Fleet Cap rather than "as large as allowed" (T-018).
//
// Unpaid upkeep is not a debt. What cannot be paid is not owed later; instead readiness falls, 10 points a day from 100
// to a floor of 40, and climbs back 20 a day once upkeep is paid again. Readiness scales the corporation's attack and
// accuracy in battle (server/game/combat.js combatModifiersFor). Nothing is deleted, disbanded or locked: buildings,
// leases, travel and every other action are untouched.

import { applyCredits } from "./finances.js";
import { countBuilt, playerBuilding } from "./playerBuildings.js";
import { READINESS_FLOOR, READINESS_FULL, UNITS, UNIT_IDS, ensureCorpMilitary } from "./game/units.js";
import { accountsStore, scheduleAccountsSave } from "./game/store.js";
import { pushSystemNotification } from "./game/progression.js";

export const K_PER_SHIPYARD_TIER = 40;
export const READINESS_LOSS_PER_DAY = 10;
export const READINESS_GAIN_PER_DAY = 20;
const DAY_MS = 86_400_000;
const CARRY_TOLERANCE = 1e-6;
const SHIPYARD = playerBuilding("orbital-shipyard");

/** The corporation's total supply: every unit it holds, in fleets and garrisons, weighted by the catalog's supply. */
export function totalSupply(corp) {
  return UNIT_IDS.reduce((sum, id) => sum + (Number(corp?.military?.units?.[id]) || 0) * UNITS[id].supply, 0);
}

/** Its logistics capacity K: 40 per tier of its Orbital Shipyard, and 40 without one. */
export function logisticsCapacity(corp) {
  const yard = (corp?.buildings || []).find((b) => b?.name === SHIPYARD.name);
  const tier = countBuilt(SHIPYARD, corp) > 0 ? Math.max(1, Number(yard?.tier) || 1) : 1;
  return K_PER_SHIPYARD_TIER * tier;
}

/** What the corporation's units cost a day, on the design's curve. */
export function dailyUpkeep(corp) {
  const base = UNIT_IDS.reduce((sum, id) => sum + (Number(corp?.military?.units?.[id]) || 0) * UNITS[id].upkeepPerDay, 0);
  if (base <= 0) return 0;
  const ratio = totalSupply(corp) / logisticsCapacity(corp);
  return base * (1 + ratio * ratio);
}

/**
 * Charge upkeep for the time since it was last settled and move readiness. Returns { paid, unpaid, readiness,
 * becameShort, recovered }: what was taken, what could not be (and is not owed), readiness after, and whether this
 * settlement started a shortfall or brought readiness back to full.
 */
export function settleUpkeep(corp, now = Date.now()) {
  const none = { paid: 0, unpaid: 0, readiness: READINESS_FULL, becameShort: false, recovered: false };
  if (!corp?.finances) return none;
  ensureCorpMilitary(corp);
  const m = corp.military;
  const daily = dailyUpkeep(corp);
  const u = m.upkeep || {};
  const since = Number(u.paidThrough);
  // No units and nothing to recover: nothing runs, and the clock starts at the first tick with units.
  if (daily === 0 && m.readiness >= READINESS_FULL) {
    delete m.upkeep;
    return { ...none, readiness: m.readiness };
  }
  if (!Number.isFinite(since) || since <= 0 || now <= since) {
    m.upkeep = { paidThrough: Math.max(Number.isFinite(since) && since > 0 ? since : 0, now), remainder: Number(u.remainder) || 0, short: Boolean(u.short) };
    return { ...none, readiness: m.readiness };
  }
  const days = (now - since) / DAY_MS;
  const accrued = daily * days + Math.max(0, Number(u.remainder) || 0);
  const due = Math.floor(accrued + CARRY_TOLERANCE);
  const credits = Math.max(0, Math.floor(Number(corp.finances.credits) || 0));
  const paid = Math.min(due, credits);
  if (paid > 0) applyCredits(corp, -paid, "military-upkeep", now);
  const unpaid = due - paid;
  const wasShort = Boolean(u.short);
  // a slice too short to owe a whole credit keeps the state it had; one that owed and could not pay is short
  const short = due === 0 ? wasShort && daily > 0 : unpaid > 0;
  const before = m.readiness;
  m.readiness = short
    ? Math.max(READINESS_FLOOR, before - READINESS_LOSS_PER_DAY * days)
    : Math.min(READINESS_FULL, before + READINESS_GAIN_PER_DAY * days);
  m.upkeep = { paidThrough: now, remainder: Math.max(0, accrued - due), short };
  return { paid, unpaid, readiness: m.readiness, becameShort: short && !wasShort, recovered: before < READINESS_FULL && m.readiness >= READINESS_FULL };
}

/** The notification for a settlement that started a shortfall or restored full readiness, or null. */
export function upkeepNotice(corp, result) {
  if (result?.becameShort) {
    return {
      type: "finance",
      title: "Military upkeep unpaid",
      body: `Your corporation could not cover its fleet's upkeep of ${Math.round(dailyUpkeep(corp)).toLocaleString("en-US")} credits a day. Readiness falls 10 points a day, to a floor of 40, until it is paid again. No ship or troop is lost.`
    };
  }
  if (result?.recovered) return { type: "finance", title: "Fleet at full readiness", body: "Upkeep is paid and your ships and troops are back at full readiness." };
  return null;
}

/**
 * Charge an account's military upkeep up to `now`, right after its payroll (server/ticks.js miningTick), and tell the
 * player when readiness starts falling or is full again. Only the ticker calls it.
 */
export function settleAccountUpkeep(accountId, now = Date.now()) {
  const account = accountsStore.accounts?.[accountId];
  if (!account?.state?.corp) return null;
  const result = settleUpkeep(account.state.corp, now);
  const notice = upkeepNotice(account.state.corp, result);
  if (notice) pushSystemNotification(account, notice);
  if (result.paid > 0 || result.unpaid > 0 || notice) scheduleAccountsSave();
  return result;
}
