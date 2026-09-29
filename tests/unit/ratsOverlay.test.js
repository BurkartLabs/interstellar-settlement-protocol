// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { RATS_BANDS, beltRatsHtml, huntPanelHtml, huntReportHtml, ratsBand, ratsColor, ratsLegendHtml, systemRatsHtml } from "../../public/scripts/ratsOverlay.js";
import { clusterStarColor } from "../../public/scripts/starmap.js";
import { ratsActivity, huntOutcome } from "../../server/hunts.js";
import { ratGroup } from "../../server/game/rats.js";

// ISP-285 (AB#992): Rats on the Starmap. The page shows the server's figures (server/hunts.js ratsActivity and
// huntPreview), never its own: these read what the server computed and check the page says exactly that.
const CATALOG = [{ id: "lf", name: "Light Fighter" }, { id: "ds", name: "Destroyer" }, { id: "at", name: "Attack Troops" }];
const pct = (p) => `${Math.round(p * 100)}%`;
const activity = ratsActivity(Date.now(), { rats: { quiet: {} } });

describe("pirate activity on the map", () => {
  it("each system's panel says the server's chance and group, for every system", () => {
    for (const reading of activity.systems) {
      const html = systemRatsHtml(reading, { catalog: CATALOG });
      expect(html).toContain(`<strong>${pct(reading.chance)}</strong> an hour`);
      expect(html).toContain(`density ${reading.density}`);
    }
    const wolf = activity.systems.find((s) => s.id === "wolf-359");
    expect(systemRatsHtml(wolf, { catalog: CATALOG })).toContain("10 Light Fighters, 3 Destroyers");
  });

  it("colours a system by its band under the Pirates overlay, and the legend names every band", () => {
    const wolf = activity.systems.find((s) => s.id === "wolf-359");
    expect(clusterStarColor({ id: "wolf-359", pirateDensity: 31 }, { overlay: "rats", locked: true, rats: wolf })).toBe(ratsColor(wolf.chance));
    expect(ratsBand(0.1)).toBe(0);
    expect(ratsBand(0.5)).toBe(RATS_BANDS.length);
    expect(ratsColor(0.1)).not.toBe(ratsColor(0.5));
    const legend = ratsLegendHtml(activity);
    expect(legend.match(/<li>/g)).toHaveLength(RATS_BANDS.length + 1);
    expect(legend).toContain("None is quiet now");
    expect(ratsLegendHtml(null)).toContain("Reading the Rats' activity");
  });

  it("a belt a hunt cleared is quiet on the map, in its system's panel and in its own", () => {
    const until = Date.now() + 3_600_000;
    const quietAct = ratsActivity(Date.now(), { rats: { quiet: { "wolf-359:wf-shards": { until } } } });
    const wolf = quietAct.systems.find((s) => s.id === "wolf-359");
    expect(ratsLegendHtml(quietAct)).toContain("1 system is quiet now");
    expect(systemRatsHtml(wolf, { catalog: CATALOG })).toContain('data-rats-quiet="wolf-359:wf-shards"');
    const belt = beltRatsHtml({ beltKey: "wolf-359:wf-shards", reading: wolf, quiet: { until }, catalog: CATALOG });
    expect(belt).toContain("data-belt-quiet");
    expect(belt).toContain(`<strong>${pct(wolf.quietBelts[0].chance)}</strong>`);
    expect(belt).not.toContain("hunt-open-btn");
    const open = beltRatsHtml({ beltKey: "wolf-359:wf-shards", reading: activity.systems.find((s) => s.id === "wolf-359"), catalog: CATALOG });
    expect(open).toContain("hunt-open-btn");
    expect(beltRatsHtml({ beltKey: "wolf-359:wf-shards", reading: activity.systems.find((s) => s.id === "wolf-359"), catalog: CATALOG, open: true })).not.toContain("hunt-open-btn"); // its screen is open
  });
});

describe("the hunt screen and its report", () => {
  const group = ratGroup(31);
  const strong = { ds: 6, at: 6 }, weak = { lf: 4 };
  const fleet = (id, name, units) => { const e = huntOutcome(units, group); return { fleetId: id, name, units, provisions: 900, expected: { ...e, net: e.bounty - e.lostValue - 900 } }; };
  const preview = { belt: { beltKey: "wolf-359:wf-shards", systemId: "wolf-359", density: 31, group, chance: 0.37, quiet: null }, fleets: [fleet("flt-a", "Aegis", strong), fleet("flt-c", "Corsair", weak)], others: 1 };

  it("lists exactly the fleets the server offered, and shows the chosen one's expected battle before sending", () => {
    const html = huntPanelHtml(preview, { catalog: CATALOG, chosen: "flt-a", systemName: "Wolf 359" });
    expect([...html.matchAll(/name="hunt-fleet" value="([^"]+)"/g)].map((m) => m[1])).toEqual(["flt-a", "flt-c"]);
    expect(html).toContain("Expected: Your fleet clears them");
    expect(html).toContain("10,593 credits"); // the bounty the resolver expects
    expect(html).toContain("1,615 credits"); // the net
    expect(html).toContain('data-hunt-expected');
    expect(html).toContain("Expected forces and losses");
    const other = huntPanelHtml(preview, { catalog: CATALOG, chosen: "flt-c" });
    expect(other).toContain('value="flt-c" checked');
    expect(other).toMatch(/<h4 class="raid-report__title">Expected: (The fight breaks off|The Rats beat your fleet)/); // Corsair, 4 Light Fighters, does not
  });

  it("says why no fleet is offered, and that a quiet belt has nothing to hunt", () => {
    const none = huntPanelHtml({ ...preview, fleets: [], others: 2 }, { systemName: "Wolf 359" });
    expect(none).toContain("No fleet can hunt here now");
    expect(none).toContain("stationed in Wolf 359");
    expect(none).toContain("2 of your fleets are elsewhere or busy");
    expect(huntPanelHtml({ ...preview, belt: { ...preview.belt, quiet: { until: Date.now() + 1000 } } })).toContain("Nothing to hunt");
  });

  it("a hunt's report is the v0.10 battle report: the outcome, the bounty, the forces and the rounds", () => {
    const e = huntOutcome(strong, group);
    const report = { id: "hunt-1", systemId: "wolf-359", outcome: "attacker", resolvedAt: Date.now(), bounty: e.bounty, lostValue: e.lostValue, provisions: 900, quietUntil: Date.now() + 86_400_000, battle: e.battle };
    const html = huntReportHtml(report, { catalog: CATALOG, systemName: "Wolf 359" });
    expect(html).toContain("Hunt won");
    expect(html).toContain("10,593 credits");
    expect(html).toContain('class="raid-table"');
    expect(html).toContain(`The ${e.battle.rounds.length} round`);
    expect(html).toContain("The belt is quiet until");
  });
});
