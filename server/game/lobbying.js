// server/game/lobbying.js: a lobbying campaign's arithmetic (ISP-239, AB#934; docs/design/WARFARE.md, "Lobbying").
// Pure: no files and no clock, so the curve, the netting and the bounds are tested with hand-worked values.
//
// Each side's influence is its credits plus creditsPerStandingPoint for each standing point it pledged. A side's pull
// is E(I) = M x (1 - e^(-I / K)), M the most a campaign moves the parameter and K its spend scale, so doubling a spend
// never doubles its effect. When pledging closes the parameter moves by E(for) - E(against), rounded toward zero to the
// parameter's step, in the campaign's direction, and held inside the parameter's bounds.

/** Why a lobbyable parameter's spec cannot be evaluated, or null when it can (fails closed: a bad spec is refused). */
export function specProblem(spec) {
  const ok = (v) => typeof v === "number" && Number.isFinite(v);
  if (!spec || !ok(spec.step) || !(spec.step > 0) || !ok(spec.maxShift) || !(spec.maxShift > 0) || !ok(spec.spendScale) || !(spec.spendScale > 0) || !ok(spec.min) || !ok(spec.max) || spec.min > spec.max) {
    return "This parameter's lobbying terms cannot be evaluated.";
  }
  return null;
}

/** A side's influence: its credits plus its standing at creditsPerStandingPoint a point. */
export function influence(credits, standing, creditsPerStandingPoint) {
  return (Number(credits) || 0) + (Number(standing) || 0) * creditsPerStandingPoint;
}

/** A side's pull on the parameter: M x (1 - e^(-I / K)). */
export function pull(I, spec) {
  return spec.maxShift * (1 - Math.exp(-Math.max(0, I) / spec.spendScale));
}

/**
 * The campaign's outcome: { eFor, eAgainst, steps, to } where `to` is the parameter's value while the campaign holds:
 * `base` moved by (eFor - eAgainst) rounded toward zero to the step, up for "raise" and down for "lower", inside bounds.
 * Returns null when the curve cannot be evaluated.
 */
export function outcome(base, direction, forI, againstI, spec) {
  if (specProblem(spec) || !Number.isFinite(base) || !["raise", "lower"].includes(direction)) return null;
  const eFor = pull(forI, spec);
  const eAgainst = pull(againstI, spec);
  const raw = eFor - eAgainst;
  if (!Number.isFinite(raw)) return null;
  const steps = Math.trunc(raw / spec.step + Math.sign(raw) * 1e-9); // toward zero; the epsilon keeps 0.75 / 0.25 at 3
  const moved = base + (direction === "raise" ? 1 : -1) * steps * spec.step;
  const to = Math.round(Math.min(spec.max, Math.max(spec.min, moved)) * 1e6) / 1e6;
  return { eFor, eAgainst, steps, to };
}
