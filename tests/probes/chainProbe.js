// ISP-141 (AB#835): the production-chain probe's bot. It plays one week of a resource track under one policy, and does
// everything through the server's routes (start-refinery, the NPC sell route) and its own tick functions, on a clock
// the caller moves. It never writes the corporation's inventory or credits: it reads them, and the routes change them.
// The policies are docs/design/tier3-recipes.md section 6's: "always sell raw", "always refine to the end" and "the
// design's rule" (section 5). BOT NUMBERS (P-PROXY): one corporation alone in the market, no other sellers.

import { REFINERY_CHAINS } from "../../server/game/catalog.js";
import { minBatches } from "../../public/scripts/refineryRun.js";

export const HOUR = 3_600_000;
export const WEEK_HOURS = 168;
/** A lot sold to a standing bid: small enough that the bid moves little within it, whatever the route prices a lot at. */
export const LOT = 350;
export const POLICIES = ["sell raw", "refine to the end", "the design's rule"];

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
 * The week's raw supply, the same for every policy: for each chain, half a week of one Refinery running it
 * (84 hours over its cycle), in raw inputs; CHAIN_PROBE_SUPPLY_HOURS changes the 84, to see what more or less does. Chosen, not derived: with two Refineries and two to four chains a track,
 * the slots are sometimes enough and sometimes not, which is the case section 5 calls "the slot".
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
  const bidNow = (item) => Number(io.bid(item)?.unitPrice || 0);
  // A run is the smallest the game takes: one batch, or for a one-input chain at least 100 units (refineryRun.js).
  const has = (chain) => chain.inputs.every((i) => held(i.item) >= i.quantityPerCycle * minBatches(chain));
  const endsInTime = (chain) => Date.now() + minBatches(chain) * chain.cycleDurationHours * HOUR <= weekEnd;
  /** What a cycle adds at the bids now: its outputs (at this Refinery's multiplier) less its inputs. */
  const gain = (chain) =>
    chain.outputs.reduce((s, o) => s + Math.floor(o.quantityPerCycle * outputMultiplier) * bidNow(o.item), 0) -
    chain.inputs.reduce((s, i) => s + i.quantityPerCycle * bidNow(i.item), 0);
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
    // Section 5: refine a cycle when a Refinery is idle and its outputs at their bids now are worth more than its
    // inputs at their bids now. Of several that pay, the one that pays most an hour of the Refinery.
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
    for (const item of items) {
      const q = held(item);
      if (q <= 0) continue;
      if (final) { out[item] = q; continue; } // the week is over: nothing is kept back for a Refinery that has no time left
      if (policy === "sell raw") { if (shape.raw.includes(item)) out[item] = q; continue; }
      if (shape.finals.includes(item)) { out[item] = q; continue; }
      if (policy === "the design's rule") {
        const keep = reservedByRule()[item] || 0;
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
        const lot = Math.min(LOT, left, Number(order.remainingQty || 0));
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
