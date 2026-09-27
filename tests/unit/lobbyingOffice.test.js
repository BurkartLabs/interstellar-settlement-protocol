import { describe, it, expect } from "vitest";
import { lobbyingOfficeHtml, previewText } from "../../public/scripts/lobbyingOffice.js";
import { WARFARE_CATALOG } from "../../server/warfare.js";

// ISP-240 (AB#935): the lobbying office's markup: standing, the rules in a system, the preview, and the register grouped
// by parameter with both sides of each campaign, amounts only on the caller's own pledges.
const L = WARFARE_CATALOG.lobbying;
const value = (base, inForce = base, extra = {}) => ({ base, inForce, lobbyable: true, campaign: null, cooldownUntil: null, ...extra });
const office = {
  standing: { "earth-assembly": 42.5, "interplanetary-trade-commission": 3 },
  standingMax: 100,
  terms: { openStandingMin: 20, openStandingCost: 5, pledgeStandingMin: 5, creditsPerStandingPoint: 2500, pledgeHours: 72, durationDays: 28, cooldownDays: 7 },
  parameters: L.parameters,
  currentSystemId: "alpha-centauri",
  credits: 100_000,
  systems: [
    { id: "alpha-centauri", name: "Alpha Centauri", values: { tariffCapPct: value(3, 3.5, { campaign: { id: "lob-1", direction: "raise", state: "in-force" } }), salesTaxPct: value(8), dumpingPriceThresholdPct: value(85), dumpingVolumeThresholdPct: value(10) } },
    { id: "procyon", name: "Procyon", values: { tariffCapPct: value(0, 0, { lobbyable: false }), salesTaxPct: value(8), dumpingPriceThresholdPct: value(85), dumpingVolumeThresholdPct: value(10) } }
  ],
  campaigns: [
    { id: "lob-1", parameter: "tariffCapPct", systemId: "alpha-centauri", systemName: "Alpha Centauri", direction: "raise", state: "in-force", openedBy: "Helios", openedByYou: false, closesAt: 0, result: { from: 3, to: 3.5, endsAt: Date.UTC(2026, 9, 25) }, pledgers: [{ name: "Helios", side: "for" }, { name: "Kestrel", side: "against" }], own: [] },
    { id: "lob-2", parameter: "salesTaxPct", systemId: "tau-ceti", systemName: "Tau Ceti", direction: "lower", state: "pledging", openedBy: "You Corp", openedByYou: true, closesAt: Date.UTC(2026, 8, 30, 14), result: null, pledgers: [{ name: "You Corp", side: "for" }], own: [{ side: "for", credits: 20000, standing: 0 }] },
    { id: "lob-3", parameter: "tariffCapPct", systemId: "wolf-359", systemName: "Wolf 359", direction: "lower", state: "pledging", openedBy: "Kestrel", openedByYou: false, closesAt: Date.UTC(2026, 8, 30, 14), result: null, pledgers: [], own: [] },
    { id: "lob-4", parameter: "dumpingPriceThresholdPct", systemId: "sirius", systemName: "Sirius", direction: "lower", state: "pledging", openedBy: "Vega", openedByYou: false, closesAt: 0, result: null, pledgers: [], own: [] }
  ]
};
const form = { parameter: "tariffCapPct", systemId: "alpha-centauri", direction: "raise", credits: 15000, standing: 0 };
const html = lobbyingOfficeHtml({ office, faction: "earth-assembly", form });

describe("the lobbying office (AB#935)", () => {
  it("shows the caller's standing with the building's faction, and the rules in the chosen system with base and in force", () => {
    expect(html).toContain('<strong data-role="lobby-standing-value">42.5</strong> of 100');
    expect(html).toMatch(/data-lobby-value="tariffCapPct"[\s\S]*?<td data-label="Base">3%<\/td><td data-label="In force" class="lobby-moved">3.5%<\/td><td data-label="Status">Campaign in force \(raise\)/);
    expect(html).toContain('data-lobby-value="salesTaxPct"');
    expect(html).not.toContain('data-lobby-value="dumpingPriceThresholdPct"'); // the ITC's rules are at the ITC
  });

  it("previews the spend with the server's own outcome, and says when it would not move", () => {
    expect(html).toContain("With nobody opposing it, 15,000 of influence pulls 0.53 of the 1 a campaign can move. The tariff cap would go from 3% to 3.5% for 28 days.");
    expect(previewText(office, { ...form, credits: 4000 })).toContain("under one step of 0.25, so it would not move");
    expect(previewText(office, { ...form, systemId: "procyon" })).toBe("Tariff cap cannot be lobbied in Procyon.");
    expect(previewText(office, { ...form, credits: 0 })).toBe("Enter the credits or standing you would pledge to see what it would move. A campaign moves the tariff cap by at most 1, in steps of 0.25.");
  });

  it("groups the register by rule, so the campaigns on one rule are read together, each with both sides", () => {
    const tariff = html.indexOf('data-lobby-group="tariffCapPct"'), tax = html.indexOf('data-lobby-group="salesTaxPct"');
    expect(tariff).toBeGreaterThan(-1);
    expect(tax).toBeGreaterThan(-1);
    const tariffBlock = html.slice(tariff, tax > tariff ? tax : undefined);
    expect(tariffBlock).toContain('data-lobby-campaign="lob-1"');
    expect(tariffBlock).toContain('data-lobby-campaign="lob-3"'); // both tariff-cap campaigns, raise and lower, together
    expect(html).toMatch(/lobby-side--for">For<\/span> Helios<\/p><p><span class="lobby-side lobby-side--against">Against<\/span> Kestrel/);
    expect(html).not.toContain('data-lobby-campaign="lob-4"'); // an ITC campaign is at the ITC
  });

  it("shows amounts only on the caller's own pledges, and a pledge form only while pledges are taken", () => {
    expect(html).toContain("Your pledges: for, 20,000 credits");
    expect(html).not.toMatch(/Helios[^<]*credits/);
    expect(html).toMatch(/data-form="lobby-pledge" data-campaign-id="lob-2"/);
    expect(html).not.toMatch(/data-form="lobby-pledge" data-campaign-id="lob-1"/);
  });

  it("refuses to open without the standing, saying how much is needed", () => {
    const poor = lobbyingOfficeHtml({ office: { ...office, standing: { "earth-assembly": 12 } }, faction: "earth-assembly", form });
    expect(poor).toContain("Opening a campaign needs 20 standing with the Earth Assembly; you have 12.");
    expect(poor).toMatch(/<button type="submit" class="ui-button ui-button--primary" disabled>Open campaign<\/button>/);
  });
});

describe("a campaign's status in the guide's vocabulary (ISP-252, AB#948)", () => {
  it("is Pending while it gathers pledges, Active in force, Expired after, and Failed when it moved nothing", async () => {
    const { campaignStatus } = await import("../../public/scripts/lobbyingOffice.js");
    const endsAt = Date.UTC(2026, 9, 4, 12, 0);
    expect(campaignStatus({ state: "pledging" })).toMatchObject({ plain: "Pending", protocol: "Filed, awaiting pledges" });
    expect(campaignStatus({ state: "in-force", result: { from: 3, to: 3.5, endsAt } })).toMatchObject({ plain: "Active", protocol: "In force until 2147-10-04 12:00 UTC" });
    expect(campaignStatus({ state: "ended", result: { from: 3, to: 3.5, endsAt } })).toMatchObject({ plain: "Expired", protocol: "Lapsed 2147-10-04 12:00 UTC" });
    expect(campaignStatus({ state: "in-force", result: { from: 3, to: 3, endsAt } }).plain).toBe("Failed");
  });
});
