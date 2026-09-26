import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { NARROW_MAX_WIDTH } from "../../public/scripts/firstAction.js";

// AB#1055: whole panels were capped with viewport-relative max-widths (the Inbox at 33vw, the Assignments board at
// 25vw, Comms, Forums and the agent office at 50vw), which a phone turns into columns 94 to 188 px wide. The caps stay
// on desktop, where they are a design choice, and are lifted at phone width. This reads the stylesheet as data: every
// rule capped in vw must be lifted in the phone block, so the next panel someone caps is caught here, not on a phone.
// The layout itself is checked by measurement at 375x812 and 1280x800 (the PR has both, before and after).
const CSS = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const PHONE_BLOCK = CSS.split("/* ─── Phone: panels fill the screen (AB#1055) ─── */")[1] || "";

/** Selectors of top-level rules (outside any @media) whose max-width is in vw. */
function vwCapped(css) {
  const out = [];
  let depth = 0;
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const selector = css.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[\s}]+/, "").trim();
    if (/^@(media|supports|keyframes|-webkit-keyframes|container|layer)\b/.test(selector)) { depth++; i = open + 1; continue; }
    const close = css.indexOf("}", open);
    const body = css.slice(open + 1, close);
    if (depth === 0 && /(^|;|\s)max-width:\s*[\d.]+vw/.test(body)) out.push(selector);
    i = close + 1;
    // leaving a media block: a closing brace right after a rule's brace
    while (depth > 0 && /^\s*}/.test(css.slice(i))) { i = css.indexOf("}", i) + 1; depth--; }
  }
  return out;
}

describe("phone panels (AB#1055)", () => {
  it("finds the capped panels it is meant to find", () => {
    const capped = vwCapped(CSS);
    // #missions-board-view and #agent-office-view are no longer capped at all (AB#1762, tests/unit/panelWidth.test.js),
    // nor is #inbox since ISP-77 rebuilt it on the design system at the content's width (AB#766).
    for (const s of ["#chat", "#forum-overview-view", "#map-details", ".mission-card"]) expect(capped).toContain(s);
  });

  it("lifts every vw-capped rule at phone width", () => {
    expect(PHONE_BLOCK).toContain(`@media (max-width: ${NARROW_MAX_WIDTH}px)`);
    const lifted = PHONE_BLOCK.split("{")[1] || "";
    for (const selector of vwCapped(CSS)) expect(lifted, selector).toContain(selector);
    expect(PHONE_BLOCK).toMatch(/max-width:\s*none/);
  });

  it("gives the agent card a cap rather than a fixed width, so it cannot run out of its board", () => {
    const rule = CSS.match(/\n\.agent-card\s*{([^}]*)}/)?.[1] || "";
    expect(rule).not.toMatch(/(^|\s|;)width:\s*30em/);
    expect(rule).toMatch(/max-width:\s*30em/);
  });

  it("lets the Galactic Exchange tables sit side by side only when each card can hold its table (AB#1165)", () => {
    expect(CSS).toMatch(/\.exchange__split\s*{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(560px,\s*100%\),\s*1fr\)\)/); // ISP-80 (AB#769)
  });
});
