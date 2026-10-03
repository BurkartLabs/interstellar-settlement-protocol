import { describe, it, expect } from "vitest";
import { ECONOMY } from "../../server/economy.js";
import { SYSTEMS_DATA } from "../../server/game/catalog.js";
import { ensureBeltState, spawnBelt, BELT_SLOTS } from "../../server/game/belts.js";
import { DESK_TIERS, deskRng, generateSurvey, gradeSurvey, surveySubjects } from "../../server/game/desk.js";

// AB#4689 slice 1: the desk block and the Survey generator and grader (docs/design/desk-work.md sections 3 and 5).

const DRAWS = 1000;
const freshBelts = () => ensureBeltState({}, 0).belts;
const PROXIMA = { unlockedTech: ["tt-proxima-navigation"], currentSystemId: "sol" };
const systemOf = (id) => SYSTEMS_DATA.find((s) => s.id === id);

/** The answer the key says is right. */
function rightAnswer(key) {
  if (key.tier === 1) return { pick: key.truth[0].resource };
  const ranking = key.truth.map((t) => t.resource);
  return key.tier === 2 ? { ranking } : { ranking, rarity: key.rarity, reserve: key.remaining };
}

/** Every wrong answer a packet offers: each other pick, every other order of the true three, every option in every place. */
function wrongAnswers(packet, key) {
  const right = rightAnswer(key);
  if (key.tier === 1) return packet.options.filter((o) => o !== right.pick).map((o) => ({ pick: o }));
  const [a, b, c] = right.ranking;
  const orders = [[a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
  const swaps = [0, 1, 2].flatMap((i) => packet.options.filter((o) => o !== right.ranking[i]).map((o) => right.ranking.map((r, j) => (j === i ? o : r))));
  const rankings = [...orders, ...swaps].map((ranking) => ({ ...right, ranking }));
  if (key.tier === 2) return rankings;
  return [...rankings, ...packet.rarityOptions.filter((r) => r !== key.rarity).map((rarity) => ({ ...right, rarity }))];
}

describe("the desk block in data/economy.json", () => {
  it("has one pay, one points value and one noise level per tier", () => {
    for (const k of ["payByTier", "pointsByTier", "surveyNoisePctByTier"]) expect(ECONOMY.desk[k]).toHaveLength(DESK_TIERS.length);
  });
});

describe("deskRng", () => {
  it("gives the same sequence for the same seed, and a different one for another", () => {
    const run = (seed) => { const r = deskRng(seed); return [r(), r(), r()]; };
    expect(run("corp-1:4")).toEqual(run("corp-1:4"));
    expect(run("corp-1:4")).not.toEqual(run("corp-1:5"));
    for (const v of run(42)) expect(v >= 0 && v < 1).toBe(true);
  });
});

describe("generateSurvey", () => {
  it("yields the same packet and key twice from the same seed and data, at every tier", () => {
    const belts = freshBelts();
    for (const tier of DESK_TIERS) {
      const once = generateSurvey({ seed: "corp-7:12", tier, corp: PROXIMA, belts });
      expect(once).not.toBeNull();
      expect(generateSurvey({ seed: "corp-7:12", tier, corp: PROXIMA, belts })).toEqual(once);
      const others = new Set(Array.from({ length: 20 }, (_, i) => generateSurvey({ seed: i, tier, corp: PROXIMA, belts }).packet.ref));
      expect(others.size).toBeGreaterThan(1);
    }
  });

  for (const tier of DESK_TIERS) {
    it(`tier ${tier}: across ${DRAWS} seeds, the stored answer grades correct and every distractor grades incorrect`, () => {
      const belts = freshBelts();
      let wrongs = 0;
      for (let seed = 0; seed < DRAWS; seed += 1) {
        const { packet, key } = generateSurvey({ seed, tier, corp: PROXIMA, belts });
        expect(gradeSurvey(key, rightAnswer(key)).correct, `seed ${seed}`).toBe(true);
        for (const wrong of wrongAnswers(packet, key)) {
          expect(gradeSurvey(key, wrong).correct, `seed ${seed}: ${JSON.stringify(wrong)}`).toBe(false);
          wrongs += 1;
        }
        for (const d of key.distractors) {
          expect(packet.options).toContain(d);
          expect(key.truth.map((t) => t.resource)).not.toContain(d);
        }
        expect(key.distractors).toHaveLength([0, 1, 2][tier - 1]);
      }
      expect(wrongs).toBeGreaterThan(DRAWS);
    });
  }

  it("tier 3: a reserve estimate is right up to the tolerance on either side and wrong just past it", () => {
    const belts = freshBelts();
    for (let seed = 0; seed < 50; seed += 1) {
      const { key } = generateSurvey({ seed, tier: 3, corp: PROXIMA, belts });
      const edge = (key.remaining * ECONOMY.desk.surveyReserveTolerancePct) / 100;
      const at = (reserve) => gradeSurvey(key, { ...rightAnswer(key), reserve }).correct;
      expect(at(key.remaining + edge)).toBe(true);
      expect(at(key.remaining - edge)).toBe(true);
      expect(at(key.remaining + edge + 1)).toBe(false);
      expect(at(key.remaining - edge - 1)).toBe(false);
    }
  });

  it("never sends the key: the packet holds no truth, rarity, remaining reserve or distractor list", () => {
    const belts = freshBelts();
    for (const tier of DESK_TIERS) {
      for (let seed = 0; seed < 100; seed += 1) {
        const { packet } = generateSurvey({ seed, tier, corp: PROXIMA, belts });
        for (const field of ["truth", "rarity", "remaining", "distractors", "key"]) expect(packet).not.toHaveProperty(field);
        expect(JSON.stringify(packet)).not.toMatch(/"remaining"/);
      }
    }
  });

  it("lists every reading's resources alphabetically, so their order gives away neither the ranking nor the distractors", () => {
    const belts = freshBelts();
    for (const tier of DESK_TIERS) {
      for (let seed = 0; seed < 200; seed += 1) {
        const { packet } = generateSurvey({ seed, tier, corp: PROXIMA, belts });
        for (const reading of packet.readings) expect(Object.keys(reading)).toEqual(Object.keys(reading).sort());
        expect(packet.options).toEqual([...packet.options].sort());
      }
    }
  });

  it("only asks what the document shows: ordered by the readings (averaged at tier 3), the first places are the truth's", () => {
    const belts = freshBelts();
    for (const tier of DESK_TIERS) {
      for (let seed = 0; seed < 300; seed += 1) {
        const { packet, key } = generateSurvey({ seed, tier, corp: PROXIMA, belts });
        const mean = {};
        for (const r of packet.readings) for (const [res, v] of Object.entries(r)) mean[res] = (mean[res] || 0) + v / packet.readings.length;
        const ranked = Object.entries(mean).sort((a, b) => b[1] - a[1]).map(([res]) => res);
        expect(ranked.slice(0, key.truth.length)).toEqual(key.truth.map((t) => t.resource));
        if (tier === 3) {
          const avg = packet.reserveEstimates.reduce((s, v) => s + v, 0) / packet.reserveEstimates.length;
          expect(Math.abs(avg - key.remaining)).toBeLessThanOrEqual((key.remaining * ECONOMY.desk.surveyReserveTolerancePct) / 100);
        }
      }
    }
  });

  it("carries its tier's fee and points from the desk block", () => {
    const belts = freshBelts();
    for (const tier of DESK_TIERS) {
      const { packet } = generateSurvey({ seed: 1, tier, corp: PROXIMA, belts });
      expect(packet.fee).toBe(ECONOMY.desk.payByTier[tier - 1]);
      expect(packet.points).toBe(ECONOMY.desk.pointsByTier[tier - 1]);
    }
  });
});

describe("survey subjects (design section 5, the Survey table)", () => {
  it("tier 1 surveys Sol only", () => {
    const belts = freshBelts();
    for (let seed = 0; seed < DRAWS; seed += 1) expect(generateSurvey({ seed, tier: 1, corp: PROXIMA, belts }).packet.subject.systemId).toBe("sol");
  });

  it("tier 2 surveys only systems the corporation can reach", () => {
    const belts = freshBelts();
    const none = new Set(surveySubjects(2, { corp: { unlockedTech: [], currentSystemId: "sol" }, belts }).map((s) => s.systemId));
    expect([...none]).toEqual(["sol"]);
    const reachable = (id) => id === "sol" || systemOf(id).accessResearch === "tt-proxima-navigation";
    const seen = new Set();
    for (let seed = 0; seed < DRAWS; seed += 1) {
      const id = generateSurvey({ seed, tier: 2, corp: PROXIMA, belts }).packet.subject.systemId;
      expect(reachable(id), id).toBe(true);
      seen.add(id);
    }
    expect([...seen].some((id) => id !== "sol")).toBe(true);
  });

  it("tier 3 surveys rare or exotic belts, by the belt's live rarity, and only while the belt is there", () => {
    const belts = freshBelts();
    for (let seed = 0; seed < DRAWS; seed += 1) {
      const { packet, key } = generateSurvey({ seed, tier: 3, corp: PROXIMA, belts });
      expect(packet.subject.type).toBe("Field");
      expect(["rare", "exotic"]).toContain(belts[packet.subject.beltKey].rarity);
      expect(key.rarity).toBe(belts[packet.subject.beltKey].rarity);
    }
    // A common system's belt that respawned exotic is a subject; an exotic system's belt that was mined out is not.
    const sol = BELT_SLOTS.find((s) => s.key === "sol:belt");
    let rng = deskRng("respawn"), exotic;
    do exotic = spawnBelt(sol, 2, 0, rng); while (exotic.rarity !== "exotic");
    const exoticKey = BELT_SLOTS.find((s) => s.label === "exotic").key;
    const changed = { ...belts, "sol:belt": exotic, [exoticKey]: { ...belts[exoticKey], remaining: 0 } };
    const keys = surveySubjects(3, { corp: PROXIMA, belts: changed }).map((s) => s.belt.key);
    expect(keys).toContain("sol:belt");
    expect(keys).not.toContain(exoticKey);
  });

  it("has nothing to survey at tier 3 when every belt is mined out, and says so with null", () => {
    const empty = Object.fromEntries(Object.entries(freshBelts()).map(([k, b]) => [k, { ...b, remaining: 0 }]));
    expect(generateSurvey({ seed: 1, tier: 3, corp: PROXIMA, belts: empty })).toBeNull();
    expect(generateSurvey({ seed: 1, tier: 4, corp: PROXIMA, belts: freshBelts() })).toBeNull();
  });
});

describe("gradeSurvey fails closed", () => {
  it("grades anything malformed as incorrect", () => {
    const belts = freshBelts();
    const t1 = generateSurvey({ seed: 3, tier: 1, corp: PROXIMA, belts }).key;
    const t3 = generateSurvey({ seed: 3, tier: 3, corp: PROXIMA, belts }).key;
    const right3 = rightAnswer(t3);
    for (const [key, answer] of [
      [t1, null], [t1, {}], [t1, "pick"], [t1, { pick: [t1.truth[0].resource] }], [null, rightAnswer(t1)],
      [{ ...t1, kind: "audit" }, rightAnswer(t1)],
      [t3, { ...right3, ranking: [...right3.ranking, "Carbon"] }], [t3, { ...right3, ranking: right3.ranking.join(",") }],
      [t3, { ...right3, reserve: String(right3.reserve) }], [t3, { ...right3, reserve: Number.NaN }], [t3, { ...right3, rarity: undefined }]
    ]) expect(gradeSurvey(key, answer).correct).toBe(false);
  });

  it("explains every grade with the truth and the rule, right or wrong", () => {
    const belts = freshBelts();
    for (const tier of DESK_TIERS) {
      const { key } = generateSurvey({ seed: 5, tier, corp: PROXIMA, belts });
      const wrong = gradeSurvey(key, {}).explanation;
      expect(wrong).toBe(gradeSurvey(key, rightAnswer(key)).explanation);
      expect(wrong).toContain(key.truth[0].resource);
      expect(wrong).toMatch(/correct when/);
    }
  });
});
