import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { GONE, MAX_ROUNDS, NEUTRAL_MODIFIERS, counterMultiplier, hitFraction, resolveBattle } from "../../server/game/combat.js";
import { UNITS, UNIT_IDS } from "../../server/game/units.js";
import * as model from "../../scripts/combat-model.mjs";

// ISP-168 (AB#862): the resolver of docs/design/v0.10-combat.md section 4. The design's tables are read from the
// document itself, so the document, the reference calculator (scripts/combat-model.mjs) and the server cannot drift.

const root = path.resolve(import.meta.dirname, "..", "..");
const DOC = fs.readFileSync(path.join(root, "docs/design/v0.10-combat.md"), "utf8").split(/\r?\n/);
/** The markdown table whose header row starts with `header`, as rows of trimmed cells. */
function docTable(header) {
  const at = DOC.findIndex((l) => l.startsWith(header));
  const rows = [];
  for (const line of DOC.slice(at + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(line.split("|").slice(1, -1).map((c) => c.replace(/\*\*/g, "").trim()));
  }
  return rows;
}
const BUDGETS = [30000, 120000, 480000];
const num = (s) => Number(String(s).replace(/,/g, ""));

/** The exchange from the attacker's side, through the server's resolver: value destroyed per credit lost. */
function exchange(a, d) {
  const r = resolveBattle(a, d);
  const lostA = model.worth(a) - model.worth(r.survivors.attacker), lostD = model.worth(d) - model.worth(r.survivors.defender);
  return { ...r, ratio: lostA ? lostD / lostA : Infinity };
}
const best = (enemy, B, asAttacker) => model.candidates(!asAttacker ? false : true)
  .map((c) => ({ c, e: asAttacker ? exchange(model.mix(c.shares, B), model.mix(enemy, B)) : exchange(model.mix(enemy, B), model.mix(c.shares, B)) }))
  .sort((x, y) => (asAttacker ? y.e.ratio - x.e.ratio : x.e.ratio - y.e.ratio))[0];

afterEach(() => vi.restoreAllMocks());

describe("resolveBattle is pure (AB#862)", () => {
  it("reads no clock and rolls no dice, changes neither force, and fights the same battle every time", () => {
    const now = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("read the clock"); });
    const dice = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("rolled a die"); });
    const a = { ds: 6, at: 12 }, d = { lf: 14, dt: 10 };
    const first = resolveBattle(a, d);
    expect(resolveBattle(a, d)).toEqual(first);
    expect(a).toEqual({ ds: 6, at: 12 });
    expect(d).toEqual({ lf: 14, dt: 10 });
    expect(now).not.toHaveBeenCalled();
    expect(dice).not.toHaveBeenCalled();
  });

  it("imports nothing but the unit catalog, and touches no file, clock, timer or store", () => {
    const src = fs.readFileSync(path.join(root, "server/game/combat.js"), "utf8");
    expect([...src.matchAll(/^import .* from "(.+)";/gm)].map((m) => m[1])).toEqual(["./units.js"]);
    expect(src).not.toMatch(/Date\.|Math\.random|setTimeout|setInterval|process\.|fs\./);
  });

  it("returns survivors per side, a log per round and a winner", () => {
    const r = resolveBattle({ lf: 20 }, { lf: 10 });
    expect(r.winner).toBe("attacker");
    expect(Object.keys(r.survivors.attacker)).toEqual(UNIT_IDS);
    expect(r.rounds[0]).toMatchObject({ round: 1, attacker: { lost: expect.any(Object), remaining: expect.any(Object) }, defender: { lost: expect.any(Object), remaining: expect.any(Object) } });
  });
});

