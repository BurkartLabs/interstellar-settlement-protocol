import { describe, it, expect } from "vitest";
import { AUDIT_CLAUSES, generateAudit, generateDispatch, generateSurvey, gradeAudit, gradeDispatch, gradeSurvey } from "../../server/game/desk.js";
import { ensureBeltState } from "../../server/game/belts.js";
import { decisionMisses, decisions, formatDecisions, formatMastery, mastery, masteryMisses, rulesAnswer } from "./deskProbe.js";

// AB#4689 slice 10: the Desk's probes (docs/design/desk-work.md section 8). BOT NUMBERS (P-PROXY). The ordinary suite
// works ten hours per tier and 40 packets of each kind; DESK_PROBE=mastery or DESK_PROBE=decisions (npm run
// probe:desk-mastery, probe:desk-decisions) runs that probe's full table and fails when its targets miss. In the
// ordinary suite the mastery targets are asserted (they are the Feature's acceptance), the decision targets printed:
// a miss there is reported, never retuned (economy tuning waits for the Board's review, AB#4779).
const PROBE = process.env.DESK_PROBE || "";

describe("desk-mastery (AB#4689)", () => {
  const hours = PROBE === "mastery" ? 50 : 10; // an hour is 20 packets, too few to hold a ratio still
  it(`works ${hours} simulated hour(s) per tier: the rules-aware bot earns at least 3x the random bot's standing, with a growing lead`, () => {
    const rows = mastery(hours);
    console.log(`\n${formatMastery(rows, hours)}\n`);
    for (const r of rows) expect(r.rules.points, `tier ${r.tier}`).toBeGreaterThan(0); // never a green run of nothing
    expect(masteryMisses(rows)).toEqual([]);
  });

  it("the rules-aware bot reads only the document: it answers every kind at every tier as the key says, from 100 packets each", () => {
    const belts = ensureBeltState({}, 0).belts;
    const corp = { unlockedTech: [], currentSystemId: "sol" };
    for (const tier of [1, 2, 3]) {
      for (let i = 0; i < 100; i += 1) {
        const s = generateSurvey({ seed: `read:${i}`, tier, corp, belts });
        expect(gradeSurvey(s.key, rulesAnswer(s.packet)).correct).toBe(true);
        const a = generateAudit({ seed: `read:${i}`, tier });
        expect(gradeAudit(a.key, rulesAnswer(a.packet)).correct).toBe(true);
        const d = generateDispatch({ seed: `read:${i}`, tier });
        expect(gradeDispatch(d.key, rulesAnswer(d.packet)).correct).toBe(true);
      }
    }
    expect(Object.keys(AUDIT_CLAUSES)).toHaveLength(11);
  });
});

describe("desk-decisions (AB#4689)", () => {
  const samples = PROBE === "decisions" ? 300 : 40;
  it(`finds the best kind per profile and per payoff at every tier, from ${samples} packets of each kind`, () => {
    const rows = [1, 2, 3].map((tier) => decisions(tier, samples));
    const misses = decisionMisses(rows);
    console.log(`\n${formatDecisions(rows, samples)}\n${misses.length ? `MISSED: ${misses.join("; ")}` : "Targets met."}\n`);
    for (const r of rows) expect(Object.keys(r.byProfile).length).toBe(4);
    if (PROBE === "decisions") expect(misses).toEqual([]);
  });
});
