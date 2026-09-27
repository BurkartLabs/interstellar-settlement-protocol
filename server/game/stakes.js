// server/game/stakes.js: ownership stakes in a conglomerate's station, and what a departing corporation's stake is worth
// (ISP-211, AB#906; docs/design/CONGLOMERATES.md Part 2, "A stake" and "A leaving member's stake").
//
// - A stake is a corporation's own contributions to the station project (credits, and goods at the NPC reference price
//   on the day they went in), as a share of all corporations' own contributions. Pooled treasury and hangar money is
//   nobody's (server/game/stationProjects.js), so it is not in the sum: the stakes of those who paid always make 100%.
// - Shares are kept as whole basis points by the largest remainder, so they sum to exactly 10,000; a vote weighs the
//   contributed values themselves, which are exact.
// - A corporation that leaves is paid stakeBuyoutLeftPct (50%) of its stake's contributed value by the treasury, one
//   that is removed stakeBuyoutRemovedPct (100%), in stakeBuyoutDays (30) daily instalments while the treasury can pay
//   (what it cannot pay waits for the next settlement). Its stake returns to the pool: the other stakes grow in
//   proportion. The same holds, at the same rates, for its contributions to a project not yet built.
// It sits below membership.js and conglomerateRoles.js in the layer order so that leaving, removal and dissolution
// can call it directly, rather than through a hook that a module not yet loaded would miss.

import { CONGLOMERATE_CATALOG } from "../conglomerates.js";
import { applyCredits } from "../finances.js";
import { createId } from "./catalog.js";
import { accountsStore } from "./store.js";
import { moveTreasury } from "./conglomerates.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const TOTAL_BPS = 10_000;
const corpOf = (publicId) => Object.values(accountsStore.accounts || {}).find((a) => a?.state?.corp?.publicId === publicId)?.state?.corp || null;

/** Each contributing corporation's contributed value, from the project's contribution rows: { <publicId>: value }. */
export function contributedValues(contributions = []) {
  const out = {};
  for (const r of contributions) {
    if (!r?.corp) continue; // pooled: nobody's
    const v = Number(r.value);
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`a contribution by ${r.corp} has no value`);
    out[r.corp] = (out[r.corp] || 0) + v;
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v > 0));
}

/** Stakes from contributed values: { <publicId>: { value, bps } }, bps summing to 10,000 (or {} when nobody paid). */
export function stakesFrom(values) {
  const entries = Object.entries(values).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!entries.length || !(total > 0)) return {};
  const raw = entries.map(([corp, value]) => ({ corp, value, exact: (value * TOTAL_BPS) / total }));
  for (const r of raw) r.bps = Math.floor(r.exact);
  let left = TOTAL_BPS - raw.reduce((s, r) => s + r.bps, 0);
  for (const r of [...raw].sort((a, b) => (b.exact - b.bps) - (a.exact - a.bps) || b.value - a.value || (a.corp < b.corp ? -1 : 1))) {
    if (left <= 0) break;
    r.bps += 1;
    left -= 1;
  }
  return Object.fromEntries(raw.map((r) => [r.corp, { value: r.value, bps: r.bps }]));
}

/** The station's stakes, derived once from its contributions if a station built before stakes were stored has none. */
export function ensureStakes(c) {
  if (!c?.station) return null;
  if (!c.station.stakes || typeof c.station.stakes !== "object") c.station.stakes = stakesFrom(contributedValues(c.station.contributions || []));
  if (!Array.isArray(c.buyouts)) c.buyouts = [];
  return c.station.stakes;
}

/** Whether the stakes are whole: every share a whole number, summing to 10,000 (or none at all). */
export function stakesAreWhole(stakes) {
  const list = Object.values(stakes || {});
  if (!list.length) return true;
  return list.every((s) => Number.isInteger(s.bps) && s.bps >= 0 && Number.isFinite(s.value) && s.value > 0) && list.reduce((a, s) => a + s.bps, 0) === TOTAL_BPS;
}

/**
 * A corporation leaves (`how` "left") or is removed ("removed"): its station stake, and its own contributions to an
 * unbuilt project, become a buyout from the treasury at the design's rate, and return to the pool. Returns the buyout
 * (null when it had nothing in). Call it after the corporation is off the roster, in the same step.
 */
export function departStake(c, corpId, how, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  if (!Array.isArray(c.buyouts)) c.buyouts = [];
  let value = 0;
  if (c.station) {
    const stakes = ensureStakes(c);
    if (stakes[corpId]) {
      value += stakes[corpId].value;
      const rest = Object.fromEntries(Object.entries(stakes).filter(([corp]) => corp !== corpId).map(([corp, s]) => [corp, s.value]));
      c.station.stakes = stakesFrom(rest);
    }
  }
  const p = c.stationProject;
  if (p) {
    for (const r of p.contributions) {
      if (r.corp !== corpId) continue;
      value += Number(r.value) || 0;
      r.formerCorp = r.corp; // the money stays in the project; the corporation is paid out instead
      r.corp = null;
    }
  }
  if (!(value > 0)) return null;
  const pct = how === "removed" ? catalog.stakeBuyoutRemovedPct : catalog.stakeBuyoutLeftPct;
  const total = Math.floor((value * pct) / 100);
  if (total <= 0) return null;
  const buyout = { id: createId("cbo"), corp: corpId, how, value, pct, total, paid: 0, days: catalog.stakeBuyoutDays, startsAt: now, state: "paying" };
  c.buyouts.push(buyout);
  return buyout;
}

/** What is due by `now`: one instalment a day from the day after departure, the last one carrying the remainder. */
export function buyoutDue(b, now) {
  const days = Math.max(0, Math.min(b.days, Math.floor((now - b.startsAt) / DAY_MS)));
  return days >= b.days ? b.total : Math.floor((b.total * days) / b.days);
}

/**
 * Pay every buyout what is due, from the treasury, as far as it can. Returns [{ buyout, amount }] for what was paid.
 * A buyout whose corporation no longer has an account keeps waiting; nothing is paid to nobody. `inFull` pays the whole
 * of what is left rather than what is due (dissolution).
 */
export function settleBuyouts(c, now = Date.now(), { inFull = false } = {}) {
  const paid = [];
  for (const b of c?.buyouts || []) {
    if (b.state !== "paying") continue;
    const owed = (inFull ? b.total : buyoutDue(b, now)) - b.paid;
    const corp = owed > 0 ? corpOf(b.corp) : null;
    const amount = corp ? Math.min(owed, Math.max(0, Math.floor(Number(c.treasury?.credits) || 0))) : 0;
    if (amount > 0) {
      moveTreasury(c, { at: now, kind: "stake-buyout", corp: b.corp, amount: -amount, by: "bureau", note: `${b.pct}% of a ${b.how === "removed" ? "removed" : "departed"} corporation's stake` });
      applyCredits(corp, amount, "conglomerate-stake-buyout", now);
      b.paid += amount;
      paid.push({ buyout: b, amount });
    }
    if (b.paid >= b.total) b.state = "paid";
  }
  return paid;
}

/** At dissolution: pay what every buyout still owes, in full, before anything is shared out. Returns the total paid. */
export function payBuyoutsInFull(c, now = Date.now()) {
  return settleBuyouts(c, now, { inFull: true }).reduce((s, x) => s + x.amount, 0);
}
