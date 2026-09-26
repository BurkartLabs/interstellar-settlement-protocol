import { describe, it, expect } from "vitest";
import { ECONOMY } from "../../server/economy.js";
import { BELT_TIERS, beltReserve, drawTier, jitterComposition, nextHourAfter, rarityDistribution } from "../../server/game/beltRules.js";
import { BELT_SLOTS, TIER_TEMPLATES, beltRespawnTick, ensureBeltState, isBeltPresent, markBeltEmpty, spawnBelt } from "../../server/game/belts.js";
import { SYSTEMS_DATA } from "../../server/game/catalog.js";
import { normalizeGlobalState } from "../../server/game/world.js";

// AB#2329: asteroid belts as world state, per docs/design/belts.md (AB#1050): each slot's belt with a generation,
// rarity, composition, reserve and what remains; an empty slot's draw on the hour; a new belt's rarity from its system's
// distribution and its composition its tier's template jittered. Draws use a seeded source and an injected clock.

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 26, 10, 30); // 10:30 UTC: the next draw is at 11:00
const rules = ECONOMY.belts;

/** A seeded source in [0, 1) (mulberry32), so a statistical check is the same every run. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A source that returns these values in turn, then the last one for ever. */
const sequence = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
const sol = BELT_SLOTS.find((s) => s.key === "sol:belt");

describe("belt rules (AB#2329)", () => {
  it("a reserve is the design's standard expeditions at the tier: 2,520 common, 4,032 exotic", () => {
    expect(beltReserve("common", rules.reserveStandardExpeditions)).toBe(2520);
    expect(beltReserve("exotic", rules.reserveStandardExpeditions)).toBe(4032);
  });

  it("draws a tier at the distribution's odds: Sol's belt is exotic about 1.2% of the time", () => {
    const rng = seeded(7);
    const dist = rarityDistribution("common", rules.rarityStepWeight);
    const counts = Object.fromEntries(BELT_TIERS.map((t) => [t, 0]));
    const N = 200_000;
    for (let i = 0; i < N; i++) counts[drawTier(dist, rng)] += 1;
    for (const t of BELT_TIERS) expect(counts[t] / N, t).toBeCloseTo(dist[t], 2);
    expect(counts.exotic / N).toBeGreaterThan(0.009);
    expect(counts.exotic / N).toBeLessThan(0.015);
  });

  it("jitters a template's shares within 1 +- 0.25 before renormalizing, keeping its resources and a 100% total", () => {
    const rng = seeded(11);
    const template = TIER_TEMPLATES.rare;
    for (let i = 0; i < 500; i++) {
      const c = jitterComposition(template, rules.compositionJitter, rng);
      expect(Object.keys(c).sort()).toEqual(Object.keys(template).sort());
      expect(Math.abs(Object.values(c).reduce((a, b) => a + b, 0) - 100)).toBeLessThan(1);
      for (const [r, pct] of Object.entries(c)) {
        const ratio = pct / 100 / template[r];
        expect(ratio, r).toBeGreaterThan(0.75 / 1.25 - 0.01);
        expect(ratio, r).toBeLessThan(1.25 / 0.75 + 0.01);
      }
    }
  });

  it("the next draw is at the next hour boundary, strictly after", () => {
    expect(nextHourAfter(T0)).toBe(Date.UTC(2026, 8, 26, 11, 0));
    expect(nextHourAfter(Date.UTC(2026, 8, 26, 11, 0))).toBe(Date.UTC(2026, 8, 26, 12, 0));
  });
});

