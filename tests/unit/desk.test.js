import { describe, it, expect } from "vitest";
import { ECONOMY, npcBidFor } from "../../server/economy.js";
import { SYSTEMS_DATA } from "../../server/game/catalog.js";
import { ensureBeltState, spawnBelt, BELT_SLOTS } from "../../server/game/belts.js";
import fs from "node:fs";
import { AUDIT_CLAUSES, DESK_TIERS, deskRng, generateAudit, generateDispatch, generateSurvey, gradeAudit, gradeDispatch, gradeSurvey, surveySubjects } from "../../server/game/desk.js";
import { bidQuotaFor, bidRuleFor } from "../../server/game/world.js";
import { transferFee, transitTime } from "../../server/transfers.js";
import { getEffectiveExchangeTaxRate } from "../../server/game/progression.js";
import { maxUpgradeTierOf } from "../../server/upgrades.js";
import { EMPLOYEES_PER_LEASE } from "../../public/scripts/leaseStaffing.js";
import { leaseHasRoom } from "../../public/scripts/leaseSlots.js";
import { nextYardPrice } from "../../public/scripts/yardPrice.js";

const readData = (name) => JSON.parse(fs.readFileSync(new URL(`../../data/${name}`, import.meta.url), "utf8"));
const WARFARE_DATA = readData("warfare.json");
const CONGLOMERATE_DATA = readData("conglomerates.json");

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

// AB#4689 slice 2: the Audit generator and grader (docs/design/desk-work.md section 5, Audit).

const AUDIT_FIELDS = { 1: 3, 2: 6, 3: 10 };

/** The answer the key says is right. */
function rightAudit(key) {
  if (!key.broken.length) return { compliant: true };
  return { clauses: key.broken.map((b) => b.clause), figures: Object.fromEntries(key.broken.filter((b) => b.figure !== null).map((b) => [b.clause, b.figure])) };
}

/** Every wrong answer a filing offers: certifying a broken one, a wrong, missing or extra clause, a figure a step off. */
function wrongAudits(packet, key) {
  const brokenNames = key.broken.map((b) => b.clause);
  const others = packet.options.filter((c) => !brokenNames.includes(c));
  if (!brokenNames.length) return others.map((c) => ({ clauses: [c], figures: { [c]: 1 } }));
  const right = rightAudit(key);
  const out = [{ compliant: true }];
  for (const c of others) {
    out.push({ ...right, clauses: [...right.clauses, c] });
    for (let i = 0; i < brokenNames.length; i += 1) out.push({ clauses: brokenNames.map((b, j) => (j === i ? c : b)), figures: { ...right.figures, [c]: 1 } });
  }
  if (brokenNames.length === 2) for (const b of brokenNames) out.push({ ...right, clauses: [b] });
  if (key.figures) {
    for (const b of key.broken.filter((x) => x.figure !== null)) {
      const step = Number.isInteger(b.figure) ? 1 : 0.01;
      for (const d of [-step, step]) out.push({ ...right, figures: { ...right.figures, [b.clause]: b.figure + d } });
      const { [b.clause]: _gone, ...without } = right.figures;
      out.push({ ...right, figures: without });
    }
  }
  return out;
}

