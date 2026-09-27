import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { EVASIVE_MANOEUVRES_TECH, FIRE_CONTROL_TECH, MODIFIER_CAP, NEUTRAL_MODIFIERS, combatModifiersFor, counterMultiplier, hitFraction, resolveBattle } from "../../server/game/combat.js";
import { UNITS, UNIT_IDS } from "../../server/game/units.js";
import * as model from "../../scripts/combat-model.mjs";

// ISP-169 (AB#863): accuracy and evasion, with research and the CEO's leadership, capped at +30% a stat
// (docs/design/v0.10-combat.md section 3). Every test here runs at values away from neutral (P-IDENTITY-BLIND):
// a multiplier of 1 would pass whether or not the modifier were applied at all.

const MAX = { accuracy: MODIFIER_CAP, evasion: MODIFIER_CAP };
const BUDGETS = [30000, 120000, 480000];
/** Round 1's damage on one defending type, by the design's formula, from the start-of-round counts. */
function formulaDamage(a, d, target, ma, md) {
  const total = Object.values(d).reduce((x, n) => x + n, 0);
  let dmg = 0;
  for (const [s, n] of Object.entries(a)) {
    dmg += n * UNITS[s].attack * (d[target] / total) * counterMultiplier(s, target) * hitFraction(UNITS[s].accuracy * ma.accuracy, UNITS[target].evasion * md.evasion);
  }
  return dmg;
}

describe("accuracy against evasion, away from neutral (AB#863)", () => {
  it("a high-evasion defender takes exactly the formula's reduced damage from a low-accuracy attacker", () => {
    const a = { se: 10 }, d = { ds: 10 };
    const low = { accuracy: 0.8, evasion: 1 }, high = { accuracy: 1, evasion: 1.3 };
    const r = resolveBattle(a, d, { attacker: low, defender: high });
    const expected = formulaDamage(a, d, "ds", low, high) / UNITS.ds.hp;
    expect(r.rounds[0].defender.lost.ds).toBeCloseTo(expected, 12);
    // 8 accuracy x 0.8 = 6.4 against 5 evasion x 1.3 = 6.5: under half of every shot lands, against 8/13 at neutral
    expect(hitFraction(6.4, 6.5)).toBeLessThan(0.5);
    expect(r.rounds[0].defender.lost.ds).toBeLessThan(resolveBattle(a, d).rounds[0].defender.lost.ds);
  });

  it("the reverse: a high-accuracy attacker lands the formula's extra damage on a low-evasion defender", () => {
    const a = { lf: 30 }, d = { se: 10 };
    const sharp = { accuracy: 1.3, evasion: 1 }, slow = { accuracy: 1, evasion: 0.7 };
    const r = resolveBattle(a, d, { attacker: sharp, defender: slow });
    expect(r.rounds[0].defender.lost.se).toBeCloseTo(formulaDamage(a, d, "se", sharp, slow) / UNITS.se.hp, 12);
    expect(r.rounds[0].defender.lost.se).toBeGreaterThan(resolveBattle(a, d).rounds[0].defender.lost.se);
  });

  it("makes a small accurate fleet a real alternative: 10 fighters at the cap outlast 11 without it", () => {
    const r = resolveBattle({ lf: 10 }, { lf: 11 }, { attacker: MAX });
    expect(r.exact.attacker.lf).toBeGreaterThan(r.exact.defender.lf);
    // and 15 is too many: a bonus is worth about a tenth more ships, never a counter's fivefold
    expect(resolveBattle({ lf: 10 }, { lf: 15 }, { attacker: MAX }).winner).toBe("defender");
  });

  it("at neutral reproduces v0.10-05's resolver exactly, battle for battle", () => {
    const all = model.candidates(false);
    for (const a of all) for (const d of all) {
      const A = model.mix(a.shares, 120000), D = model.mix(d.shares, 120000);
      const plain = resolveBattle(A, D);
      expect(resolveBattle(A, D, { attacker: combatModifiersFor({}), defender: combatModifiersFor({}) }), `${a.label} on ${d.label}`).toEqual(plain);
      const ref = model.resolve(A, D);
      expect([plain.winner, plain.survivors]).toEqual([ref.winner, { attacker: ref.attacker, defender: ref.defender }]);
    }
  });
});

