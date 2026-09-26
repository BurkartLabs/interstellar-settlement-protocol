// server/game/beltRules.js: the rules of an asteroid belt, as pure functions (AB#2329, from docs/design/belts.md,
// AB#1050). The server's belt state (belts.js) and the design's model (scripts/belt-model.mjs) both use these, so the
// numbers the design quotes are the numbers the game runs.

/** A belt's rarity tiers, least to most rare. */
export const BELT_TIERS = Object.freeze(["common", "uncommon", "rare", "exotic"]);

/** An expedition's units a minute before its belt's rarity (applyAsteroidExpeditions, server/game/asteroids.js). */
export const BASE_YIELD_PER_MIN = 3;

/** What a belt's rarity multiplies an expedition's yield by. */
export const RARITY_YIELD_MULTIPLIER = Object.freeze({ common: 1.0, uncommon: 1.15, rare: 1.35, exotic: 1.6 });

/** A standard expedition's hours (EXPEDITION_DURATIONS.standard, production): the unit a belt's reserve is counted in. */
export const STANDARD_EXPEDITION_HOURS = 1;

/**
 * Each tier's composition template: the belts of that label in data/systems.json, averaged, as shares summing to 1.
 * A tier no belt carries has no template, and a belt is never drawn at it (drawTier renormalizes).
 */
export function tierTemplates(systems, tiers = BELT_TIERS) {
  const out = {};
  for (const tier of tiers) {
    const belts = systems.filter((s) => s.rarity === tier).flatMap((s) => (s.bodies || []).filter((b) => b.composition));
    if (!belts.length) continue;
    const sum = {};
    for (const b of belts) {
      const total = Object.values(b.composition).reduce((a, v) => a + v, 0);
      for (const [r, w] of Object.entries(b.composition)) sum[r] = (sum[r] || 0) + w / total / belts.length;
    }
    out[tier] = Object.fromEntries(Object.entries(sum).sort((a, b) => b[1] - a[1]));
  }
  return out;
}

/** A system's chance of each tier for a new belt: stepWeight^|distance from its label|, normalized. */
export function rarityDistribution(label, stepWeight, tiers = BELT_TIERS) {
  const at = tiers.indexOf(label);
  const weights = tiers.map((_, i) => stepWeight ** Math.abs(i - at));
  const total = weights.reduce((a, b) => a + b, 0);
  return Object.fromEntries(tiers.map((t, i) => [t, weights[i] / total]));
}

/** A tier drawn from a distribution with one draw of `rng` in [0, 1); only tiers in `allowed` are drawn. */
export function drawTier(distribution, rng, allowed = BELT_TIERS) {
  const entries = Object.entries(distribution).filter(([t]) => allowed.includes(t));
  const total = entries.reduce((a, [, p]) => a + p, 0);
  let roll = rng() * total;
  for (const [tier, p] of entries) {
    roll -= p;
    if (roll < 0) return tier;
  }
  return entries[entries.length - 1][0];
}

/**
 * A new belt's composition: the template's shares, each multiplied by a draw in 1 +- jitter, renormalized to percent
 * and rounded to one decimal, as data/systems.json writes a belt's composition.
 */
export function jitterComposition(template, jitter, rng) {
  const raw = Object.entries(template).map(([r, share]) => [r, share * (1 + (rng() * 2 - 1) * jitter)]);
  const total = raw.reduce((a, [, w]) => a + w, 0);
  return Object.fromEntries(raw.map(([r, w]) => [r, Math.round((w / total) * 1000) / 10]));
}

/** A belt's reserve at a tier: reserveStandardExpeditions standard expeditions' yield there, in whole units. */
export function beltReserve(tier, reserveStandardExpeditions) {
  const perStandard = BASE_YIELD_PER_MIN * 60 * STANDARD_EXPEDITION_HOURS * RARITY_YIELD_MULTIPLIER[tier];
  return Math.round(reserveStandardExpeditions * perStandard);
}

/** The first hour boundary (xx:00 UTC) strictly after `t`, in ms. */
export function nextHourAfter(t) {
  const HOUR = 3_600_000;
  return Math.floor(t / HOUR) * HOUR + HOUR;
}
