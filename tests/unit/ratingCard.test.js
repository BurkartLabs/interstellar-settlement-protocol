import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { publicRating, inputBand, refreshCreditRating, RATING } from "../../server/creditRating.js";
import { ownRatingCardHtml, ratingCardHtml, ratingWhy, notRatedLine, gradeTone, RATING_INPUTS } from "../../public/scripts/ratingCard.js";

// ISP-148 (AB#842): what another corporation may see of a rating, and the card that shows it.
const inputs = (subs) => Object.fromEntries(RATING.inputs.map((i) => [i.id, { raw: 1, sub: subs[i.id] ?? 1, weight: i.weight }]));
const rated = (over = {}) => ({ grade: "A", score: 772, inputs: inputs({ cashCover: 0.19, margin: 0.72, turnover: 0.76 }), computedAt: 5, ...over });

describe("ISP-148 the public view shows bands, never values", () => {
  it("exactly grade, score band, input bands and when; the score and raw values are gone", () => {
    const pub = publicRating(rated());
    expect(Object.keys(pub).sort()).toEqual(["computedAt", "grade", "inputs", "scoreBand"]);
    expect(pub).toEqual({ grade: "A", scoreBand: "750-799", computedAt: 5,
      inputs: { history: "strong", cashCover: "weak", margin: "strong", solvency: "strong", leverage: "strong", turnover: "strong" } });
    expect(JSON.stringify(pub)).not.toMatch(/772|raw|weight/);
  });

  it("bands at their edges, from data/credit-rating.json", () => {
    expect([inputBand(0.67), inputBand(0.669), inputBand(0.34), inputBand(0.339), inputBand(0)]).toEqual(["strong", "fair", "fair", "weak", "weak"]);
    expect(publicRating(rated({ score: 1000 })).scoreBand).toBe("1000-1000");
    expect(publicRating(rated({ score: 0, grade: "D" })).scoreBand).toBe("0-49");
    expect(publicRating(rated({ score: 850 })).scoreBand).toBe("850-899");
  });

  it("NR, or no rating yet, shows no band at all", () => {
    for (const r of [{ grade: "NR", have: 3, need: 7, inputs: null, computedAt: 9 }, undefined, null]) {
      expect(publicRating(r)).toMatchObject({ grade: "NR", scoreBand: null, inputs: null });
    }
  });

  it("the design says what the data file holds (P-TWO-SOURCES)", () => {
    const doc = fs.readFileSync(path.resolve(import.meta.dirname, "../../docs/design/v0.9-debt.md"), "utf8");
    const section = doc.slice(doc.indexOf("**What others see"), doc.indexOf("**Quoting uses the grade after the loan"));
    expect(section).toContain(`${RATING.public.scoreBandWidth} wide`);
    for (const b of RATING.public.inputBands.filter((x) => x.minSub > 0)) expect(section).toContain(`\`${b.band}\` (sub-score ${b.minSub}`);
  });
});

describe("ISP-148 the rating card", () => {
  it("the player's own card: grade, score and what holds it back most", () => {
    const html = ownRatingCardHtml(rated());
    expect(html).toContain('data-grade="A"');
    expect(html).toContain("772 / 1,000");
    expect(ratingWhy(rated())).toBe("Weakest: cash cover; more credits against daily costs raises it.");
    // the input that costs the most points, not the lowest sub-score: margin at 0.5 costs 100, cash cover at 0.4 costs 90
    expect(ratingWhy(rated({ inputs: inputs({ cashCover: 0.4, margin: 0.5 }) }))).toMatch(/^Weakest: margin/);
    expect(ratingWhy(rated({ caps: ["payroll arrears"] }))).toBe("Capped by payroll arrears.");
    expect(ratingWhy(rated({ inputs: inputs({}) }))).toBe("Every input is at its best.");
  });

  it("NR: how many more days of history it needs", () => {
    expect(ownRatingCardHtml({ grade: "NR", have: 3, need: 7 })).toContain("Not rated: 4 more days of history needed");
    expect(notRatedLine({ grade: "NR", have: 6, need: 7 })).toBe("Not rated: 1 more day of history needed");
    expect(notRatedLine(undefined)).toBe("Not rated: 7 more days of history needed");
    expect(ownRatingCardHtml(undefined)).toContain('data-grade="NR"');
  });

  it("a counterparty's card lists each input's band, and escapes the name", () => {
    const html = ratingCardHtml({ corpId: "corp-1", corporationName: "<b>Evil</b> & Co", ...publicRating(rated()) });
    expect(html).toContain("&lt;b&gt;Evil&lt;/b&gt; &amp; Co");
    expect(html).toContain("score 750-799");
    expect(html).toContain('rating-card__input--weak">Cash cover <span>weak</span>');
    expect(ratingCardHtml({ corporationName: "New", grade: "NR", scoreBand: null, inputs: null })).toContain("Not rated");
    expect([gradeTone("AAA"), gradeTone("BBB"), gradeTone("CC"), gradeTone("D"), gradeTone("NR")]).toEqual(["strong", "fair", "weak", "default", "unrated"]);
    expect(RATING_INPUTS.map((i) => i.id)).toEqual(RATING.inputs.map((i) => i.id));
  });
});

describe("ISP-148 statements that arrive another way are rated (the file's version is in the basis)", () => {
  it("a new statements file version recomputes, the same one does not", () => {
    const corp = { finances: { dayBook: { dayStart: 1 } } };
    let reads = 0;
    const load = () => { reads++; return []; };
    refreshCreditRating(corp, 10, load, { statementsVersion: 100 });
    refreshCreditRating(corp, 20, load, { statementsVersion: 100 });
    refreshCreditRating(corp, 30, load, { statementsVersion: 200 });
    expect(reads).toBe(2);
    expect(corp.creditRating).toMatchObject({ grade: "NR", have: 0, need: 7 });
  });
});