describe("the counters (AB#862)", () => {
  it("is the design's matrix: 2 against prey, 0.5 against a predator, 1 otherwise", () => {
    const rows = docTable("| shooter \\ target |");
    expect(rows.map((r) => r[0])).toEqual(UNIT_IDS);
    for (const [s, ...cells] of rows) cells.forEach((cell, i) => expect(counterMultiplier(s, UNIT_IDS[i]), `${s} on ${UNIT_IDS[i]}`).toBe(Number(cell)));
  });

  it("an equal-cost force of each unit's counter beats it, attacking or defending, at every budget", () => {
    for (const B of BUDGETS) {
      for (const prey of UNIT_IDS) {
        const hunter = UNIT_IDS.find((id) => UNITS[id].strongAgainst === prey);
        expect(resolveBattle({ [hunter]: model.buy(hunter, B) }, { [prey]: model.buy(prey, B) }).winner, `${hunter} attacks ${prey} at ${B}`).toBe("attacker");
        expect(resolveBattle({ [prey]: model.buy(prey, B) }, { [hunter]: model.buy(hunter, B) }).winner, `${prey} attacks ${hunter} at ${B}`).toBe("defender");
      }
    }
  });

  it("reproduces the design's best-response table: a different answer to every pure composition, at three budgets", () => {
    const rows = docTable("| Budget | Enemy is pure |");
    expect(rows).toHaveLength(15);
    let budget;
    for (const [b, enemy, att, attRatio, def, defRatio] of rows) {
      budget = b ? num(b) : budget;
      const a = best({ [enemy]: 1 }, budget, true), d = best({ [enemy]: 1 }, budget, false);
      expect(a.c.label, `attack on ${enemy} at ${budget}`).toBe(att);
      expect(a.e.ratio.toFixed(2), `attack on ${enemy} at ${budget}`).toBe(attRatio);
      expect(d.c.label, `defence against ${enemy} at ${budget}`).toBe(def);
      expect(d.e.ratio.toFixed(2), `defence against ${enemy} at ${budget}`).toBe(defRatio);
    }
    for (const B of BUDGETS) {
      const answers = rows.filter((r, i) => num(rows[i - (i % 5)][0]) === B).map((r) => r[2]);
      expect(new Set(answers).size, `five different answers at ${B}`).toBe(5);
    }
  });

  it("reproduces the pure-against-pure table at 120,000", () => {
    const rows = docTable("| attacker \\ defender |");
    expect(rows.map((r) => r[0])).toEqual(UNIT_IDS);
    for (const [attacker, ...cells] of rows) {
      cells.forEach((cell, i) => {
        const defender = UNIT_IDS[i];
        const e = exchange({ [attacker]: model.buy(attacker, 120000) }, { [defender]: model.buy(defender, 120000) });
        expect(`${e.winner} ${e.ratio.toFixed(2)}`, `${attacker} on ${defender}`).toBe(cell);
      });
    }
  });

  it("agrees with the reference calculator on every pairing of the fifteen candidates", () => {
    const all = model.candidates(false);
    for (const a of all) for (const d of all) {
      const A = model.mix(a.shares, 120000), D = model.mix(d.shares, 120000);
      const ours = resolveBattle(A, D), ref = model.resolve(A, D);
      expect([ours.winner, ours.survivors], `${a.label} on ${d.label}`).toEqual([ref.winner, { attacker: ref.attacker, defender: ref.defender }]);
    }
  });
});

