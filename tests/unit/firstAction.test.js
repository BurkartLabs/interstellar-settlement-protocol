import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { milestonesFirst, sidebarStartsCollapsed, revealScroll, NARROW_MAX_WIDTH } from "../../public/scripts/firstAction.js";

// AB#1056: the first thing a new player has to do sat below the fold on Landing, Station and Overview, and at phone
// width a tab tap changed a panel the player could not see. These are the decisions behind each fix; the layout itself
// is checked by screenshot at 1280x800 and 375x812 (the PR has both, before and after).

describe("Station: no first-action prompt (AB#2463, Board review item 9)", () => {
  it("the Station draws no \"Start here\" and nothing binds one: the walkthrough leads to the Suites", () => {
    for (const f of ["public/scripts/firstAction.js", "public/scripts/views/station.js", "public/index.html"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/start here|data-start-office|stationStartPromptHtml/i);
    }
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
  // ISP-74 (AB#763) replaced the one scrolling row of tabs with the bottom bar, and ISP-75 (AB#764) made the bar six
  // groups; the invariant is unchanged: the CSS that lays out the phone shell uses the width the script collapses the
  // sidebar at, and keeps the navigation in one row.
  it("the CSS that puts the tabs in one row uses the width the script collapses the sidebar at", () => {
    const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const block = css.split("/* ─── App shell (ISP-74, AB#763; ISP-75, AB#764) ─── */")[1] || "";
    expect(block).toContain(`@media (max-width: ${NARROW_MAX_WIDTH}px)`);
    expect(block).toMatch(/\.app-nav\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*row;/);
  });
});

describe("Landing: Log In and Register come straight after the title (AB#1056)", () => {
  const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  const at = (needle) => html.indexOf(needle);
  // ISP-76 (AB#765) rebuilt the landing on the design system; the order is the same rule under the new names.
  it("places the actions after the title and before the description", () => {
    expect(at('class="landing__actions"')).toBeGreaterThan(at('class="landing__title"'));
    expect(at('class="landing__actions"')).toBeLessThan(at('class="landing__lede"'));
  });
  // AB#2462 (Board review 2026-09-26, items 1 to 3): the logo, then the tagline, open the page, above the title; the
  // description is the Board's own text; the three promise badges are gone.
  it("opens with the logo and the tagline under it, gives the Board's description, and has no promise badges", () => {
    expect(at('class="landing__intro"')).toBeGreaterThan(-1);
    expect(at('class="landing__logo"')).toBeGreaterThan(at('class="landing__intro"'));
    expect(at('class="landing__tagline"')).toBeGreaterThan(at('class="landing__logo"'));
    expect(at('class="landing__tagline"')).toBeLessThan(at('class="landing__title"'));
    const lede = html.match(/<p class="landing__lede">([\s\S]*?)<\/p>/)[1].replace(/\s+/g, " ").trim();
    expect(lede).toBe(
      "ISP is a long-term online strategy simulation where you operate as the CEO of a corporation colonizing the local galaxy while " +
        "navigating industrial logistics, legal conflict, interstellar finance, and deterministic warfare at a civilizational scale. " +
        "A true slow-burn universe. Level Progression is milestone-based and full corporate maturity unfolds over years of real-world play."
    );
    expect(html).not.toContain("landing__promises");
    for (const badge of ["Persistent multiplayer state", "Milestone progression, not XP grind", "Text-first command interface"]) {
      expect(html).not.toContain(badge);
    }
  });
});
