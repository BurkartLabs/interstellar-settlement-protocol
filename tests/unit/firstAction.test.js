import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { stationStartPromptHtml, milestonesFirst, sidebarStartsCollapsed, revealScroll, NARROW_MAX_WIDTH } from "../../public/scripts/firstAction.js";

// AB#1056: the first thing a new player has to do sat below the fold on Landing, Station and Overview, and at phone
// width a tab tap changed a panel the player could not see. These are the decisions behind each fix; the layout itself
// is checked by screenshot at 1280x800 and 375x812 (the PR has both, before and after).

describe("Station: the Start here prompt (AB#1056)", () => {
  it("shows while the corporation has no office, with a button into the Orbital Executive Suites", () => {
    const html = stationStartPromptHtml({ offices: [] });
    expect(html).toMatch(/Start here/);
    expect(html).toMatch(/data-start-office/);
    expect(html).toMatch(/Orbital Executive Suites/);
  });
  it("is gone once there is an office, and for a corporation with no data yet", () => {
    expect(stationStartPromptHtml({ offices: [{ stationId: "earth-station-prime" }] })).toBe("");
    expect(stationStartPromptHtml(undefined)).toMatch(/Start here/); // no corp yet reads as no office, which it is
  });
});

describe("Overview: milestones before the stat cards early on (AB#1056)", () => {
  it("puts the next milestones first at levels 0 to 2, and back below the cards after", () => {
    expect([0, 1, 2].map(milestonesFirst)).toEqual([true, true, true]);
    expect([3, 5, 10].map(milestonesFirst)).toEqual([false, false, false]);
    expect(milestonesFirst(undefined)).toBe(true);
  });
});

describe("Phone width (AB#1056)", () => {
  it("collapses the sidebar by default below the tablet breakpoint only", () => {
    expect(NARROW_MAX_WIDTH).toBe(767);
    expect(sidebarStartsCollapsed(375)).toBe(true);
    expect(sidebarStartsCollapsed(767)).toBe(true);
    expect(sidebarStartsCollapsed(768)).toBe(false);
    expect(sidebarStartsCollapsed(1280)).toBe(false);
  });
  it("scrolls a chosen panel to just under the pinned header, and only when it is not already in the upper part below it", () => {
    // phone: the header is pinned and 170 px tall, so the band a player can see starts at 170
    expect(revealScroll(1029, 170, 812)).toBe(1029 - 170 - 8); // the Exchange heading after Quick Actions, before the fix
    expect(revealScroll(33, 170, 812)).toBe(33 - 170 - 8);     // "on screen" but under the header: scroll back up
    expect(revealScroll(-400, 170, 812)).toBe(-400 - 170 - 8); // scrolled past it
    expect(revealScroll(300, 170, 812)).toBe(0);                // already in view below the header
    // desktop: a panel already under the tab bar is left alone
    expect(revealScroll(190, 88, 800)).toBe(0);
  });
});

describe("One breakpoint for the phone layout (AB#1056)", () => {
  it("the CSS that puts the tabs in one row uses the width the script collapses the sidebar at", () => {
    const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");
    const block = css.split("/* ─── Phone: one row of tabs (AB#1056) ─── */")[1] || "";
    expect(block).toContain(`@media (max-width: ${NARROW_MAX_WIDTH}px)`);
    expect(block).toMatch(/\.tab-nav\s*{[^}]*flex-wrap:\s*nowrap/);
  });
});

describe("Landing: Log In and Register come straight after the title (AB#1056)", () => {
  const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  const at = (needle) => html.indexOf(needle);
  it("places .hero-actions after the title and before the tagline, description and pills", () => {
    expect(at('class="hero-actions"')).toBeGreaterThan(at('class="hero-title"'));
    expect(at('class="hero-actions"')).toBeLessThan(at('class="hero-tagline"'));
    expect(at('class="hero-actions"')).toBeLessThan(at('class="hero-desc"'));
    expect(at('class="hero-actions"')).toBeLessThan(at('class="hero-metrics"'));
  });
});