describe("the design's worked battle (AB#862)", () => {
  const r = resolveBattle({ ds: 6, at: 12 }, { lf: 14, dt: 10 });

  it("has round 1's hand-worked losses to two decimals", () => {
    const [one] = r.rounds;
    expect(one.defender.lost.lf.toFixed(2)).toBe("3.80"); // 152.16 damage / 40 hp
    expect(one.defender.lost.dt.toFixed(2)).toBe("1.70"); // 68.13 / 40
    expect(one.attacker.lost.ds.toFixed(2)).toBe("0.18"); // 36.39 / 200
    expect(one.attacker.lost.at.toFixed(2)).toBe("4.28"); // 128.44 / 30
  });

  it("matches every round of the document's table, and the attacker wins keeping 5 destroyers and 2 attack troops", () => {
    const rows = docTable("| Round | Destroyers |").filter((row) => row[0] !== "start");
    expect(r.rounds).toHaveLength(rows.length);
    const left = (cell) => Number(cell.split(" ")[0]);
    rows.forEach(([round, ds, at, lf, dt], i) => {
      const got = r.rounds[i];
      expect(got.round).toBe(Number(round));
      expect(got.attacker.remaining.ds.toFixed(2), `round ${round} ds`).toBe(left(ds).toFixed(2));
      expect(got.attacker.remaining.at.toFixed(2), `round ${round} at`).toBe(left(at).toFixed(2));
      expect(got.defender.remaining.lf.toFixed(2), `round ${round} lf`).toBe(left(lf).toFixed(2));
      expect(got.defender.remaining.dt.toFixed(2), `round ${round} dt`).toBe(left(dt).toFixed(2));
    });
    expect(r.winner).toBe("attacker");
    expect(r.survivors.attacker).toMatchObject({ ds: 5, at: 2 });
    expect(Object.values(r.survivors.defender).every((n) => n === 0)).toBe(true);
  });

  it("is a draw with 15 defense troops instead of 10, as the document says", () => {
    const draw = resolveBattle({ ds: 6, at: 12 }, { lf: 14, dt: 15 });
    expect(draw.winner).toBe("draw");
    expect(draw.survivors.attacker.ds).toBe(4);
    expect(draw.survivors.defender).toMatchObject({ lf: 1, dt: 4 });
  });
});

describe("the rules around the arithmetic (AB#862)", () => {
  it("takes accuracy and evasion as inputs, neutral unless given (ISP-169 sets them from research and CEO skills)", () => {
    const a = { lf: 30 }, d = { ds: 10 };
    expect(resolveBattle(a, d)).toEqual(resolveBattle(a, d, { attacker: NEUTRAL_MODIFIERS, defender: NEUTRAL_MODIFIERS }));
    const sharper = resolveBattle(a, d, { attacker: { accuracy: 1.3 } });
    const plain = resolveBattle(a, d);
    expect(sharper.exact.defender.ds).toBeLessThan(plain.exact.defender.ds);
    expect(hitFraction(10, 10)).toBe(0.5);
  });

  it("gives the document's readiness example: 10 destroyers against 10 at 60% attack and accuracy draw, 8 against 4", () => {
    const r = resolveBattle({ ds: 10 }, { ds: 10 }, { defender: { attack: 0.6, accuracy: 0.6 } });
    expect(r.winner).toBe("draw");
    expect(r.survivors).toMatchObject({ attacker: { ds: 8 }, defender: { ds: 4 } });
  });

  it("stops after six rounds, and a type below half a unit is gone", () => {
    const r = resolveBattle({ ds: 40 }, { ds: 40 });
    expect(r.rounds).toHaveLength(MAX_ROUNDS);
    expect(r.winner).toBe("draw");
    for (const round of r.rounds) for (const side of ["attacker", "defender"]) {
      for (const n of Object.values(round[side].remaining)) expect(n === 0 || n >= GONE).toBe(true);
    }
  });

  it("gives an empty side's opponent the field without a round, and two empty sides a draw", () => {
    expect(resolveBattle({}, { dt: 3 })).toMatchObject({ winner: "defender", rounds: [] });
    expect(resolveBattle({ lf: 1 }, {})).toMatchObject({ winner: "attacker", rounds: [] });
    expect(resolveBattle({}, {}).winner).toBe("draw");
  });

  it("refuses a unit the catalog lacks, a negative or non-numeric count, and a modifier that is not a positive number", () => {
    expect(() => resolveBattle({ battleship: 1 }, { lf: 1 })).toThrow(/"battleship" is not a unit/);
    expect(() => resolveBattle({ lf: -1 }, { lf: 1 })).toThrow(/at least 0/);
    expect(() => resolveBattle({ lf: "3" }, { lf: 1 })).toThrow(/at least 0/);
    expect(() => resolveBattle({ lf: 1 }, { lf: 1 }, { defender: { evasion: 0 } })).toThrow(/above 0/);
  });
});