describe("where the modifiers come from, and their cap (AB#863)", () => {
  it("reads research and the CEO's leadership from the corporation's own state", () => {
    expect(combatModifiersFor({})).toEqual(NEUTRAL_MODIFIERS);
    expect(combatModifiersFor({ unlockedTech: [FIRE_CONTROL_TECH] })).toEqual({ attack: 1, accuracy: 1.1, evasion: 1 });
    expect(combatModifiersFor({ unlockedTech: [EVASIVE_MANOEUVRES_TECH] })).toEqual({ attack: 1, accuracy: 1, evasion: 1.1 });
    const led = combatModifiersFor({ unlockedTech: [FIRE_CONTROL_TECH, EVASIVE_MANOEUVRES_TECH], military: { modifiers: { ceoLeadershipPct: 5 } } });
    expect(led.accuracy).toBeCloseTo(1.15, 12);
    expect(led.evasion).toBeCloseTo(1.15, 12);
  });

  it("holds an absurd leadership figure to the design's +30%, and counts a negative or junk one as nothing", () => {
    const absurd = combatModifiersFor({ unlockedTech: [FIRE_CONTROL_TECH], military: { modifiers: { ceoLeadershipPct: 5000 } } });
    expect(absurd).toEqual({ attack: 1, accuracy: MODIFIER_CAP, evasion: MODIFIER_CAP });
    expect(combatModifiersFor({ military: { modifiers: { ceoLeadershipPct: -80 } } })).toEqual(NEUTRAL_MODIFIERS);
    expect(combatModifiersFor({ military: { modifiers: { ceoLeadershipPct: "lots" } } })).toEqual(NEUTRAL_MODIFIERS);
  });

  it("caps a modifier passed straight to the resolver too, so no caller can go past +30%", () => {
    const a = { lf: 20 }, d = { lf: 20 };
    expect(resolveBattle(a, d, { attacker: { accuracy: 50, evasion: 50, attack: 50 } })).toEqual(resolveBattle(a, d, { attacker: { accuracy: MODIFIER_CAP, evasion: MODIFIER_CAP, attack: MODIFIER_CAP } }));
  });

  it("names the research it reads, and keeps both nodes planned until a battle can be fought", () => {
    const tree = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "..", "data", "research.json"), "utf8")).nodes;
    for (const [id, word] of [[FIRE_CONTROL_TECH, "accuracy"], [EVASIVE_MANOEUVRES_TECH, "evasion"]]) {
      const node = tree.find((n) => n.id === id);
      expect(node?.effect, id).toMatch(new RegExp(`^\\+10% ${word}`));
      expect(node.status).toBe("planned");
    }
  });
});

describe("no dominant composition at the maximum modifiers (AB#863)", () => {
  const best = (enemy, B, asAttacker, mods) => model.candidates(!asAttacker ? false : true)
    .map((c) => {
      const mine = model.mix(c.shares, B), theirs = model.mix(enemy, B);
      const [a, d] = asAttacker ? [mine, theirs] : [theirs, mine];
      const r = resolveBattle(a, d, mods);
      const lostA = model.worth(a) - model.worth(r.survivors.attacker), lostD = model.worth(d) - model.worth(r.survivors.defender);
      return { c, ratio: lostA ? lostD / lostA : Infinity };
    })
    .sort((x, y) => (asAttacker ? y.ratio - x.ratio : x.ratio - y.ratio))[0];

  it("each pure composition's counter is still its best answer when the composition has every bonus and the answer none", () => {
    for (const B of BUDGETS) {
      for (const prey of UNIT_IDS) {
        const hunter = UNIT_IDS.find((id) => UNITS[id].strongAgainst === prey);
        const att = best({ [prey]: 1 }, B, true, { defender: MAX });
        const def = best({ [prey]: 1 }, B, false, { attacker: MAX });
        expect(att.c.label, `attack a maxed ${prey} at ${B}`).toBe(hunter);
        expect(def.c.label, `defend against a maxed ${prey} at ${B}`).toBe(hunter);
        expect(att.ratio, `attack a maxed ${prey} at ${B}`).toBeGreaterThan(3);
      }
    }
  });

  it("and with both sides at the maximum, the design's table is unchanged: five different answers at every budget", () => {
    for (const B of BUDGETS) {
      const answers = UNIT_IDS.map((prey) => best({ [prey]: 1 }, B, true, { attacker: MAX, defender: MAX }).c.label);
      expect(answers, `at ${B}`).toEqual(UNIT_IDS.map((prey) => UNIT_IDS.find((id) => UNITS[id].strongAgainst === prey)));
    }
  });
});
