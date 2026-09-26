// What the Refinery Chains panel shows of a chain (ISP-142, AB#836): each input with what a run needs and what this
// station holds, which inputs are short, which chain makes each input and which chains take each output, so a player
// can plan a run of several steps (Iron Ore and Nickel into Nickel-Iron Alloy into Pressure Vessels) instead of reading
// one-step recipes in isolation. Pure, so it loads in node; the page (views/refinery.js) draws it, and start-refinery
// checks the same run with refineRunCheck.
import { chainInputs, maxBatches, minBatches } from "./refineryRun.js";

const fmt = (n) => Number(n).toLocaleString("en-US");

/**
 * A chain's card title. A one-input chain keeps the name it has always had ("Silicates Refining"); a chain of several
 * inputs is named for what it makes ("Fusion Reactor Cores"), since a list of three inputs is not a name.
 */
export function chainTitle(chain) {
  const inputs = chain?.inputs || [];
  if (inputs.length > 1) return (chain.outputs || []).map((o) => o.item).join(" + ");
  return `${inputs[0]?.item || "Unknown"} Refining`;
}

/**
 * How a link names a chain: its recipe, "Rare Earths + Cobalt → Rare-Earth Magnets". Its title alone would say
 * "Made by: Rare-Earth Magnets" of Rare-Earth Magnets; the recipe is what a player plans the step before with.
 */
export function chainRecipe(chain) {
  const names = (list) => (list || []).map((x) => x.item).join(" + ");
  return `${names(chain?.inputs)} → ${names(chain?.outputs)}`;
}

const link = (c) => ({ id: c.id, title: chainTitle(c), recipe: chainRecipe(c) });

/** The chains that make `item`, as { id, title, recipe }: the link from an input to where it comes from. */
export function producersOf(item, chains) {
  return (chains || []).filter((c) => (c.outputs || []).some((o) => o.item === item)).map(link);
}

/** The chains that take `item`, as { id, title, recipe }: the link from an output to where it goes next. */
export function consumersOf(item, chains) {
  return (chains || []).filter((c) => (c.inputs || []).some((i) => i.item === item)).map(link);
}

/**
 * The batches the panel offers before the player types anything: as many as every input covers, within the run's
 * limits (at least minBatches, at most a week). When an input is short it is still the minimum, so the rows say what
 * a first run needs.
 */
export function defaultBatches(chain, held = {}) {
  const inputs = chainInputs(chain) || [];
  const covered = inputs.length ? Math.min(...inputs.map((i) => Math.floor(Number(held[i.item] || 0) / i.quantityPerCycle))) : 0;
  return Math.min(maxBatches(chain), Math.max(minBatches(chain), covered));
}

/**
 * One row per input for a run of `batches`: what a batch takes, what the run needs, what this station holds, whether
 * it is short and by how much, and the chains that make it.
 */
export function inputRows(chain, batches, held = {}, chains = []) {
  const n = Math.max(0, Math.floor(Number(batches) || 0));
  return (chainInputs(chain) || []).map((i) => {
    const needed = i.quantityPerCycle * n;
    const have = Math.max(0, Number(held[i.item] || 0));
    return {
      item: i.item,
      perBatch: i.quantityPerCycle,
      needed,
      held: have,
      short: have < needed,
      shortBy: Math.max(0, needed - have),
      madeBy: producersOf(i.item, chains)
    };
  });
}

/** One row per output: what a run makes and the chains that take it next. */
export function outputRows(chain, batches, chains = []) {
  const n = Math.max(0, Math.floor(Number(batches) || 0));
  return (chain?.outputs || []).map((o) => ({ item: o.item, perBatch: o.quantityPerCycle, made: o.quantityPerCycle * n, usedBy: consumersOf(o.item, chains) }));
}

/** What the Start button says: "Start Run", or which inputs are short ("Short: Rare-Earth Magnets"). */
export function startLabel(rows) {
  const short = (rows || []).filter((r) => r.short).map((r) => r.item);
  return short.length ? `Short: ${short.join(", ")}` : "Start Run";
}

/** "Needs 150 · holds 300", as a row reads it. */
export function amountsText(row) {
  return `Needs ${fmt(row.needed)} · holds ${fmt(row.held)}`;
}
