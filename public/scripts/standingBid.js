// The standing bid a day's ore is sold into, and the yard rate that pays best along it: one copy, for the server
// (server/economy.js re-exports the bid rule), the economy model (scripts/economy-model.mjs) and the extractor panel.
//
// AB#2334: the model priced every tonne at the flat base bid, though ISP-87 makes the bid fall as the day's quota fills
// and recover most of the way overnight. A day's output is sold unit by unit along the bid, from the opening a
// corporation settles into by selling the same amount every day. AB#2480: the panel's throughput control opens at the
// best rate this calculation finds, for the yard's tier, the corporation's research and the economy's prices, and its
// projection quotes the same numbers, so what the player is offered and what the model says cannot differ.
//
// Pure: no economy is read here. Every caller passes the bid's rules (data/economy.json's npcBid) and the prices.
import { costPerHourFor } from "./miningProjection.js";

/** The bid for an item after `soldToday` units have gone into today's quota. Never below the floor. */
export function npcBidFor(basePrice, soldToday, bid) {
  const base = Math.max(0, Number(basePrice) || 0);
  const quota = Math.max(1, Number(bid?.quotaPerDay) || 1);
  const drift = Math.max(0, Number(bid?.driftAtFullQuotaPct) || 0) / 100;
  const floor = base * (Math.max(0, Number(bid?.floorPct) || 0) / 100);
  const filled = Math.min(1, Math.max(0, Number(soldToday) || 0) / quota);
  return Math.max(Math.round(floor), Math.round(base * (1 - drift * filled)));
}

/**
 * Where a bid sits after a night: most of the way back to the base price. The recovery is of the gap, so a bid
 * that fell hard comes back hard, and one that barely moved barely moves.
 */
export function npcBidAfterRecovery(basePrice, currentBid, bid) {
  const base = Math.max(0, Number(basePrice) || 0);
  const now = Math.max(0, Number(currentBid) || 0);
  const recovery = Math.min(1, Math.max(0, Number(bid?.recoveryPerDayPct) || 0) / 100);
  return Math.round(now + (base - now) * recovery);
}

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

/**
 * An hour at `throughputPerHour`, as a day of it sells along the bid: revenue after tax, the running cost (the tier's
 * curve and any upkeep) and the difference. `efficiency` is what research and the lease multiply the tonnes by.
 */
export function hourAlongBid(throughputPerHour, { operations, basePrice, taxPct, npcBid, efficiency = 1, upkeepPerHour = 0 }) {
  const rate = Math.max(0, Number(throughputPerHour) || 0);
  const day = steadyBidDay(rate * 24 * (Number(efficiency) || 0), Number(basePrice) || 0, npcBid);
  const revenuePerHour = (day.gross * (1 - (Number(taxPct) || 0) / 100)) / 24;
  const costPerHour = costPerHourFor(rate, operations) + (Number(upkeepPerHour) || 0);
  return { throughputPerHour: rate, revenuePerHour, costPerHour, profitPerHour: revenuePerHour - costPerHour, avgBid: day.sold ? day.gross / day.sold : 0 };
}

/**
 * The rate that pays best along the bid, walked across the range the yard allows: { throughputPerHour, profitPerHour,
 * revenuePerHour, costPerHour, avgBid }, the profit rounded to the credit as the model reports it. The first of equals
 * wins, so a flat stretch resolves to the lower, cheaper rate.
 */
export function bestRateAlongBid({ operations, basePrice, taxPct, npcBid, efficiency = 1, upkeepPerHour = 0, min = 10, max = 250 }) {
  // A walk is about 25ms; the panel asks on every redraw and keystroke with the same inputs, so it is kept.
  const key = JSON.stringify([operations, basePrice, taxPct, npcBid, efficiency, upkeepPerHour, min, max]);
  if (BEST.has(key)) return BEST.get(key);
  let best = null;
  for (let t = min; t <= max; t += 1) {
    const hour = hourAlongBid(t, { operations, basePrice, taxPct, npcBid, efficiency, upkeepPerHour });
    const profitPerHour = Math.round(hour.profitPerHour);
    if (!best || profitPerHour > best.profitPerHour) best = { ...hour, profitPerHour };
  }
  if (BEST.size >= 64) BEST.delete(BEST.keys().next().value);
  BEST.set(key, best);
  return best;
}
const BEST = new Map();
