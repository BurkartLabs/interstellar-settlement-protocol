import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NAV_GROUPS, groupOf, revealedGroups } from "../../public/scripts/navGroups.js";
import { WALKTHROUGH_STEPS } from "../../public/scripts/walkthrough.js";

// ISP-75 (AB#764): the fourteen tabs (and Travel, shown only in transit) in six groups. The page's panels are read from
// index.html, so a panel added without a group, or a group naming a panel that is gone, fails here.
const HTML = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const PANELS = [...HTML.matchAll(/<article\b[^>]*\bclass="[^"]*\btab-panel\b[^"]*"[^>]*\bid="([^"]+)"|<article\b[^>]*\bid="([^"]+)"[^>]*\bclass="[^"]*\btab-panel\b/g)].map((m) => m[1] ?? m[2]);

describe("the six navigation groups (ISP-75)", () => {
  it("are Company, Station, Industry, Market, Comms and Map, in that order", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Company", "Station", "Industry", "Market", "Comms", "Map"]);
  });

  it("hold every panel on the page exactly once, and nothing else", () => {
    expect(PANELS.length).toBe(15);
    const grouped = NAV_GROUPS.flatMap((g) => g.tabs);
    expect([...grouped].sort()).toEqual([...PANELS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("each has a button and each tab a button, in the page, under its own group", () => {
    for (const g of NAV_GROUPS) {
      const at = HTML.indexOf(`data-group="${g.id}"`);
      expect(at, g.id).toBeGreaterThan(-1);
      const next = NAV_GROUPS[NAV_GROUPS.indexOf(g) + 1];
      const end = next ? HTML.indexOf(`data-group="${next.id}"`) : HTML.indexOf("</nav>", at);
      const section = HTML.slice(at, end);
      for (const tab of g.tabs) expect(section, `${g.id} holds ${tab}`).toMatch(new RegExp(`class="nav-tab[^"]*" data-tab="${tab}"`));
    }
  });

  it("groupOf names the group a tab is in, and nothing for a tab that does not exist", () => {
    expect(groupOf("inbox")).toBe("company");
    expect(groupOf("station")).toBe("station");
    expect(groupOf("rnd")).toBe("industry");
    expect(groupOf("market")).toBe("market");
    expect(groupOf("forums")).toBe("comms");
    expect(groupOf("starmap")).toBe("map");
    expect(groupOf("travel")).toBe("map");
    expect(groupOf("nowhere")).toBe(null);
  });
});

describe("the walkthrough reveals a group when it first becomes relevant (ISP-75)", () => {
  const ALL = NAV_GROUPS.map((g) => g.id);
  const at = (id) => WALKTHROUGH_STEPS.findIndex((s) => s.id === id);

  it("a returning player sees every group: no briefing open, or a corporation past level 0", () => {
    expect(revealedGroups({ walkthroughOpen: false, level: 0, stepIndex: 0 })).toEqual(ALL);
    expect(revealedGroups({ walkthroughOpen: true, level: 1, stepIndex: 0 })).toEqual(ALL);
  });

  it("a new corporation's briefing shows the groups its steps have reached, in the order it reaches them", () => {
    const shown = (i) => revealedGroups({ walkthroughOpen: true, level: 0, stepIndex: i });
    expect(shown(0)).toEqual(["company"]);
    const station = WALKTHROUGH_STEPS.findIndex((s) => s.tab === "station");
    expect(shown(station)).toEqual(["company", "station"]);
    const market = WALKTHROUGH_STEPS.findIndex((s) => s.tab === "market");
    expect(shown(market)).toEqual(["company", "station", "market"]);
    const rnd = WALKTHROUGH_STEPS.findIndex((s) => s.tab === "rnd");
    expect(shown(rnd)).toContain("industry");
    const last = WALKTHROUGH_STEPS.length - 1;
    expect(shown(last)).toContain("map");
    expect(shown(last), "no step is about Comms, so it waits for the briefing to end").not.toContain("comms");
    expect(at("licence")).toBe(0);
  });

  it("never hides the group the step on screen points at", () => {
    WALKTHROUGH_STEPS.forEach((step, i) => {
      expect(revealedGroups({ walkthroughOpen: true, level: 0, stepIndex: i }), step.id).toContain(groupOf(step.tab));
    });
  });
});
