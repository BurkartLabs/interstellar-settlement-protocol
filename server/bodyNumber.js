// Reading a number from a request body (Bug #1014).
//
// Routes used to clamp with Math.max(min, Number(req.body.x || default)). Math.max returns NaN when given NaN, so a
// string like "abc" passed every bound and was written into credits and headcounts; fractions passed too. Every write
// route reads its body numbers through this instead (tests/unit/bodyNumber.test.js checks server/index.js for it).

/**
 * `value` as a finite number, floored if `integer`, clamped to [min, max]; `fallback` if it is missing or not a finite
 * number. A fallback of null lets the route refuse the request instead of assuming a default.
 */
export function bodyNumber(value, { fallback, min = -Infinity, max = Infinity, integer = false } = {}) {
  if (value === undefined || value === null || value === "" || typeof value === "object") return fallback;
  let n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (integer) n = Math.floor(n);
  return Math.min(max, Math.max(min, n));
}

/**
 * A count of things from a request body: a whole number of at least 1; anything else is null, so the route refuses it
 * rather than assuming a default (Bug #425: a sell order or NPC sale with quantity "abc", 0 or -5 must change nothing).
 * A fraction is refused, not floored, like every other count the game takes (AB#731, AB#732).
 */
export function bodyCount(value) {
  const n = bodyNumber(value, { fallback: null });
  return n !== null && Number.isInteger(n) && n >= 1 ? n : null;
}
