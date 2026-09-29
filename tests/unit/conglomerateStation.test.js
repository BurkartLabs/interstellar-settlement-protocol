import { describe, it, expect } from "vitest";
import { coOwnedStationHtml, dockedAtOwnStationHtml, noStationHtml, projectHtml, stationTabHtml } from "../../public/scripts/conglomerateStation.js";
import { setSectionCodes } from "../../public/scripts/sectionCodes.js";

// ISP-213 (AB#908): the Conglomerate tab's Station screen, as markup. Every figure is the server's; these check that
// each state shows what it should, offers only what the role may do, and never works a figure out itself.
const T0 = Date.UTC(2026, 8, 27, 12);
const BILL = { credits: 2_000_000, goods: { "Structural Alloys": 5000, "Pressure Vessels": 2000 } };
const sp = (over = {}) => ({ canStart: true, minLevel: 4, buildDays: 14, bill: BILL, memberRentPct: 50, nameSuffixes: ["Station", "Anchorage"], openOrbits: [{ systemId: "sol", systemName: "Sol", body: "Venus" }], project: null, station: null, ...over });
const project = (over = {}) => ({
  id: "csp-1", state: "funding", name: "Venus Station", systemId: "sol", body: "Venus", startedAt: T0,
  needs: BILL, has: { credits: 500_000, goods: { "Structural Alloys": 5000 } }, remaining: { credits: 1_500_000, goods: { "Structural Alloys": 0, "Pressure Vessels": 2000 } },
  fundedAt: null, completesAt: null, blocked: null,
  contributions: [{ corp: "corp-a", value: 500_000 }, { corp: null, value: 125_000 }],
  byMember: [{ corp: "corp-a", corpName: "Alpha <Mining>", value: 500_000 }], ...over
});
const gov = (over = {}) => ({
  station: { id: "cg-venus", name: "Venus Station", systemId: "sol", body: "Venus", builtAt: T0 },
  stakes: [{ corp: "corp-a", corpName: "Alpha", value: 1_500_000, pct: 60.56 }, { corp: "corp-b", corpName: "Beta", value: 977_000, pct: 39.44 }],
  settings: { access: "open", listed: [] },
  proposals: [{ id: "csv-1", setting: "access", value: "members", text: "Docking at the station: members only", state: "open", proposedBy: "corp-b", proposedByName: "Beta", at: T0, closesAt: T0 + 72 * 3600e3, yesPct: 39.4, noPct: 0, votes: [{ corp: "corp-b", vote: "yes" }] }],
  buyouts: [], ...over
});
const tds = (html) => html.match(/<td\b[^>]*>/g) || [];

describe("before any project (AB#908)", () => {
  it("offers the founder the form, and tells a member who files it", () => {
    const founder = noStationHtml(sp(), { may: ["station-project"], level: 4, atBureau: true });
    expect(founder).toContain('data-role="cong-station-start"');
    expect(founder).toContain("2,000,000 credits, 5,000 Structural Alloys, 2,000 Pressure Vessels");
    expect(founder).toContain('<option value="sol|Venus">Venus, Sol</option>');
    expect(founder).toContain('<option value="2">Anchorage</option>');
    const member = noStationHtml(sp(), { may: ["contribute"], level: 4 });
    expect(member).not.toContain("cong-station-start");
    expect(member).toContain("The founder files a station project");
  });
  it("says why a project cannot be filed: the level, or no open orbit", () => {
    expect(noStationHtml(sp({ canStart: false }), { may: ["station-project"], level: 2 })).toContain("needs a level 4 conglomerate; yours is level 2");
    expect(noStationHtml(sp({ openOrbits: [] }), { may: ["station-project"], level: 4 })).toContain("No open orbit is in reach");
    expect(noStationHtml(sp(), { may: ["station-project"], level: 4, atBureau: false })).toContain("travel there to file it");
  });
});

