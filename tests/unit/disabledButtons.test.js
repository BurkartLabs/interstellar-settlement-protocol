import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// AB#1284: the game disables buttons in about forty places (a lease the corporation cannot staff or afford, Rent while
// a request is out, the walkthrough's Previous on step 1, a forum post while it sends), and the stylesheet drew none of
// them: a disabled button kept its full colour and its hover glow. This reads styles.css as data. What it looks like is
// checked on the running game by e2e/disabled-buttons.spec.js, with screenshots.
const CSS = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

/** Top-level rules as { selectors, body }, outside any @media or @keyframes. */
function topLevelRules(css) {
  const out = [];
  let depth = 0;
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const selector = css.slice(i, open).replace(/^[\s}]+/, "").trim();
    if (/^@/.test(selector)) { depth++; i = open + 1; continue; }
    const close = css.indexOf("}", open);
    if (depth === 0) out.push({ selectors: selector.split(",").map((s) => s.trim().replace(/\s+/g, " ")), body: css.slice(open + 1, close) });
    i = close + 1;
    while (depth > 0 && /^\s*}/.test(css.slice(i))) { i = css.indexOf("}", i) + 1; depth--; }
  }
  return out;
}
const RULES = topLevelRules(CSS);
const declared = (selector, property) => RULES.filter((r) => r.selectors.includes(selector))
  .map((r) => r.body.match(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`))?.[1]?.trim())
  .filter(Boolean);

describe("disabled buttons look disabled (AB#1284)", () => {
  // ISP-83 (AB#772): the game's buttons are the design system's; .btn is gone from the stylesheet with its last use.
  it("finds rules at all: the parser sees the .ui-button base rule", () => {
    expect(declared(".ui-button", "cursor")).toContain("pointer");
  });

  it("dims every disabled button and says it cannot be pressed, not only .btn", () => {
    const opacity = declared("button:disabled", "opacity").map(Number);
    expect(opacity.length).toBeGreaterThan(0);
    expect(opacity.every((o) => o > 0 && o <= 0.5)).toBe(true);
    expect(declared("button:disabled", "cursor")).toContain("not-allowed");
  });

  it("says a disabled design-system button cannot be pressed", () => {
    expect(declared(".ui-button:disabled", "cursor")).toContain("not-allowed");
  });

  it("is one rule for the whole game: the Construct card's own copy (AB#1253) is gone", () => {
    expect(RULES.some((r) => r.selectors.some((s) => /\S\s+\.btn:disabled/.test(s)))).toBe(false);
  });
});
