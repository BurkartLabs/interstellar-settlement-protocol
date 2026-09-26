// The asteroid belt model (AB#1050): what a belt yields and earns by rarity, how large a finite belt is, how often an
// empty belt comes back, how the rarity of a respawned belt is drawn per system, and what depletion costs a corporation
// on the ladder's pace, computed from data/economy.json, data/systems.json and the rules in the code below. A model,
// not play: it takes those rules as written, plays perfectly and sells every unit it can at the standing bid.
// `npm run belt:model` prints it; docs/design/belts.md quotes the output, and tests/unit/beltModel.test.js keeps the
// two in step and checks each code rule against the source.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

// AB#2329: the belt rules are the game's own (server/game/beltRules.js), imported, not copied; the design's four numbers
// are data/economy.json's `belts`, read below. What is left here is what the model alone assumes.
import { BASE_YIELD_PER_MIN, BELT_TIERS, RARITY_YIELD_MULTIPLIER, beltReserve, rarityDistribution, tierTemplates } from "../server/game/beltRules.js";
export { rarityDistribution, tierTemplates };

/** The rules the model takes from code, with where each is; the unit test fails when one no longer matches. */
export const CODE_RULES = {
  baseYieldPerMin: { value: BASE_YIELD_PER_MIN, where: "server/game/beltRules.js, BASE_YIELD_PER_MIN (used by applyAsteroidExpeditions)" },
  rarityYieldMultiplier: { value: RARITY_YIELD_MULTIPLIER, where: "server/game/beltRules.js, RARITY_YIELD_MULTIPLIER" },
  expeditionHours: { value: { short: 0.5, standard: 1, extended: 2 }, where: "server/game/asteroids.js, EXPEDITION_DURATIONS (production)" }
};

/**
 * What the model assumes beyond the game's data: the tiers, and the ladder's pace and the populations it is read at
 * (docs/design/belts.md). The design's own numbers (reserve, respawn chance, rarity step, jitter) are data/economy.json's
 * `belts` since AB#2329, so tuning one there changes the game and this model together.
 */
export const DESIGN = {
  tiers: BELT_TIERS,
  ladderExpeditionsPerDay: 2,     // docs/design/ladder-11-40.md: one out, relaunched each check-in
  ladderCheckInHours: 12,
  populations: [1, 5, 20]         // corporations mining one belt, on the ladder's pace
};

/** The model, as numbers. */
export function computeBeltModel(economy, systems, rules = CODE_RULES, assumed = DESIGN) {
  const r = Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, v.value]));
  const design = { ...assumed, ...economy.belts };
  const keep = 1 - economy.exchange.salesTaxPct / 100;
  const price = Object.fromEntries(economy.npcBuyers.map((b) => [b.item, b.unitPrice]));
  const templates = tierTemplates(systems, design.tiers);

  // What an expedition yields and earns at each tier, from its template: units, the share a standing order buys, and
  // credits after the exchange tax, against the launch cost.
  const tiers = design.tiers.map((tier) => {
    const composition = templates[tier];
    const valuePerUnit = Object.entries(composition).reduce((a, [res, share]) => a + share * (price[res] || 0), 0) * keep;
    const sellableShare = Object.entries(composition).reduce((a, [res, share]) => a + (price[res] ? share : 0), 0);
    const perHour = r.baseYieldPerMin * 60 * r.rarityYieldMultiplier[tier];
    const byDuration = Object.fromEntries(Object.entries(r.expeditionHours).map(([d, h]) => {
      const units = perHour * h;
      return [d, { units, credits: units * valuePerUnit, net: units * valuePerUnit - economy.expeditions.launchCost }];
    }));
    const reserve = beltReserve(tier, design.reserveStandardExpeditions);
    return { tier, composition, valuePerUnit, sellableShare, perHour, byDuration, reserve };
  });
  // AB#830: the resources in the templates no standing order buys, from the data (it was a fixed list, and went stale
  // when the Fuel track gave Water Ice and Hydrogen a buyer).
  const unbought = [...new Set(tiers.flatMap((t) => Object.keys(t.composition)))].filter((res) => !price[res]);
  const tierBy = Object.fromEntries(tiers.map((t) => [t.tier, t]));

  // Per system: the chance of each tier for a belt that respawns there, and what that does to its average yield.
  const systemRows = systems.filter((s) => (s.bodies || []).some((b) => b.composition)).map((s) => {
    const dist = rarityDistribution(s.rarity, design.rarityStepWeight, design.tiers);
    const expectedMult = design.tiers.reduce((a, t) => a + dist[t] * r.rarityYieldMultiplier[t], 0);
    const expectedNet = design.tiers.reduce((a, t) => a + dist[t] * tierBy[t].byDuration.standard.net, 0);
    return { id: s.id, name: s.name, label: s.rarity, dist, expectedMult, change: expectedMult / r.rarityYieldMultiplier[s.rarity] - 1, expectedNet };
  });

  // Respawn: a draw each hour on the hour; the wait is geometric.
  const p = design.respawnChancePerHour;
  const respawn = { meanWaitHours: 1 / p, emptyAfter12h: (1 - p) ** 12, emptyAfter24h: (1 - p) ** 24 };

  // A common belt mined by N corporations, each on the ladder's pace of standard expeditions: how long it lasts, and
  // the share of hours its slot is empty.
  const common = tierBy.common;
  const population = design.populations.map((n) => {
    const unitsPerHour = n * design.ladderExpeditionsPerDay * common.byDuration.standard.units / 24;
    const lifeHours = common.reserve / unitsPerHour;
    const respawnsPerYear = (365 * 24) / (lifeHours + respawn.meanWaitHours);
    const solExotic = systemRows.find((s) => s.id === "sol")?.dist.exotic || 0;
    return { corporations: n, lifeHours, emptyShare: respawn.meanWaitHours / (lifeHours + respawn.meanWaitHours), respawnsPerYear, solExoticPerYear: respawnsPerYear * solExotic };
  });

  // What depletion costs a lone corporation on the ladder: after the launch that empties the belt, each later check-in
  // finds it still empty with probability (1-p)^(12k); the launches lost per belt, against the launches it gives.
  const perBelt = design.reserveStandardExpeditions;
  let lost = 0;
  for (let k = 1; k < 100; k++) lost += (1 - p) ** (design.ladderCheckInHours * k);
  const ladder = { launchesPerBelt: perBelt, lostPerBelt: lost, lostShare: lost / (perBelt + lost) };

  return { tiers, unbought, systems: systemRows, respawn, population, ladder, design, launchCost: economy.expeditions.launchCost };
}

