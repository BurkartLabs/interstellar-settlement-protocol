// ISP-141 (AB#835): the production-chain probe's bot. It plays one week of a resource track under one policy, and does
// everything through the server's routes (start-refinery, the NPC sell route) and its own tick functions, on a clock
// the caller moves. It never writes the corporation's inventory or credits: it reads them, and the routes change them.
// The policies are docs/design/tier3-recipes.md section 6's: "always sell raw", "always refine to the end" and "the
// design's rule" (section 5). BOT NUMBERS (P-PROXY): one corporation alone in the market, no other sellers.
//
// AB#2367 (the Director's ruling on AB#2366): the swept dimension is how much a corporation mines and how many
// Refineries it runs, because the only glut one corporation meets is the one it causes itself; a starting price state
// is gone by the next morning. The design's rule looks a night ahead (section 5).

import { REFINERY_CHAINS } from "../../server/game/catalog.js";
import { minBatches } from "../../public/scripts/refineryRun.js";
import { ECONOMY, npcBidAfterRecovery } from "../../server/economy.js";

export const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const WEEK_HOURS = 168;
export const POLICIES = ["sell raw", "refine to the end", "the design's rule"];

/**
 * Section 6's sweep (AB#2367): the week's raw supply, as hours of one Refinery running each of the track's chains
 * (CHAIN_PROBE_VOLUMES overrides the list), and how many Refineries the corporation runs.
 */
export const VOLUMES = (process.env.CHAIN_PROBE_VOLUMES || "42,84,168,336").split(",").map(Number).filter((n) => n > 0);
export const REFINERY_COUNTS = [1, 2];

/**
 * A lot sold to a standing bid: a twentieth of the order's daily quota, at most 350, so the bid moves little within
 * one lot. The sell route pays a whole lot the bid before it (AB#2356), and a product's quota can be 8 a day
 * (AB#2365), so a fixed 350 would sell a product's whole day at its opening bid and never meet the fall.
 */
export const lotFor = (order) => Math.max(1, Math.min(350, Math.floor(Number(order?.totalQtyPerDay || 0) / 20)));

/** A track's chains, and which of their items are raw (bought from nobody in the track) and which the track makes. */
export function trackShape(chainIds) {
  const chains = chainIds.map((id) => {
    const chain = REFINERY_CHAINS[id];
    if (!chain) throw new Error(`no chain ${id} in data/refinery-chains.json`);
    return chain;
  });
  const made = new Set(chains.flatMap((c) => c.outputs.map((o) => o.item)));
  const used = new Set(chains.flatMap((c) => c.inputs.map((i) => i.item)));
  const raw = [...used].filter((item) => !made.has(item));
  const finals = [...made].filter((item) => !used.has(item));
  return { chains, raw, made: [...made], finals };
}

/**
 * The week's raw supply, the same for every policy: for each chain, `refineryHours` of one Refinery running it, in raw
 * inputs. Chosen, not derived; the sweep is over this number (VOLUMES), and CHAIN_PROBE_SUPPLY_HOURS sets its default.
 */
export function weekSupply(shape, refineryHours = Number(process.env.CHAIN_PROBE_SUPPLY_HOURS || 84)) {
  const supply = {};
  for (const chain of shape.chains) {
    const cycles = Math.floor(refineryHours / chain.cycleDurationHours);
    for (const input of chain.inputs) {
      if (shape.raw.includes(input.item)) supply[input.item] = (supply[input.item] || 0) + cycles * input.quantityPerCycle;
    }
  }
  return supply;
}

/**
 * Play one week. `io` is how the bot touches the game:
 *   corp()            the corporation as the server holds it (read only)
 *   bid(item)         the standing order for an item (read only)
 *   startRefinery(b)  POST start-refinery
 *   sell(orderId, q)  POST the NPC sell route
 *   tick()            the server's day reset and refinery tick, at the clock's now
 *   advance(ms)       move the clock
 * Returns the credits at the end and what was left unsold.
 */
