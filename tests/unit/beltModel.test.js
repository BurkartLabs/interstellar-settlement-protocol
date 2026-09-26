import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_RULES, DESIGN, beltModelText, computeBeltModel, rarityDistribution, tierTemplates } from "../../scripts/belt-model.mjs";

// AB#1050: docs/design/belts.md quotes the belt model, and the model takes some of its rules from the code. This keeps
// the quote exactly what npm run belt:model prints, and each code rule what the source says, so the design's numbers
// cannot drift from the game quietly.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const doc = read("docs/design/belts.md");
const economy = JSON.parse(read("data/economy.json"));
const systemsFile = JSON.parse(read("data/systems.json"));
const systems = systemsFile.systems || systemsFile;
const asteroids = read("server/game/asteroids.js");

describe("docs/design/belts.md (AB#1050)", () => {
  it("quotes exactly what npm run belt:model prints", () => {
    const quoted = doc.match(/<!-- belt-model:start -->\n```text\n([\s\S]*?)\n```\n<!-- belt-model:end -->/)?.[1];
    expect(quoted).toBe(beltModelText().trimEnd());
  });

  it("names the three stories that build it, and says it is a model", () => {
    for (const id of ["AB#2329", "AB#2330", "AB#2331"]) expect(doc).toContain(id);
    expect(doc).toContain("A model, not play");
  });

  it("npm run belt:model is the script", () => {
    expect(JSON.parse(read("package.json")).scripts["belt:model"]).toBe("node scripts/belt-model.mjs");
  });
});

describe("the belt model reads the game, not a copy of it (AB#1050)", () => {
  it("the base yield, the rarity multipliers and the production durations are the code's", () => {
    expect(asteroids).toMatch(new RegExp(`const baseYieldPerMin = ${CODE_RULES.baseYieldPerMin.value};`));
    const m = CODE_RULES.rarityYieldMultiplier.value;
    expect(asteroids).toContain(`RARITY_YIELD_MULTIPLIER = { common: ${m.common.toFixed(1)}, uncommon: ${m.uncommon}, rare: ${m.rare}, exotic: ${m.exotic} }`);
    const h = CODE_RULES.expeditionHours.value;
    expect(asteroids).toContain(`ms: ${h.short * 60} * 60 * 1000, tickYieldMultiplier: 1`);
    expect(asteroids).toContain(`ms: ${h.standard * 60} * 60 * 1000, tickYieldMultiplier: 1`);
    expect(asteroids).toContain(`ms: ${h.extended} * 60 * 60 * 1000, tickYieldMultiplier: 1`);
  });
});

describe("the belt rules (AB#1050)", () => {
  it("a system's distribution sums to 1, peaks at its label and keeps every tier possible", () => {
    for (const label of DESIGN.tiers) {
      const d = rarityDistribution(label);
      expect(Object.values(d).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(Math.max(...Object.values(d))).toBe(d[label]);
      for (const t of DESIGN.tiers) expect(d[t]).toBeGreaterThan(0);
    }
    expect(rarityDistribution("common").exotic).toBeCloseTo(0.0118, 4); // an exotic belt in Sol: possible, rare
  });

  it("each tier's template comes from today's belts of that label and sums to 1", () => {
    const t = tierTemplates(systems);
    for (const tier of DESIGN.tiers) expect(Object.values(t[tier]).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(Object.keys(t.common).sort()).toEqual(Object.keys(systems.find((s) => s.id === "sol").bodies.find((b) => b.composition).composition).sort());
  });

  it("a belt holds the design's number of standard expeditions, and depletion costs a lone corporation under 1% of launches", () => {
    const m = computeBeltModel(economy, systems);
    const common = m.tiers.find((t) => t.tier === "common");
    expect(common.reserve).toBe(DESIGN.reserveStandardExpeditions * common.byDuration.standard.units);
    expect(m.respawn.meanWaitHours).toBe(5);
    expect(m.ladder.lostShare).toBeLessThan(0.01);
  });
});
