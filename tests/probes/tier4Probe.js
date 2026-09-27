// ISP-193 (AB#887): the Tier 4 profile of the ISP probe, the same shape as the combat and markets ones. Three parts,
// each against what docs/design/v0.11-tier4.md claims:
//   1. reachability (T-019): every Tier 4 product's tree resolves to raw items that some body or belt yields, research
//      that exists, the building that runs it, and a standing bid to sell it into. An unreachable product fails.
//   2. time to the first unit: a planner bot starting from a v0.10-level corporation researches what the product
//      needs, mines its gated raws, refines its intermediates and synthesizes it, and the probe prints bot-days;
//   3. allocation (T-018, the design's section 4): for each intermediate two or more recipes compete for, and for the
//      Synthesis Array's day, a planner splits its stock to earn the most, over many seeded market states, and the
//      probe prints the share each recipe takes and how often it splits at all (target: in at least 60% of runs).
//
// BOT NUMBERS (P-PROXY, DOCTRINE P-005). A bot is not a player. These numbers say whether the data and the bid rule hold
// the design's claims under its own arithmetic; they are not a fact about how long anybody takes or what anybody makes.
//
// WHAT IS REAL AND WHAT IS ASSUMED:
//   - Real: the chains (data/refinery-chains.json: inputs, outputs, cycle hours, research, building), the research tree
//     and its durations, the body and belt profiles, the Synthesis Array's gates, the recovery gates (researchGates.js),
//     the standing bids, and the bid rule a sale walks down (npcBidFor over bidQuotaFor).
//   - Assumed: the start profile (every node but the six Tier 4 ones, two Refineries, every ungated raw in stock), one
//     tier-3 extractor yard per gated raw at its best rate on that raw's richest source (YARD_RATE), research in one
//     queue (Bug #1258), the Array built the moment its research is done, and no travel. Other inputs of a contested
//     recipe are bought at their base bid. This is a planner over the data, not a playthrough of the routes: the
//     routes are covered by tests/integration/synthesis-array.test.js and tier4Research/Bodies/Exchange.

import { REFINERY_CHAINS, RESEARCH_LIBRARY, SYSTEMS_DATA } from "../../server/game/catalog.js";
import { ITEMS } from "../../server/game/items.js";
import { ITEM_RESEARCH_GATES } from "../../server/game/researchGates.js";
import { playerBuilding } from "../../server/playerBuildings.js";
import { ECONOMY, npcBidFor } from "../../server/economy.js";
import { bidQuotaFor } from "../../server/game/world.js";

const CHAINS = Object.values(REFINERY_CHAINS);
export const TIER4_PRODUCTS = ITEMS.filter((i) => i.tier === 4 && i.category === "refined").map((i) => i.name);
export const TIER4_NODES = ["tt-actinide-handling", "tt-deep-core-extraction", "tt-deep-atmosphere-extraction", "tt-high-energy-synthesis", "tt-exotic-containment", "tt-antimatter-confinement"];
/** A tier-3 yard's best rate, docs/design/upgrades.md's "best T" column (as tests/probes/ladderBot.js has it). Chosen. */
export const YARD_RATE = 232;
export const REFINERIES = 2;
const BASE = Object.fromEntries(ECONOMY.npcBuyers.map((b) => [b.item, b.unitPrice]));
const producerOf = (item) => CHAINS.find((c) => c.outputs.some((o) => o.item === item)) || null;
const facilityOf = (chain) => chain.building || "refinery";

/** Each item's richest extraction share anywhere, as a concentration (0 to 1); 0 for an item nothing yields. */
export function richestShare(item) {
  let best = 0;
  for (const s of SYSTEMS_DATA) for (const b of s.bodies || []) {
    for (const p of b.resourceProfile || []) if (p.item === item) best = Math.max(best, p.concentration);
    if (b.composition?.[item]) best = Math.max(best, b.composition[item] / 100);
  }
  return best;
}