describe("generateAudit", () => {
  it("yields the same filing and key twice from the same seed, at every tier", () => {
    for (const tier of DESK_TIERS) {
      const once = generateAudit({ seed: "corp-7:3", tier });
      expect(generateAudit({ seed: "corp-7:3", tier })).toEqual(once);
      expect(new Set(Array.from({ length: 20 }, (_, i) => generateAudit({ seed: i, tier }).packet.ref)).size).toBeGreaterThan(1);
    }
  });

  for (const tier of DESK_TIERS) {
    it(`tier ${tier}: across ${DRAWS} seeds, the stored answer grades correct and every distractor grades incorrect`, () => {
      let wrongs = 0;
      for (let seed = 0; seed < DRAWS; seed += 1) {
        const { packet, key } = generateAudit({ seed, tier });
        expect(packet.fields).toHaveLength(AUDIT_FIELDS[tier]);
        expect(gradeAudit(key, rightAudit(key)).correct, `seed ${seed}`).toBe(true);
        for (const wrong of wrongAudits(packet, key)) {
          expect(gradeAudit(key, wrong).correct, `seed ${seed}: ${JSON.stringify(wrong)}`).toBe(false);
          wrongs += 1;
        }
      }
      expect(wrongs).toBeGreaterThan(DRAWS);
    });
  }

  it("leaves auditCleanSharePct of filings compliant, and at tier 3 breaks two clauses in auditTwoClauseSharePct of the rest", () => {
    for (const tier of DESK_TIERS) {
      const keys = Array.from({ length: DRAWS }, (_, seed) => generateAudit({ seed, tier }).key);
      const clean = keys.filter((k) => !k.broken.length).length / DRAWS;
      expect(Math.abs(clean * 100 - ECONOMY.desk.auditCleanSharePct)).toBeLessThan(5);
      const broken = keys.filter((k) => k.broken.length);
      const two = broken.filter((k) => k.broken.length === 2).length / broken.length;
      if (tier < 3) expect(two).toBe(0);
      else expect(Math.abs(two * 100 - ECONOMY.desk.auditTwoClauseSharePct)).toBeLessThan(6);
    }
  });

  it("draws clauses only from its tier and lower, lists them in one fixed order, and sends no key", () => {
    const order = Object.keys(AUDIT_CLAUSES);
    for (const tier of DESK_TIERS) {
      for (let seed = 0; seed < 200; seed += 1) {
        const { packet } = generateAudit({ seed, tier });
        const kinds = packet.fields.map((f) => f.clause);
        for (const k of kinds) expect(AUDIT_CLAUSES[k].tier).toBeLessThanOrEqual(tier);
        expect(kinds).toEqual(order.filter((k) => kinds.includes(k)));
        for (const field of ["broken", "rules", "figures", "key"]) expect(packet).not.toHaveProperty(field);
        expect(JSON.stringify(packet)).not.toMatch(/"(compliant|figure|rule)"/);
      }
    }
  });
});

describe("every Audit clause is a rule the server enforces, decided by the server's own code", () => {
  const SERVER_RULE = {
    "lease-headcount": (f) => f.employees >= EMPLOYEES_PER_LEASE * (f.leasesHeld + 1), // POST purchase-lease, insufficient-employees
    "office-before-lease": (f) => f.office === "active", // POST purchase-lease, no-office
    "lease-slots": (f) => leaseHasRoom({ buildingSlots: 2, extractorIds: Array(f.buildingsOnLease).fill("y") }), // purchase-lease writes buildingSlots: 2
    "lease-price": (f) => f.declaredPrice === SYSTEMS_DATA.find((s) => s.name === f.system).bodies.find((b) => b.name === f.body).leaseCost,
    "itc-line": (f) => f.unitPrice >= (f.normalValue * WARFARE_DATA.dumping.priceThresholdPct) / 100, // itcService's dumping assessment
    "lease-royalty": (f) => f.declaredTax === Math.round((f.gross * getEffectiveExchangeTaxRate({ corp: { miningLeases: Array(f.leasesHeld).fill({}) } })) / 100),
    "order-quota": (f) => f.soldToday + f.units <= bidQuotaFor(f.item), // the standing bid's remainingQty
    "yard-price": (f) => f.declaredPrice === nextYardPrice(f.yardsOwned, ECONOMY.buildings),
    "upgrade-tier": (f) => f.requestedTier <= maxUpgradeTierOf({ unlocks: { maxUpgradeTier: f.maxUpgradeTier } }), // upgrades.js level-too-low
    deployments: (f) => f.activeExpeditions < f.maxDeployments, // the asteroids route's deployment-cap
    "conglomerate-cap": (f) => f.members < CONGLOMERATE_DATA.levels[f.level - 1].maxMembers // membership.js conglomerate-full
  };

  it("covers the eleven clauses the design names", () => {
    expect(Object.keys(AUDIT_CLAUSES).sort()).toEqual(Object.keys(SERVER_RULE).sort());
  });

  for (const clause of Object.keys(SERVER_RULE)) {
    it(`${clause}: every role it is drawn in agrees with the server's rule, and its rule is one sentence with its number`, () => {
      const c = AUDIT_CLAUSES[clause];
      const rng = deskRng(`clause:${clause}`);
      for (const role of ["broken", "clean", ...(c.near ? ["near"] : [])]) {
        for (let i = 0; i < 300; i += 1) {
          const facts = c.draw(rng, role);
          expect(SERVER_RULE[clause](facts), `${role}: ${JSON.stringify(facts)}`).toBe(role !== "broken");
          const { compliant, figure } = c.judge(facts);
          expect(compliant).toBe(role !== "broken");
          const rule = c.rule(facts);
          expect(rule).not.toMatch(/\.\s+[A-Z]/);
          if (figure !== null) expect(rule).toContain(String(figure));
        }
      }
    });
  }
});

