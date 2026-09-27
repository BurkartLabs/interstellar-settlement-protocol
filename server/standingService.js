// server/standingService.js: where faction standing is earned, lost and decays (ISP-238, AB#933; docs/design/WARFARE.md,
// "Faction standing"). The rules are server/game/standing.js; this is what the server's own bookings call:
//   - onSale, from both sale paths, inside the seller's own state change: Earth Assembly standing for the GEX sales tax
//     the sale paid, and ITC standing for its value when its price was at or above the item's normal value (the one the
//     ITC's watch reads next, server/game/dumping.js). An item with no normal value earns no ITC standing (it cannot be
//     judged), and a sale to a conglomerate partner earns none either, so a group cannot farm it by trading within itself.
//   - onDumpingFinding, from the ITC's watch when it opens an investigation.
//   - standingTick, once a UTC day: the decay.
// Standing is the corporation's own: served only to it (GET /api/accounts/:id/standing, behind requireAccountAccess),
// and no route writes it. Every failure here earns nothing and is logged; a sale never fails because of standing.

import { WARFARE_CATALOG } from "./warfare.js";
import { getState, mutateAccountState } from "./gameState.js";
import { accountsStore } from "./game/store.js";
import { normalOf, watchDays } from "./game/dumping.js";
import { EARTH_ASSEMBLY, FACTIONS, ITC, addStanding, decayStanding, earnStanding, standingOf } from "./game/standing.js";

const TERMS = WARFARE_CATALOG.standing;
const DUMPING = WARFARE_CATALOG.dumping;
const DAY_MS = 86_400_000;
let decayedDay = null;

/** The normal value the ITC's next watch will judge `item` by, or null. */
function normalPrice(item, now) {
  const n = normalOf(getState().market?.priceHistory?.[item], watchDays(now + DAY_MS, DUMPING).normal, DUMPING);
  return n ? n.price : null;
}

/**
 * A sale settled for `corp`: `salesTax` is the GEX sales tax it paid (booked as "exchange-tax"); the ITC point counts
 * the sale's value when unitPrice is at or above normal value and the buyer is not a partner. Returns what was earned.
 */
export function onSale(corp, { item, quantity, unitPrice, salesTax = 0, partner = false, now = Date.now() }) {
  const earned = { [EARTH_ASSEMBLY]: 0, [ITC]: 0 };
  try {
    earned[EARTH_ASSEMBLY] = earnStanding(corp, EARTH_ASSEMBLY, salesTax, TERMS.eaTaxPerPoint, TERMS);
    const normal = partner ? null : normalPrice(item, now);
    if (normal !== null && unitPrice >= normal) earned[ITC] = earnStanding(corp, ITC, quantity * unitPrice, TERMS.itcTradePerPoint, TERMS);
  } catch (error) {
    console.error(`[standing] a sale earned no standing: ${error?.message || error}`);
  }
  return earned;
}

/** The ITC opened a dumping investigation against `corp`. */
export function onDumpingFinding(corp) {
  try {
    return addStanding(corp, ITC, -TERMS.itcFindingPenalty, TERMS);
  } catch (error) {
    console.error(`[standing] the finding's penalty was not applied: ${error?.message || error}`);
    return standingOf(corp, ITC);
  }
}

/** Once a UTC day: every corporation's standing decays by decayPctPerDay. Each corporation's day is kept, so it never decays twice. */
export function standingTick(now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (decayedDay === day) return 0;
  let n = 0;
  for (const [id, account] of Object.entries(accountsStore.accounts || {})) {
    const corp = account?.state?.corp;
    if (!corp?.standing || corp.standingDecayedDay === day) continue;
    mutateAccountState(id, (state) => { if (decayStanding(state.corp, day, TERMS)) n += 1; });
  }
  decayedDay = day;
  return n;
}

/** The corporation's standing, for itself: each faction's value, the ceiling, the decay and what earns it. */
export function standingView(corp) {
  return {
    standing: Object.fromEntries(FACTIONS.map((f) => [f, standingOf(corp, f)])),
    max: TERMS.max,
    decayPctPerDay: TERMS.decayPctPerDay,
    earning: {
      [EARTH_ASSEMBLY]: `A point for each ${TERMS.eaTaxPerPoint.toLocaleString("en-US")} credits of Exchange sales tax you pay.`,
      [ITC]: `A point for each ${TERMS.itcTradePerPoint.toLocaleString("en-US")} credits of goods you sell at or above their normal value; ${TERMS.itcFindingPenalty} lost to a dumping finding.`
    }
  };
}

/** For tests: forget which day last decayed. */
export function resetStandingTick() {
  decayedDay = null;
}