/** Every research id `ids` needs, prerequisites first, each once. */
function withPrereqs(ids, out = []) {
  for (const id of ids) {
    const node = RESEARCH_LIBRARY[id];
    if (!node || out.includes(id)) continue;
    withPrereqs(node.prereqs || [], out);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * One unit's tree: for each chain, the batches one batch of the product needs, and the raw items it draws.
 * Returns { jobs: [{ chain, batches, needs: [item] }], raws: { item: quantity }, research: [id] }.
 */
export function productTree(product) {
  const jobs = new Map();
  const raws = {};
  const research = new Set();
  const want = (item, quantity) => {
    const chain = producerOf(item);
    if (!chain) { raws[item] = (raws[item] || 0) + quantity; return; }
    const out = chain.outputs.find((o) => o.item === item).quantityPerCycle;
    const job = jobs.get(chain.id) || { chain, batches: 0, made: 0 };
    const more = Math.max(0, Math.ceil((quantity - (job.made - job.batches * 0)) / out)); // batches for this demand
    job.batches += more;
    job.made += more * out;
    jobs.set(chain.id, job);
    for (const r of chain.requiresTechIds || []) research.add(r);
    for (const input of chain.inputs) want(input.item, input.quantityPerCycle * more);
  };
  want(product, 1);
  for (const item of Object.keys(raws)) if (ITEM_RESEARCH_GATES[item]) research.add(ITEM_RESEARCH_GATES[item]);
  if ([...jobs.values()].some((j) => facilityOf(j.chain) === "synthesis-array")) for (const g of playerBuilding("synthesis-array")?.researchGates || []) research.add(g);
  return { jobs: [...jobs.values()].map((j) => ({ chain: j.chain, batches: j.batches, needs: j.chain.inputs.map((i) => i.item) })), raws, research: withPrereqs([...research]) };
}

// ─── 1. Reachability ───────────────────────────────────────────────────────────

/** Why each Tier 4 product cannot be reached, as { product, why: [text] }; empty when all can. */
export function reachability(products = TIER4_PRODUCTS) {
  const out = [];
  for (const product of products) {
    const why = [];
    if (!producerOf(product)) why.push("no chain makes it");
    else {
      const { raws, research, jobs } = productTree(product);
      for (const item of Object.keys(raws)) if (!(richestShare(item) > 0)) why.push(`${item}: no body or belt yields it`);
      for (const id of research) if (!RESEARCH_LIBRARY[id]) why.push(`research ${id} does not exist`);
      for (const { chain } of jobs) {
        if (facilityOf(chain) !== "refinery" && !playerBuilding(facilityOf(chain))) why.push(`${chain.id}: no building ${facilityOf(chain)}`);
        for (const id of chain.requiresTechIds || []) if (!RESEARCH_LIBRARY[id]) why.push(`${chain.id}: research ${id} does not exist`);
      }
    }
    if (!(BASE[product] > 0)) why.push("no standing bid buys it");
    if (why.length) out.push({ product, why });
  }
  return out;
}

// ─── 2. Time to the first unit ─────────────────────────────────────────────────

/**
 * The planner bot's schedule for one unit of `product` from the start profile. Research runs in one queue, extraction
 * nodes first (so the yards run during the rest); each gated raw is mined from its node's end at YARD_RATE times its
 * richest share; chains run in the Refineries or the one Array as soon as their inputs are made, earliest facility
 * first. Returns hours for each part and in all.
 */
export function timeToFirst(product) {
  const { jobs, raws, research } = productTree(product);
  const held = new Set(Object.keys(RESEARCH_LIBRARY).filter((id) => !TIER4_NODES.includes(id)));
  const toDo = research.filter((id) => !held.has(id));
  const extraction = new Set(Object.values(ITEM_RESEARCH_GATES));
  const ordered = [...toDo.filter((id) => extraction.has(id)), ...toDo.filter((id) => !extraction.has(id))];
  const doneAt = {};
  let clock = 0;
  for (const id of withPrereqs(ordered).filter((id) => !held.has(id))) { clock += RESEARCH_LIBRARY[id].durationHours; doneAt[id] = clock; }
  const researchHours = clock;
  const ready = {}; // item -> hour it is in hand in the quantity the tree needs
  let miningHours = 0;
  for (const [item, quantity] of Object.entries(raws)) {
    const gate = ITEM_RESEARCH_GATES[item];
    if (!gate) { ready[item] = 0; continue; }
    const hours = quantity / (YARD_RATE * richestShare(item));
    ready[item] = (doneAt[gate] ?? 0) + hours;
    miningHours = Math.max(miningHours, hours);
  }
  const free = { refinery: Array(REFINERIES).fill(0), "synthesis-array": [0] };
  const pending = [...jobs];
  const facilityHours = { refinery: 0, "synthesis-array": 0 };
  while (pending.length) {
    const i = pending.findIndex((j) => j.needs.every((item) => ready[item] !== undefined));
    if (i < 0) throw new Error(`${product}: a chain waits on an input nothing makes`);
    const [job] = pending.splice(i, 1);
    const kind = facilityOf(job.chain);
    const gatesDone = Math.max(0, ...(job.chain.requiresTechIds || []).map((id) => doneAt[id] ?? 0),
      ...(kind === "synthesis-array" ? (playerBuilding("synthesis-array")?.researchGates || []).map((id) => doneAt[id] ?? 0) : []));
    const inputsIn = Math.max(0, ...job.needs.map((item) => ready[item]));
    const slots = free[kind];
    const k = slots.indexOf(Math.min(...slots));
    const start = Math.max(slots[k], inputsIn, gatesDone);
    const hours = job.batches * job.chain.cycleDurationHours;
    slots[k] = start + hours;
    facilityHours[kind] += hours;
    for (const o of job.chain.outputs) ready[o.item] = Math.max(ready[o.item] ?? 0, start + hours);
  }
  const total = ready[product];
  return { product, total, days: total / 24, researchHours, miningHours, refineryHours: facilityHours.refinery, arrayHours: facilityHours["synthesis-array"], research: research.filter((id) => !held.has(id)) };
}

// ─── 3. Allocation: does a contested intermediate get split? ────────────────────

/** mulberry32: a seeded stream, so a run is reproducible and a changed number means changed data. */
function seeded(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Credits for selling `units` of `item` into its bid, `soldBefore` already sold into it today. */
function sale(item, units, soldBefore, quotaFor = bidQuotaFor) {
  const rule = { ...ECONOMY.npcBid, quotaPerDay: quotaFor(item) };
  let credits = 0;
  for (let k = 0; k < units; k += 1) credits += npcBidFor(BASE[item] || 0, soldBefore + k, rule);
  return credits;
}

/** The contests: each item two or more chains take, where one of them is Tier 4; and the Array's day. */
export function contests() {
  const byItem = new Map();
  for (const c of CHAINS) for (const i of c.inputs) byItem.set(i.item, [...(byItem.get(i.item) || []), c]);
  const list = [...byItem].filter(([, cs]) => cs.length > 1 && cs.some((c) => facilityOf(c) === "synthesis-array"))
    .map(([item, cs]) => ({ name: item, item, recipes: cs }));
  list.push({ name: "Synthesis Array hours", item: null, recipes: CHAINS.filter((c) => facilityOf(c) === "synthesis-array") });
  return list;
}

/**
 * The planner: how many batches of each recipe to run today, and what to sell of the contested stock, to earn the most.
 * Outputs are sold into their bids from `presold` (units already sold today by others, per item); inputs other than
 * the contested one are bought at base. Facility time: two Refineries' and one Array's 24 hours.
 */
export function plan(contest, stock, presold, quotaFor = bidQuotaFor) {
  const { item, recipes } = contest;
  const cap = (c) => Math.floor(24 * (facilityOf(c) === "refinery" ? REFINERIES : 1) / c.cycleDurationHours);
  const need = (c) => (item ? c.inputs.find((i) => i.item === item).quantityPerCycle : 0);
  let best = { net: -Infinity, batches: recipes.map(() => 0) };
  const walk = (i, batches, used, arrayHours, refineryHours) => {
    if (i === recipes.length) {
      const sold = {};
      let net = 0;
      recipes.forEach((c, r) => {
        const n = batches[r];
        if (!n) return;
        for (const input of c.inputs) if (input.item !== item) net -= (BASE[input.item] || 0) * input.quantityPerCycle * n;
        for (const o of c.outputs) { const units = o.quantityPerCycle * n; net += sale(o.item, units, (presold[o.item] || 0) + (sold[o.item] || 0), quotaFor); sold[o.item] = (sold[o.item] || 0) + units; }
      });
      if (item) net += sale(item, stock - used, presold[item] || 0, quotaFor); // what is left is sold as it is
      if (net > best.net) best = { net, batches: [...batches] };
      return;
    }
    const c = recipes[i];
    for (let n = 0; n <= cap(c); n += 1) {
      const u = used + n * need(c);
      const ah = arrayHours + (facilityOf(c) === "synthesis-array" ? n * c.cycleDurationHours : 0);
      const rh = refineryHours + (facilityOf(c) === "refinery" ? n * c.cycleDurationHours : 0);
      if ((item && u > stock) || ah > 24 || rh > 24 * REFINERIES) break;
      batches[i] = n;
      walk(i + 1, batches, u, ah, rh);
    }
    batches[i] = 0;
  };
  walk(0, recipes.map(() => 0), 0, 0, 0);
  return best;
}

/** The two market states the allocation is played in: nobody else has sold today, and others have sold up to 80%. */
export const MARKETS = [{ name: "quiet", busy: 0 }, { name: "busy", busy: 0.8 }];

/**
 * `runs` seeded market states for each contest: the stock (item contests: enough for one to eight batches of its
 * hungriest recipe) and how much of each output's quota others have already sold today (0 up to `busy`). Returns the
 * share of stock (or Array hours) each recipe takes on average, and in how many runs the planner used two or more.
 */
export function allocation(runs = 100, { seed = 887, busy = 0.8, quotaFor = bidQuotaFor } = {}) {
  const rand = seeded(seed);
  return contests().map((contest) => {
    const { item, recipes } = contest;
    const perBatch = (c) => (item ? c.inputs.find((i) => i.item === item).quantityPerCycle : c.cycleDurationHours);
    const shares = recipes.map(() => 0);
    let sellShare = 0;
    let split = 0;
    for (let r = 0; r < runs; r += 1) {
      const stock = item ? Math.round((1 + rand() * 7) * Math.max(...recipes.map(perBatch))) : 24;
      const presold = {};
      for (const c of recipes) for (const o of c.outputs) presold[o.item] = Math.floor(rand() * busy * quotaFor(o.item));
      if (item) presold[item] = Math.floor(rand() * busy * quotaFor(item));
      const { batches } = plan(contest, stock, presold, quotaFor);
      const used = batches.map((n, i) => n * perBatch(recipes[i]));
      used.forEach((u, i) => { shares[i] += u / stock / runs; });
      if (item) sellShare += (stock - used.reduce((a, b) => a + b, 0)) / stock / runs;
      if (batches.filter((n) => n > 0).length >= 2) split += 1;
    }
    return { name: contest.name, recipes: recipes.map((c, i) => ({ id: c.id, share: shares[i] })), soldAsIs: item ? sellShare : null, splitRuns: split, runs };
  });
}

// ─── The report ────────────────────────────────────────────────────────────────

export const SPLIT_TARGET = 0.6;

/** Each target, met or missed, as the report states it. `alloc` is { market: [contest results] }. */
export function targets({ reach, alloc }) {
  return [
    { target: "every Tier 4 product is reachable (T-019)", met: reach.length === 0, detail: reach.length ? reach.map((r) => `${r.product}: ${r.why.join("; ")}`).join(" | ") : `${TIER4_PRODUCTS.length} of ${TIER4_PRODUCTS.length}` },
    ...Object.entries(alloc).map(([market, list]) => ({
      target: `${market} market: each contest split between two recipes or more in at least ${SPLIT_TARGET * 100}% of runs`,
      met: list.every((a) => a.splitRuns / a.runs >= SPLIT_TARGET),
      detail: list.map((a) => `${a.name} ${Math.round((a.splitRuns / a.runs) * 100)}%`).join(", ")
    }))
  ];
}

export function formatReport({ reach, firsts, alloc }) {
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  const lines = ["TIER 4 PROBE (AB#887). BOT NUMBERS (P-PROXY): a planner over the data and the bid rule, not players.", ""];
  lines.push("Time to the first unit, from a v0.10-level corporation (bot-days; research, mining, Refinery and Array hours):");
  for (const f of firsts) lines.push(`  ${f.product.padEnd(22)} ${f.days.toFixed(1).padStart(5)} days  research ${f.researchHours}h (${f.research.join(", ")}), mining ${f.miningHours.toFixed(1)}h, refinery ${f.refineryHours}h, array ${f.arrayHours}h`);
  for (const [market, list] of Object.entries(alloc)) {
  lines.push("", `Allocation, ${market} market (${market === "quiet" ? "nobody else has sold today" : "others have sold 0 to 80% of each quota today"}): the share of the contested stock, or of the Array's day, each recipe takes, and the runs where the planner split:`);
  for (const a of list) {
    lines.push(`  ${a.name}: split in ${a.splitRuns}/${a.runs} runs`);
    lines.push(`    ${a.recipes.map((r) => `${r.id} ${pct(r.share)}`).join(", ")}${a.soldAsIs !== null ? `, sold as it is ${pct(a.soldAsIs)}` : ""}`);
  }
  }
  lines.push("", "Targets (printed, not asserted, but reachability; misses are filed):");
  for (const t of targets({ reach, alloc })) lines.push(`  ${t.met ? "MET " : "MISS"} ${t.target}: ${t.detail}`);
  return lines.join("\n");
}