describe("a project (AB#908)", () => {
  it("shows the bill, a bar per input, and the contributors, the pool apart and nobody's stake", () => {
    const html = projectHtml(project(), { may: ["contribute"], me: "corp-a", own: { "Pressure Vessels": 800 } });
    expect(html).toContain('aria-label="Credits: 500,000 of 2,000,000"');
    expect(html).toContain('aria-valuenow="25"');
    expect(html).toContain('aria-label="Structural Alloys: 5,000 of 5,000"');
    for (const td of tds(html)) expect(td).toContain("data-label=");
    expect(html).toContain("Alpha &lt;Mining&gt; (you)");
    expect(html).toContain("125,000 credits of value from the treasury and hangar, nobody's stake");
    expect(html).toContain("Pressure Vessels (you hold 800; 2,000 needed)");
    expect(html).not.toContain("Structural Alloys (you hold"); // nothing still needed of it
  });
  it("offers the pool and cancelling to the founder only", () => {
    const member = projectHtml(project(), { may: ["contribute"] });
    expect(member).not.toContain('data-source="pool"');
    expect(member).not.toContain("cong-station-cancel");
    const founder = projectHtml(project(), { may: ["contribute", "station-project"], hangar: { "Pressure Vessels": 300 }, treasury: { credits: 90_000 } });
    expect(founder).toContain('data-source="pool"');
    expect(founder).toContain("Treasury credits (it holds 90,000)");
    expect(founder).toContain("the hangar holds 300; 2,000 needed");
    expect(founder).toContain('data-role="cong-station-cancel"');
  });
  it("drops a field for what is complete, and once funded shows the clock instead of any form", () => {
    const allCredits = projectHtml(project({ remaining: { credits: 0, goods: { "Structural Alloys": 0, "Pressure Vessels": 2000 } } }), { may: ["contribute", "station-project"] });
    expect(allCredits).not.toContain("cong-give-credits");
    expect(allCredits).toContain("The credits are all in");
    expect(allCredits).toContain("The hangar holds none of the goods still needed");
    const building = projectHtml(project({ state: "building", fundedAt: T0, completesAt: T0 + 14 * 864e5 }), { may: ["contribute", "station-project"], now: T0 + 7 * 864e5 });
    expect(building).toContain("Fully funded.");
    expect(building).toContain('aria-valuenow="50"');
    expect(building).not.toContain("cong-station-give");
    expect(building).not.toContain("cong-station-cancel");
  });
});

describe("the built station (AB#908)", () => {
  const ctx = { me: "corp-a", memberStation: { id: "cg-venus", officeRentPct: 50 }, standardRent: 1000, systems: [{ id: "sol", name: "Sol", bodies: [] }], directory: [{ id: "cg-self" }, { id: "cg-other", name: "Other Guild" }], conglomerateId: "cg-self" };
  it("shows the server's stakes, the member benefits and the settings", () => {
    const html = coOwnedStationHtml(gov(), ctx);
    expect(html).toContain("60.56%");
    expect(html).toContain("39.44%");
    expect(html).toContain("Your stake: <strong>60.56%</strong>");
    expect(html).toContain("A member's suite here costs 500 credits a day, not 1,000");
    expect(html).toContain("Free logistics in Sol.");
    expect(html).toContain('data-role="cong-station-access">Every corporation<');
    for (const td of tds(html)) expect(td).toContain("data-label=");
  });
  it("lets a stakeholder vote once, tells anyone else why not, and offers proposals to those who may make them", () => {
    const html = coOwnedStationHtml(gov(), ctx);
    expect(html.match(/data-role="cong-vote"/g)).toHaveLength(2);
    expect(coOwnedStationHtml(gov(), { ...ctx, me: "corp-b" })).toContain("You voted yes.");
    const outsider = coOwnedStationHtml(gov(), { ...ctx, me: "corp-z" });
    expect(outsider).not.toContain('data-role="cong-vote"');
    expect(outsider).toContain("Only corporations with a stake vote.");
    expect(html).not.toContain('data-role="cong-propose"');
    const director = coOwnedStationHtml(gov(), { ...ctx, may: ["propose-station-setting"] });
    expect(director).toContain('value="access|members"');
    expect(director).not.toContain('value="access|open"'); // already the setting
    expect(director).toContain('value="list|cg-other">List Other Guild');
    expect(director).not.toContain("cg-self");
  });
  it("takes the member rate from the screen's own read, never printing a missing one as 0 (Bug #4669)", () => {
    // the membership read is from before the station opened: it has no station, and so no rate
    const stale = stationTabHtml(sp({ station: { id: "cg-venus" }, memberRentPct: 50 }), gov(), { ...ctx, memberStation: null });
    expect(stale).toContain("Offices at 50%.");
    expect(stale).toContain("A member's suite here costs 500 credits a day, not 1,000");
    expect(stale).not.toContain("Offices at 0%");
    const none = coOwnedStationHtml(gov(), { ...ctx, memberStation: null });
    expect(none).not.toContain("Offices at");
    expect(none).toContain("Free logistics in Sol.");
  });

  it("says who decides when nobody holds a stake, and shows buyouts under way", () => {
    const html = coOwnedStationHtml(gov({ stakes: [], buyouts: [{ corp: "corp-c", corpName: "Gamma", how: "left", total: 400_000, paid: 40_000, days: 30, startsAt: T0 }] }), ctx);
    expect(html).toContain("the founder decides its settings");
    expect(html).toContain("Gamma: 40,000 of 400,000 credits paid");
    expect(html).toContain("Left: half its stake");
  });
});