describe("gradeAudit", () => {
  it("fails closed on anything malformed", () => {
    let broken, clean;
    for (let seed = 0; !(broken && clean); seed += 1) {
      const { key } = generateAudit({ seed, tier: 2 });
      if (key.broken.length && key.broken[0].figure !== null) broken ||= key;
      else if (!key.broken.length) clean ||= key;
    }
    const right = rightAudit(broken);
    for (const [key, answer] of [
      [broken, null], [broken, {}], [broken, { clauses: [] }], [broken, { ...right, clauses: right.clauses[0] }],
      [broken, { ...right, clauses: [...right.clauses, ...right.clauses] }], [broken, { ...right, clauses: [7] }],
      [null, right], [{ ...broken, kind: "survey" }, right],
      [clean, { compliant: "true" }], [clean, { compliant: true, clauses: ["lease-price"] }], [clean, {}]
    ]) expect(gradeAudit(key, answer).correct, JSON.stringify(answer)).toBe(false);
    for (const bad of ["12", Number.NaN, Infinity, null]) expect(gradeAudit(broken, { ...right, figures: { [right.clauses[0]]: bad } }).correct).toBe(false);
  });

  it("quotes the broken rule, right or wrong, and the rule of a clause wrongly named", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const { packet, key } = generateAudit({ seed, tier: 3 });
      const right = gradeAudit(key, rightAudit(key)).explanation;
      for (const b of key.broken) expect(right).toContain(b.rule);
      const innocent = packet.options.find((c) => !key.broken.some((b) => b.clause === c));
      const wrong = gradeAudit(key, { clauses: [innocent] });
      expect(wrong.correct).toBe(false);
      expect(wrong.explanation).toContain(key.rules[innocent]);
    }
  });
});

// AB#4689 slice 3: the Dispatch generator and grader (docs/design/desk-work.md section 5, Dispatch).

const TOL = ECONOMY.desk.dispatchTolerancePct;
const rightDispatch = (key) => (key.tier === 1 ? { transferFee: key.transferFee, transitMinutes: key.transitMinutes } : { take: { ...key.best }, ...(key.tier === 3 ? { margin: key.margin } : {}) });
const fillBy = (lots, quantity, costOf) => {
  const take = {};
  let left = quantity;
  for (const lot of [...lots].sort((a, b) => costOf(a) - costOf(b))) {
    const n = Math.min(left, lot.available);
    if (n > 0) { take[lot.id] = n; left -= n; }
  }
  return take;
};