const fmt = (n, d = 0) => (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;

/** The model as the text docs/design/belts.md quotes. */
export function renderBeltModel(m) {
  const lines = [];
  lines.push(`Launch cost ${fmt(m.launchCost)}. Credits are what the standing orders pay for the belt's mix, after the 8% tax;`);
  lines.push(`a resource no standing order buys (${m.unbought.join(", ")}) counts 0.`);
  lines.push("");
  lines.push("Per tier, from its template (today's belts of that label, averaged):");
  lines.push("  tier     | units/h | sold share | credits/unit | standard: units, credits, net | extended: units, net | reserve (units)");
  for (const t of m.tiers) {
    const s = t.byDuration.standard;
    const e = t.byDuration.extended;
    lines.push(`  ${t.tier.padEnd(8)} | ${fmt(t.perHour).padStart(7)} | ${pct(t.sellableShare, 0).padStart(10)} | ${fmt(t.valuePerUnit, 2).padStart(12)} | ${fmt(s.units).padStart(5)}, ${fmt(s.credits).padStart(6)}, ${fmt(s.net).padStart(6)} | ${fmt(e.units).padStart(5)}, ${fmt(e.net).padStart(6)} | ${fmt(t.reserve).padStart(6)}`);
  }
  lines.push("");
  lines.push(`Rarity of a respawned belt, per system (each tier away from the label ${m.design.rarityStepWeight} as likely):`);
  lines.push("  system            | label    | common | uncommon |  rare  | exotic | mean yield x | vs today | expected net, standard");
  for (const s of m.systems) {
    lines.push(`  ${s.name.padEnd(17)} | ${s.label.padEnd(8)} | ${pct(s.dist.common).padStart(6)} | ${pct(s.dist.uncommon).padStart(8)} | ${pct(s.dist.rare).padStart(6)} | ${pct(s.dist.exotic).padStart(6)} | ${s.expectedMult.toFixed(3).padStart(12)} | ${((s.change >= 0 ? "+" : "") + pct(s.change)).padStart(8)} | ${fmt(s.expectedNet)}`);
  }
  lines.push("");
  lines.push(`Respawn: ${pct(m.design.respawnChancePerHour, 0)} each hour on the hour; mean wait ${fmt(m.respawn.meanWaitHours, 1)} h; still empty after 12 h ${pct(m.respawn.emptyAfter12h)}, after 24 h ${pct(m.respawn.emptyAfter24h, 2)}.`);
  lines.push("");
  lines.push(`A common belt, mined by N corporations at ${m.design.ladderExpeditionsPerDay} standard expeditions a day each:`);
  for (const p of m.population) {
    lines.push(`  N = ${String(p.corporations).padStart(2)}: lasts ${fmt(p.lifeHours, 1)} h (${fmt(p.lifeHours / 24, 1)} days); its slot is empty ${pct(p.emptyShare)} of the time; ${fmt(p.respawnsPerYear)} respawns a year, in Sol ${fmt(p.solExoticPerYear, 1)} of them exotic`);
  }
  lines.push("");
  lines.push(`A lone corporation on the ladder (a check-in every ${m.design.ladderCheckInHours} h): ${fmt(m.ladder.launchesPerBelt)} launches per belt, ${fmt(m.ladder.lostPerBelt, 3)} lost waiting for the next, ${pct(m.ladder.lostShare, 2)} of its launches.`);
  lines.push("A model, not play: perfect play, one belt per system, every unit a standing order buys sold at its base bid.");
  return lines.join("\n");
}

export function beltModelText() {
  return renderBeltModel(computeBeltModel(readJson("data/economy.json"), (readJson("data/systems.json").systems || readJson("data/systems.json"))));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(beltModelText());
}
