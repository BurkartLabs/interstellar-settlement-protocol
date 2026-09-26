// A refinery run's inputs, batches and debits (ISP-131, AB#825): one rule for the start-refinery route and the Refinery
// page. A chain takes `inputs: [{ item, quantityPerCycle }]`, one or several (docs/design/tier3-recipes.md). A start
// either debits every input in full or is refused whole, so an alloy is never started on half its metals. Pure, so it
// loads in node.
import { wholeNumber } from "./wholeNumber.js";
import { refineMinimum, refineQuantityCheck } from "./refineQuantity.js";

const fmt = (n) => Number(n).toLocaleString("en-US");

/** The longest one run may last: a week (docs/design/tier3-recipes.md, section 7). */
export const MAX_RUN_HOURS = 168;

/**
 * A chain's inputs per batch, or null when its entry is not a usable recipe: no list, an empty one, an item named twice,
 * or a quantity that is not a whole number of at least 1. The route refuses a start on null (it fails closed).
 */
export function chainInputs(chain) {
  const list = chain?.inputs;
  if (!Array.isArray(list) || !list.length) return null;
  const seen = new Set();
  for (const input of list) {
    if (typeof input?.item !== "string" || !input.item || seen.has(input.item)) return null;
    if (!Number.isInteger(input.quantityPerCycle) || input.quantityPerCycle < 1) return null;
    seen.add(input.item);
  }
  return list.map((input) => ({ item: input.item, quantityPerCycle: input.quantityPerCycle }));
}

/** The most batches one run of a chain may take: as many as fit in a week, and at least one. */
export function maxBatches(chain) {
  const hours = Number(chain?.cycleDurationHours);
  return hours > 0 ? Math.max(1, Math.floor(MAX_RUN_HOURS / hours)) : 1;
}

/** The fewest batches a run takes: a one-input chain keeps its at-least-100-units rule (AB#1255), any other takes 1. */
export function minBatches(chain) {
  const inputs = chainInputs(chain);
  return inputs?.length === 1 ? refineMinimum(inputs[0].quantityPerCycle) / inputs[0].quantityPerCycle : 1;
}

/** "150 Iron Ore + 50 Nickel": what a run takes, from `[{ item, quantity }]`. */
export function inputsLabel(debits) {
  return (debits || []).map((d) => `${fmt(d.quantity)} ${d.item}`).join(" + ");
}

const absent = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/**
 * Check a start against a chain. The run is asked for as `inputQuantity`, units of the one input (one-input chains
 * only, as the page has always sent it), or as `batches` (any chain); exactly one of the two. `availableOf(item)` is
 * what the station holds. Returns `{ ok: true, batches, debits: [{ item, quantity }] }`, or `{ ok: false, reason }`
 * with `missing` (the inputs that are short) when the refusal is about stock. Nothing is rounded or substituted.
 */
export function refineRunCheck(chain, { inputQuantity, batches } = {}, availableOf = () => Infinity) {
  const inputs = chainInputs(chain);
  if (!inputs) return { ok: false, reason: "This chain has no recipe the refinery can run. Nothing was used." };
  const names = inputs.map((i) => i.item).join(" and ");
  const byQuantity = !absent(inputQuantity);
  if (byQuantity === !absent(batches)) {
    return { ok: false, reason: inputs.length === 1 ? `Enter how much ${inputs[0].item} to refine, or a number of batches.` : `Enter a number of batches of ${names}.` };
  }

  let n;
  if (byQuantity) {
    if (inputs.length !== 1) return { ok: false, reason: `This chain takes ${names}: enter a number of batches.` };
    const check = refineQuantityCheck(inputQuantity, { perCycle: inputs[0].quantityPerCycle, input: inputs[0].item });
    if (!check.ok) return check;
    n = check.batches;
  } else {
    n = wholeNumber(batches);
    const min = minBatches(chain);
    if (n === null || n < min) return { ok: false, reason: `Enter a whole number of batches: at least ${fmt(min)}.` };
  }

  const cap = maxBatches(chain);
  if (n > cap) {
    const most = inputsLabel(inputs.map((i) => ({ item: i.item, quantity: i.quantityPerCycle * cap })));
    return { ok: false, reason: `A run lasts at most a week: at most ${fmt(cap)} batches of this chain (${most}).` };
  }

  const debits = inputs.map((i) => ({ item: i.item, quantity: i.quantityPerCycle * n }));
  const short = debits.filter((d) => Number(availableOf(d.item) || 0) < d.quantity);
  if (short.length) {
    return {
      ok: false,
      reason: short.map((d) => `Not enough ${d.item} at this station. Need ${d.quantity} but only have ${Number(availableOf(d.item) || 0)}.`).join(" "),
      missing: short.map((d) => d.item)
    };
  }
  return { ok: true, batches: n, debits };
}