describe("generateDispatch", () => {
  it("yields the same packet and key twice from the same seed, at every tier, and always has one to give", () => {
    for (const tier of DESK_TIERS) {
      const once = generateDispatch({ seed: "corp-7:9", tier });
      expect(generateDispatch({ seed: "corp-7:9", tier })).toEqual(once);
      for (let seed = 0; seed < DRAWS; seed += 1) expect(generateDispatch({ seed, tier }), `tier ${tier} seed ${seed}`).not.toBeNull();
    }
  });

  it("tier 1: the figures are the Logistics tab's own fee and transit, graded within the tolerance at both edges", () => {
    for (let seed = 0; seed < DRAWS; seed += 1) {
      const { packet, key } = generateDispatch({ seed, tier: 1 });
      expect(key.transferFee).toBe(transferFee(packet.from.id, packet.to.id, packet.quantity));
      expect(key.transitMinutes).toBe(transitTime(packet.from.id, packet.to.id));
      const right = rightDispatch(key);
      expect(gradeDispatch(key, right).correct).toBe(true);
      for (const field of ["transferFee", "transitMinutes"]) {
        const edge = (key[field] * TOL) / 100;
        expect(gradeDispatch(key, { ...right, [field]: key[field] + edge }).correct).toBe(true);
        expect(gradeDispatch(key, { ...right, [field]: key[field] - edge }).correct).toBe(true);
        expect(gradeDispatch(key, { ...right, [field]: key[field] + edge + 1 }).correct, `${field} over`).toBe(false);
        expect(gradeDispatch(key, { ...right, [field]: key[field] - edge - 1 }).correct, `${field} under`).toBe(false);
      }
    }
  });

  it("tier 2: across 1000 seeds the cheapest delivered fill is correct, and the cheapest sticker fill, a short or overdrawn fill are not", () => {
    for (let seed = 0; seed < DRAWS; seed += 1) {
      const { packet, key } = generateDispatch({ seed, tier: 2 });
      for (const lot of packet.lots) expect(key.lots.find((l) => l.id === lot.id).unitCost).toBe(lot.unitPrice + transferFee(lot.station.id, packet.at.id, 1));
      expect(gradeDispatch(key, rightDispatch(key)).correct, `seed ${seed}`).toBe(true);
      expect(gradeDispatch(key, { take: fillBy(packet.lots, packet.quantity, (l) => l.unitPrice) }).correct, `seed ${seed}: sticker`).toBe(false);
      const [first] = Object.keys(key.best);
      expect(gradeDispatch(key, { take: { ...key.best, [first]: key.best[first] - 1 } }).correct).toBe(false);
      const lot = packet.lots[0];
      expect(gradeDispatch(key, { take: { [lot.id]: lot.available + 1 } }).correct).toBe(false);
    }
  });

  it("tier 3: across 1000 seeds the deadline fill and its margin are correct; the fill that misses the deadline and a margin past the tolerance are not", () => {
    for (let seed = 0; seed < DRAWS; seed += 1) {
      const { packet, key } = generateDispatch({ seed, tier: 3 });
      expect(key.bid).toBe(npcBidFor(packet.standingBid.basePrice, packet.standingBid.soldToday, bidRuleFor({ item: packet.item })));
      expect(key.margin).toBe(packet.quantity * key.bid - key.minCost);
      const right = rightDispatch(key);
      expect(gradeDispatch(key, right).correct, `seed ${seed}`).toBe(true);
      const late = packet.lots.filter((l) => l.transitMinutes > packet.dueInHours * 60);
      expect(late.length).toBeGreaterThan(0);
      const unbounded = fillBy(key.lots, packet.quantity, (l) => l.unitCost);
      expect(late.some((l) => unbounded[l.id] > 0)).toBe(true);
      expect(gradeDispatch(key, { ...right, take: unbounded }).correct, `seed ${seed}: misses the deadline`).toBe(false);
      const edge = (Math.abs(key.margin) * TOL) / 100;
      expect(gradeDispatch(key, { ...right, margin: key.margin + edge }).correct).toBe(true);
      expect(gradeDispatch(key, { ...right, margin: key.margin - edge }).correct).toBe(true);
      expect(gradeDispatch(key, { ...right, margin: key.margin + edge + 1 }).correct).toBe(false);
      expect(gradeDispatch(key, { ...right, margin: key.margin - edge - 1 }).correct).toBe(false);
    }
  });

  it("sends no key: no delivered costs, cheapest fill, bid or margin in the packet", () => {
    for (const tier of DESK_TIERS) {
      for (let seed = 0; seed < 100; seed += 1) {
        const { packet } = generateDispatch({ seed, tier });
        expect(JSON.stringify(packet)).not.toMatch(/"(unitCost|minCost|best|margin|bid|transferFee)"/);
      }
    }
  });

  it("fails closed on anything malformed", () => {
    const t1 = generateDispatch({ seed: 1, tier: 1 }).key;
    const t3 = generateDispatch({ seed: 1, tier: 3 }).key;
    const right = rightDispatch(t3);
    const [first] = Object.keys(t3.best);
    for (const [key, answer] of [
      [t1, null], [t1, {}], [t1, { transferFee: String(t1.transferFee), transitMinutes: t1.transitMinutes }], [t1, { transferFee: t1.transferFee, transitMinutes: Number.NaN }],
      [null, rightDispatch(t1)], [{ ...t1, kind: "audit" }, rightDispatch(t1)],
      [t3, { ...right, take: null }], [t3, { ...right, take: [] }], [t3, { ...right, take: { ...t3.best, L99: 0 } }],
      [t3, { ...right, take: { ...t3.best, [first]: t3.best[first] - 0.5, ...{} } }], [t3, { ...right, margin: String(right.margin) }], [t3, { take: t3.best }]
    ]) expect(gradeDispatch(key, answer).correct, JSON.stringify(answer)).toBe(false);
  });
});
