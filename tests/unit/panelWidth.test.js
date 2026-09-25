import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// AB#1762 (ISP-293): Corporate R&D (.rnd-panel, capped at 820px) and the Assignments Bureau (#missions-board-view at
// 25vw, an agent's office #agent-office-view at 50vw) sat narrower than the content column every other tab fills. They
// take the column's width now, at every breakpoint. This reads the stylesheet as data: no rule, top level or inside a
// media query, may give these containers a width or max-width in px or vw again. The layout itself is measured at
// 1280x800 and 375x812 by e2e/rnd-assignments-width.spec.js.
const CSS = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const CONTAINERS = [".rnd-panel", "#rnd-queue", "#missions-board-view", "#agent-office-view"];

/** Every rule body whose selector list names `target` as the element it styles (the last compound of a selector). */
function rulesFor(target) {
  const bodies = [];
  for (const [, selectors, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const styles = selectors.split(",").map((s) => s.trim().split(/[\s>+~]+/).pop());
    if (styles.includes(target)) bodies.push(body);
  }
  return bodies;
}

describe("Corporate R&D and Assignments at full content width (AB#1762)", () => {
  it("finds the rules it checks", () => {
    // A floor, so the check cannot pass by matching nothing: .rnd-panel and its queue keep their other rules.
    expect(rulesFor(".rnd-panel").length).toBeGreaterThan(0);
    expect(rulesFor("#ceo-queue").join("")).toMatch(/max-width:\s*min\(750px/);
  });

  it.each(CONTAINERS)("%s has no px or vw width cap anywhere in the stylesheet", (target) => {
    for (const body of rulesFor(target)) {
      expect(body, target).not.toMatch(/(^|[;\s])(max-)?width:\s*[^;]*\d(px|vw)/);
    }
  });
});
