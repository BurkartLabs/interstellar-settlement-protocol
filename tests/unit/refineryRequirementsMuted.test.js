// ISP-292 (AB#1761, visual-design Critique AB#1757, POLISH 2.4/5): the Refinery Chains panel showed a research
// or construction requirement in amber, the same colour as an actual warning, so a normal step in the panel
// read as something wrong. Amber stays for a real warning ("All refineries busy") — only requirement rows move
// to the muted token.
import { describe, expect, it } from "vitest";
import { clientCode } from "../helpers/clientSource.js";

// AB#739: the Refinery Chains panel is drawn by views/refinery.js; this reads app.js and every module it loads.
const APP_JS = clientCode();

describe("Refinery Chains: requirement text is muted, not amber (AB#1761)", () => {
  it("has no requirement row styled with the warning colour", () => {
    const requirementLines = APP_JS.split(/\r?\n/).filter((line) => /Requires?:/i.test(line) && line.includes("--color-warn"));
    expect(requirementLines).toEqual([]);
  });

  // ISP-79 (AB#768): on the design system the muted token is the card's meta line, and the warning is a warn badge.
  it("still renders both requirement lines, in the muted token", () => {
    // AB#2485: the requirements moved to the Unavailable chains' "Missing" list: the research, and the building.
    expect(APP_JS).toContain('<li><p class="ui-card__meta">Requires: ${researchLinks(blockers.research, chain).join(", ")}</p></li>');
    expect(APP_JS).toContain('<li><p class="ui-card__meta">Runs in a ${buildingLinkHtml(b.id, b.name)}, which your corporation has not built');
  });

  it("keeps amber for the real warning: all refineries busy", () => {
    expect(APP_JS).toContain('<span class="ui-badge ui-badge--warn">All refineries busy</span>');
  });
});