describe("belt state (AB#2329)", () => {
  it("every Field body with a composition is a slot", () => {
    const fields = SYSTEMS_DATA.flatMap((s) => (s.bodies || []).filter((b) => b.composition).map((b) => `${s.id}:${b.id}`));
    expect(BELT_SLOTS.map((s) => s.key).sort()).toEqual(fields.sort());
  });

  it("an install saved before this gets today's belts as generation 1, full, and keeps a belt it already has", () => {
    const state = normalizeGlobalState({});
    for (const slot of BELT_SLOTS) {
      const belt = state.belts[slot.key];
      expect(belt).toMatchObject({ generation: 1, rarity: slot.label, composition: slot.composition, remaining: belt.reserve });
      expect(belt.reserve).toBe(beltReserve(slot.label, rules.reserveStandardExpeditions));
    }
    state.belts["sol:belt"].remaining = 7;
    ensureBeltState(state);
    expect(state.belts["sol:belt"].remaining).toBe(7);
  });

  it("a present belt is never redrawn", () => {
    const state = ensureBeltState({}, T0);
    const before = JSON.stringify(state.belts);
    expect(beltRespawnTick(state, T0 + 10 * HOUR, () => 0)).toEqual([]);
    expect(JSON.stringify(state.belts)).toBe(before);
  });

  it("an empty slot does not draw before the next hour, draws at each hour after, and a miss moves the draw on", () => {
    const state = ensureBeltState({}, T0);
    markBeltEmpty(state, "sol:belt", T0);
    expect(isBeltPresent(state.belts["sol:belt"])).toBe(false);
    expect(beltRespawnTick(state, T0 + 29 * 60_000, () => 0)).toEqual([]); // 10:59: no hour boundary yet
    expect(beltRespawnTick(state, T0 + 30 * 60_000, () => 0.99)).toEqual([]); // 11:00, a miss
    expect(state.belts["sol:belt"].lastDrawAt).toBe(Date.UTC(2026, 8, 26, 11, 0));
    expect(beltRespawnTick(state, T0 + 50 * 60_000, () => 0)).toEqual([]); // 11:20: 11:00 was drawn already
  });

  it("a hit spawns the next generation, dated its hour, drawn from its system's distribution, full", () => {
    const state = ensureBeltState({}, T0);
    markBeltEmpty(state, "sol:belt", T0);
    const [belt] = beltRespawnTick(state, T0 + 30 * 60_000, sequence(0.1, 0.5, 0.5));
    expect(belt).toMatchObject({ key: "sol:belt", generation: 2, rarity: "common", spawnedAt: Date.UTC(2026, 8, 26, 11, 0), remaining: 2520, reserve: 2520 });
    expect(Object.keys(belt.composition).sort()).toEqual(Object.keys(TIER_TEMPLATES.common).sort());
    expect(state.belts["sol:belt"]).toBe(belt);
  });

  it("hours missed while the server was down are drawn when it next runs, in order, up to the first hit", () => {
    const state = ensureBeltState({}, T0);
    markBeltEmpty(state, "sol:belt", T0);
    // 11:00, 12:00 and 13:00 miss; 14:00 hits; then the spawn's own draws.
    const [belt] = beltRespawnTick(state, T0 + 10 * HOUR, sequence(0.9, 0.9, 0.9, 0.1, 0.5, 0.5));
    expect(belt.spawnedAt).toBe(Date.UTC(2026, 8, 26, 14, 0));
  });

  it("an empty slot comes back with the design's chance: 20% an hour, about 5 hours' wait", () => {
    const rng = seeded(3);
    let hits = 0;
    let waited = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const state = { belts: { "sol:belt": { ...spawnBelt(sol, 1, T0, () => 0.5), remaining: 0, emptiedAt: T0 } } };
      const [belt] = beltRespawnTick(state, T0 + 30 * 60_000, rng); // only 11:00 is drawn
      if (belt) hits += 1;
      const state2 = { belts: { "sol:belt": { ...spawnBelt(sol, 1, T0, () => 0.5), remaining: 0, emptiedAt: T0 } } };
      const [later] = beltRespawnTick(state2, T0 + 200 * HOUR, rng);
      waited += (later.spawnedAt - T0) / HOUR;
    }
    expect(hits / N).toBeCloseTo(rules.respawnChancePerHour, 2);
    expect(waited / N).toBeCloseTo(0.5 + 1 / rules.respawnChancePerHour - 1, 0); // first draw 30 minutes after emptying
  });

  it("a belt respawned in a rare system can be common, and one in Sol can be exotic: the label is a centre, not the answer", () => {
    const tau = BELT_SLOTS.find((s) => s.systemId === "tau-ceti");
    expect(spawnBelt(tau, 2, T0, sequence(0.001, 0.5)).rarity).toBe("common");
    expect(spawnBelt(sol, 2, T0, sequence(0.999, 0.5)).rarity).toBe("exotic");
  });
});