describe("the Station tab and the whole screen (AB#908)", () => {
  it("picks the state from the server's reads", () => {
    expect(stationTabHtml(null, null)).toContain("Reading the station project");
    expect(stationTabHtml({ error: "down" }, null)).toContain("could not be loaded");
    expect(stationTabHtml(sp({ project: project() }), null)).toContain('data-role="cong-station-project"');
    expect(stationTabHtml(sp({ station: { id: "cg-venus" } }), gov(), { memberStation: { id: "cg-venus", officeRentPct: 50 } })).toContain('data-role="cong-station-built"');
  });
  it("tells a docked member what the station gets it", () => {
    const html = dockedAtOwnStationHtml({ name: "Venus Station", systemId: "sol" }, { memberStation: { id: "cg-venus", officeRentPct: 50 }, standardRent: 1000, systems: [{ id: "sol", name: "Sol" }] });
    expect(html).toContain("your suite here costs 500 credits a day (50% of 1,000)");
    expect(html).toContain("the rest of Sol for nothing");
    expect(html).toContain('data-role="own-station-open"');
  });
});

// ISP-254 slice C1b (AB#4821): the project's state, the votes and the form lines carry the protocol line after their
// plain words, with the Conglomerate screen's code.
describe("the Station screen's protocol line (AB#4821)", () => {
  const LINE = (phrase) => `<span class="protocol-line">${phrase}<span class="protocol-line__code" aria-hidden="true"> // CGL-ADM-1</span></span>`;
  const withCodes = (fn) => { setSectionCodes({ screens: [{ id: "conglomerate", code: "CGL-ADM-1" }] }); try { fn(); } finally { setSectionCodes(null); } };

  it("a project being funded is Lodged, one under construction In force", () => withCodes(() => {
    expect(projectHtml(project(), { may: ["contribute"] })).toContain(`Station project · sol ${LINE("Lodged")}</p>`);
    const building = projectHtml(project({ state: "building", fundedAt: T0, completesAt: T0 + 14 * 864e5 }), { may: ["contribute"], now: T0 + 864e5 });
    expect(building).toContain(`Under construction · sol ${LINE("In force")}</p>`);
  }));

  it("an open vote is Filed, awaiting review; a closed one In force or Denied, and Lapsed says itself", () => withCodes(() => {
    const closed = (state) => ({ id: `csv-${state}`, setting: "access", value: "members", text: `A ${state} proposal`, state, proposedBy: "corp-b", at: T0, closesAt: T0, closedAt: T0 + 1000, yesPct: 60, noPct: 0, votes: [] });
    const html = coOwnedStationHtml(gov({ proposals: [...gov().proposals, closed("passed"), closed("rejected"), closed("expired")] }), { me: "corp-a", may: ["view"], memberStation: { id: "cg-venus", officeRentPct: 50 } });
    expect(html).toContain(`no 0% of all stake ${LINE("Filed, awaiting review")}</p>`);
    expect(html).toMatch(new RegExp(`Passed [^<]+ ${LINE("In force").replace(/[/()]/g, "\\$&")}</p>`));
    expect(html).toMatch(new RegExp(`Voted down [^<]+ ${LINE("Denied").replace(/[/()]/g, "\\$&")}</p>`));
    expect(html).toMatch(/Lapsed [^<]+<\/p>/); // the plain word is already the guide's phrase
  }));

  it("a form's line carries its phrase, and a station that did not load is Unsuccessful", () => withCodes(() => {
    const html = projectHtml(project(), { may: ["contribute", "station-project"], status: { own: { text: "Put in: 10 credits.", ok: true, protocol: { meaning: "complete", screen: "conglomerate" } } } });
    expect(html).toContain(`Put in: 10 credits. ${LINE("Concluded")}</p>`);
    expect(stationTabHtml({ error: "down" }, null)).toContain(`Nothing has changed. ${LINE("Unsuccessful")}</p>`);
  }));
});