export async function playWeek({ shape, policy, station, outputMultiplier, io }) {
  if (!POLICIES.includes(policy)) throw new Error(`unknown policy ${policy}`);
  const start = Date.now();
  const weekEnd = start + WEEK_HOURS * HOUR;
  const held = (item) => Math.floor(Number(io.corp().inventory?.[station]?.[item] || 0));
  // A run is the smallest the game takes: one batch, or for a one-input chain at least 100 units (refineryRun.js).
  const has = (chain) => chain.inputs.every((i) => held(i.item) >= i.quantityPerCycle * minBatches(chain));
  const endsInTime = (chain) => Date.now() + minBatches(chain) * chain.cycleDurationHours * HOUR <= weekEnd;

  // The design's rule, section 5 with AB#2367's look-ahead. Stock is worth what selling it from tomorrow would fetch:
  // each day opens at the bid after a night's recovery (not the bid this minute, which the corporation may have pushed
  // down today), the day's sales walk down the bid's curve within the item's own quota (AB#2365), and what the week's
  // remaining days cannot sell is worth nothing. The curve is npcBidFor's, as a straight line to the floor.
  const { driftAtFullQuotaPct, floorPct } = ECONOMY.npcBid;
  /** Credits from selling `units` of an item from tomorrow, a day's quota at a time, for the days the week has left. */
  const saleValue = (item, units) => {
    const order = io.bid(item);
    if (!order || units <= 0) return 0;
    const base = Number(order.basePrice);
    const quota = Math.max(1, Number(order.totalQtyPerDay) || 1);
    const floor = base * floorPct / 100;
    const slope = (base * driftAtFullQuotaPct / 100) / quota; // credits the bid falls per unit sold
    let open = npcBidAfterRecovery(base, Number(order.unitPrice));
    let left = units;
    let value = 0;
    for (let day = Math.max(1, Math.floor((weekEnd - Date.now()) / DAY)); day > 0 && left > 0; day -= 1) {
      const n = Math.min(left, quota);
      const toFloor = Math.max(0, (open - floor) / slope); // units sold before the bid reaches its floor
      const onSlope = Math.min(n, toFloor);
      value += onSlope * open - (slope * onSlope * onSlope) / 2 + (n - onSlope) * floor;
      open = npcBidAfterRecovery(base, Math.max(floor, open - slope * n));
      left -= n;
    }
    return value;
  };
  /** Stock already on its way to being sold: held, and what the running cycles will deliver. */
  const committed = (item) => held(item) + (io.corp().refineries || [])
    .filter((r) => r.active).flatMap((r) => r.outputs || []).filter((o) => o.item === item).reduce((s, o) => s + Number(o.quantity || 0), 0);
  /** What `q` more (or, negative, fewer) of an item adds to what the corporation's stock of it will sell for. */
  const worth = (item, q) => {
    const now = committed(item);
    return saleValue(item, Math.max(0, now + q)) - saleValue(item, now);
  };
  /** What a cycle adds: its outputs (at this Refinery's multiplier) less the inputs it uses up, both valued as above. */
  const gain = (chain) =>
    chain.outputs.reduce((s, o) => s + worth(o.item, Math.floor(o.quantityPerCycle * outputMultiplier)), 0) +
    chain.inputs.reduce((s, i) => s + worth(i.item, -i.quantityPerCycle), 0);
  const refusals = [];

  /** The chain an idle Refinery starts now, or none. */
  function choose() {
    const runnable = shape.chains.filter((c) => has(c) && endsInTime(c));
    if (policy === "sell raw" || !runnable.length) return null;
    if (policy === "refine to the end") {
      // The furthest stage first, so what was made goes on to the end; then the chain with the most stock waiting.
      const cycles = (c) => Math.min(...c.inputs.map((i) => held(i.item) / i.quantityPerCycle));
      return [...runnable].sort((a, b) => b.stage - a.stage || cycles(b) - cycles(a))[0];
    }
    // Section 5: refine a cycle when a Refinery is idle and its outputs are worth more than its inputs. Of several that
    // pay, the one that pays most an hour of the Refinery.
    const paying = runnable.filter((c) => gain(c) > 0);
    return paying.sort((a, b) => gain(b) / b.cycleDurationHours - gain(a) / a.cycleDurationHours)[0] || null;
  }

  /** How much of each item the design's rule means to refine before the week ends; the rest it sells now. */
  function reservedByRule() {
    const refineries = io.corp().refineries || [];
    let hoursLeft = refineries.reduce((s, r) => s + Math.max(0, (weekEnd - Math.max(Date.now(), Number(r.active ? r.endsAt : 0))) / HOUR), 0);
    const stock = Object.fromEntries(shape.raw.concat(shape.made).map((item) => [item, held(item)]));
    const reserved = {};
    const paying = shape.chains.filter((c) => gain(c) > 0).sort((a, b) => gain(b) / b.cycleDurationHours - gain(a) / a.cycleDurationHours);
    for (const chain of paying) {
      const cycles = Math.floor(Math.min(hoursLeft / chain.cycleDurationHours, ...chain.inputs.map((i) => (stock[i.item] || 0) / i.quantityPerCycle)));
      if (cycles <= 0) continue;
      for (const i of chain.inputs) {
        stock[i.item] -= cycles * i.quantityPerCycle;
        reserved[i.item] = (reserved[i.item] || 0) + cycles * i.quantityPerCycle;
      }
      hoursLeft -= cycles * chain.cycleDurationHours;
    }
    return reserved;
  }

  /** What the policy sells at this moment, item by item. */
  function toSell(final) {
    const items = [...new Set([...shape.raw, ...shape.made])];
    const out = {};
    const reserved = policy === "the design's rule" && !final ? reservedByRule() : {};
    for (const item of items) {
      const q = held(item);
      if (q <= 0) continue;
      if (final) { out[item] = q; continue; } // the week is over: nothing is kept back for a Refinery that has no time left
      if (policy === "sell raw") { if (shape.raw.includes(item)) out[item] = q; continue; }
      if (shape.finals.includes(item)) { out[item] = q; continue; }
      if (policy === "the design's rule") {
        const keep = reserved[item] || 0;
        if (q > keep) out[item] = q - keep;
      }
    }
    return out;
  }

  async function sellNow(final) {
    for (const [item, quantity] of Object.entries(toSell(final))) {
      let left = quantity;
      while (left > 0) {
        const order = io.bid(item);
        if (!order) throw new Error(`no standing bid for ${item}`);
        const lot = Math.min(lotFor(order), left, Number(order.remainingQty || 0));
        if (lot <= 0) break; // today's quota is spent; tomorrow it refills
        const res = await io.sell(order.id, lot);
        if (res.status !== 200) { refusals.push(`sell ${lot} ${item}: ${res.body?.error || res.status}`); break; }
        left -= lot;
      }
    }
  }

  for (let hour = 0; hour < WEEK_HOURS; hour += 1) {
    io.tick();
    // Refineries first, so a cycle that just delivered is not sold out from under the next stage.
    for (const refinery of io.corp().refineries || []) {
      if (refinery.active) continue;
      const chain = choose();
      if (!chain) break;
      const res = await io.startRefinery({ refineryId: refinery.id, chainId: chain.id, batches: minBatches(chain) });
      if (res.status !== 200) { refusals.push(`${chain.id}: ${res.body?.error || res.status}`); break; }
    }
    // Once a day, an hour after the midnight (EST) reset, each policy sells what it sells.
    if (hour % 24 === 1) await sellNow(false);
    io.advance(HOUR);
  }
  io.tick(); // the last hour's cycles deliver
  await sellNow(true);

  const unsold = Object.fromEntries([...shape.raw, ...shape.made].map((item) => [item, held(item)]).filter(([, q]) => q > 0));
  return { credits: Number(io.corp().finances?.credits || 0), unsold, refusals };
}
