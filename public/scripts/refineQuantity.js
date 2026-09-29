// How much a refinery run may take (AB#1255), in one place for the Refinery Chains form and the start-refinery route.
// The form used to turn a cleared or small quantity into the minimum on the next refresh, and the route raised anything
// below one batch to a batch: both spent materials the player never chose. Now both refuse, with the same reason.
import { wholeNumber } from "./wholeNumber.js";

const fmt = (n) => Number(n).toLocaleString("en-US");

/** Units per batch, as a whole number of at least 1. */
function batchSize(perCycle) {
  return Math.max(1, Math.floor(Number(perCycle) || 1));
}

/** The smallest run: whole batches, at least 100 units (Helium-3 at 50 a batch needs 2; Titanium at 80 needs 2). */
export function refineMinimum(perCycle) {
  const per = batchSize(perCycle);
  return Math.ceil(Math.max(100, per) / per) * per;
}

/**
 * What the Quantity field shows after a re-render: exactly what the player typed, blank included, or the suggested
 * amount when they have typed nothing. (It used to be max(minimum, Number(typed)), so a cleared field came back full.)
 */
export function refineQuantityFieldValue(typed, suggested) {
  return typed === undefined || typed === null ? String(suggested) : String(typed);
}

/**
 * Check a quantity as the player typed it (a string from the form, or a number from a request).
 *   { perCycle, input, available }: the chain's batch size and raw material, and, when known, how much is at hand.
 * Returns { ok: true, quantity, batches } or { ok: false, reason }. Nothing is rounded or substituted.
 */
export function refineQuantityCheck(raw, { perCycle, input, available } = {}) {
  const per = batchSize(perCycle);
  const min = refineMinimum(per);
  const blank = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
  if (blank) return { ok: false, reason: `Enter how much ${input} to refine: at least ${fmt(min)}.` };
  const n = wholeNumber(raw);
  if (n === null) return { ok: false, reason: `Enter a whole number of ${input}: at least ${fmt(min)}, in batches of ${fmt(per)}.` };
  if (n < min) return { ok: false, reason: `A run needs at least ${fmt(min)} ${input}.` };
  if (n % per !== 0) {
    const down = Math.floor(n / per) * per;
    return { ok: false, reason: `Runs use whole batches of ${fmt(per)} ${input}: enter ${fmt(down)} or ${fmt(down + per)}.` };
  }
  if (available !== undefined && available !== null && n > Number(available)) {
    // Bug #4807 (ISP-6's rule): and what to do: the most whole batches the stock covers, or bring stock first
    const most = Math.floor(Number(available) / per) * per;
    const next = most >= min ? `Enter ${fmt(most)} or fewer, or bring more ${input} here.` : `Bring at least ${fmt(min)} ${input} here first.`;
    return { ok: false, reason: `You have ${fmt(available)} ${input} here, not ${fmt(n)}. ${next}` };
  }
  return { ok: true, quantity: n, batches: n / per };
}
