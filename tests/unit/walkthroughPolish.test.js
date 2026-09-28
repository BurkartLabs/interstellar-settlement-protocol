import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { WALKTHROUGH_STEPS, paragraphsOf } from "../../public/scripts/walkthrough.js";

// AB#2463 (Board review items 4, 5, 6, 7, 9, 10): the walkthrough's polish. Step 1 does not repeat the introduction the
// message before it gave; every step reads in short paragraphs; no "Start here" anywhere; the card scales with the
// screen; the portrait is a larger coloured square; a highlight stands off what it frames.
const css = fs.readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");

describe("the walkthrough's words (AB#2463)", () => {
  it("step 1 starts with the inbox, not a second introduction", () => {
    const first = WALKTHROUGH_STEPS[0].text;
    expect(first).toMatch(/^Start with your inbox/);
    expect(first).not.toMatch(/I have been assigned|Elara Voss/);
  });

  it("every step is two or three paragraphs, none of them long, and none says \"start here\"", () => {
    for (const step of WALKTHROUGH_STEPS) {
      const ps = paragraphsOf(step.text);
      expect(ps.length, step.id).toBeGreaterThanOrEqual(2);
      expect(ps.length, step.id).toBeLessThanOrEqual(3);
      for (const p of ps) expect(p.length, `${step.id}: ${p.slice(0, 40)}`).toBeLessThanOrEqual(220);
      expect(step.text, step.id).not.toMatch(/start here/i);
    }
  });

  it("splits on a blank line and drops empty pieces", () => {
    expect(paragraphsOf("One.\n\nTwo.\n  \nThree.")).toEqual(["One.", "Two.", "Three."]);
    expect(paragraphsOf("")).toEqual([]);
  });
});

describe("the walkthrough card (AB#2463)", () => {
  it("scales with the screen: about 600px at 1920 wide, with a floor and a ceiling", () => {
    const rule = css.match(/#walkthrough-modal \.modal-card \{[^}]*\}/)[0];
    expect(rule).toMatch(/width: min\(clamp\(22\.5rem, 31\.25vw, 45rem\), 100%\)/);
    expect(1920 * 0.3125).toBe(600);
  });

  it("shows the portrait as a larger square with colour, and stands a highlight off what it frames", () => {
    const portrait = css.match(/#walkthrough-modal \.dialogue__portrait \{[^}]*\}/)[0];
    expect(portrait).toMatch(/width: 104px;\s*height: 104px;/);
    expect(portrait).toMatch(/border-radius: var\(--radius-md\)/);
    expect(portrait).toMatch(/filter: saturate\(/);
    expect(css.match(/\.walkthrough__focus \{[^}]*\}/)[0]).toMatch(/outline-offset: var\(--space-2\)/);
  });
});
