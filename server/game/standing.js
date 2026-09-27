// server/game/standing.js: a corporation's standing with the Earth Assembly and the Interplanetary Trade Commission
// (ISP-238, AB#933; docs/design/WARFARE.md, "Faction standing"). Pure: it changes the corporation it is given and reads
// no file and no clock, so tests read it with fixtures.
//
// Standing is 0 to terms.max per faction, kept to two decimals, on corp.standing. It is earned only in play: Earth
// Assembly standing by Exchange sales tax paid (a point per eaTaxPerPoint credits), ITC standing by goods sold at or
// above their normal value (a point per itcTradePerPoint credits). A dumping finding costs itcFindingPenalty ITC standing.
// It decays by decayPctPerDay of the value each UTC day. Lobbying (ISP-239) will spend it. Credits too few to make a
// hundredth of a point are carried (corp.standingCarry), so many small sales earn what one large sale would.
//
// Every function that writes corp.standing is in STANDING_WRITERS, and tests/integration/standing.test.js fails when a
// server file writes it anywhere else (T-019: a stat nothing writes can never be met; one written from a request could
// be forged). Nothing a client sends reaches these functions.

export const EARTH_ASSEMBLY = "earth-assembly";
export const ITC = "interplanetary-trade-commission";
export const FACTIONS = Object.freeze([EARTH_ASSEMBLY, ITC]);
/** Every function that writes corp.standing. */
export const STANDING_WRITERS = Object.freeze(["addStanding", "earnStanding", "decayStanding"]);

const round2 = (v) => Math.round(v * 100) / 100;

/** The corporation's standing with `faction`, 0 when it has none. */
export function standingOf(corp, faction) {
  return Number(corp?.standing?.[faction]) || 0;
}

/** Add `points` (negative to take) to the corporation's standing with `faction`, within 0 and terms.max. Returns the new value. */
export function addStanding(corp, faction, points, terms) {
  if (!corp || !FACTIONS.includes(faction) || !Number.isFinite(points)) return standingOf(corp, faction);
  const next = round2(Math.min(terms.max, Math.max(0, standingOf(corp, faction) + points)));
  corp.standing = { ...(corp.standing || {}), [faction]: next };
  return next;
}

/**
 * Earn standing with `faction` for `credits` of the activity it rewards, at `perPoint` credits a point, carrying what is
 * too little for a hundredth of a point. Returns the points added.
 */
export function earnStanding(corp, faction, credits, perPoint, terms) {
  if (!corp || !FACTIONS.includes(faction) || !(credits > 0) || !(perPoint > 0)) return 0;
  const carry = (Number(corp.standingCarry?.[faction]) || 0) + credits;
  const hundredths = Math.floor((carry * 100) / perPoint);
  corp.standingCarry = { ...(corp.standingCarry || {}), [faction]: carry - (hundredths * perPoint) / 100 };
  if (!hundredths) return 0;
  const before = standingOf(corp, faction);
  const next = round2(Math.min(terms.max, before + hundredths / 100));
  corp.standing = { ...(corp.standing || {}), [faction]: next };
  return round2(next - before);
}

/** One UTC day's decay on `day` (YYYY-MM-DD): decayPctPerDay of each value, once per day. Returns whether it applied. */
export function decayStanding(corp, day, terms) {
  if (!corp?.standing || corp.standingDecayedDay === day) return false;
  const keep = 1 - terms.decayPctPerDay / 100;
  corp.standing = Object.fromEntries(FACTIONS.map((f) => [f, round2(standingOf(corp, f) * keep)]));
  corp.standingDecayedDay = day;
  return true;
}
