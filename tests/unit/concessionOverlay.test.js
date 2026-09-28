import { describe, it, expect } from "vitest";
import { ISA_TOKEN, concessionDetailsHtml, concessionKey, concessionLegendHtml, holderPart } from "../../public/scripts/concessionOverlay.js";
import { LEADER_TOKENS, OWN_TOKEN, QUIET_TOKEN } from "../../public/scripts/dominanceOverlay.js";

// ISP-229 (AB#924): the Concessions overlay and the system panel's concession section, as data and HTML. A fixture world
// with two holders and one petition under review, as GET /api/starmap/concessions returns it.
const T = Date.UTC(2026, 9, 1, 12, 0);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const WORLD = { systems: {
  sol: { concedable: false, holders: [], petitions: [] },
  "alpha-centauri": { concedable: true, holders: [{ name: "Halcyon Mining", type: "corp", state: "granted", termEndsAt: T + 30 * 86_400_000 }], petitions: [] },
  "luyten-726-8": { concedable: true, holders: [{ name: "Serpent Pact", type: "conglomerate", state: "grace", termEndsAt: T + 10 * 86_400_000 }], petitions: [] },
  "barnards-star": { concedable: true, holders: [], petitions: [{ kind: "petition", name: "Kestrel Mining", type: "corp", reviewEndsAt: T + 67 * 3_600_000 }] },
  "ross-248": { concedable: true, holders: [], petitions: [] }
} };

describe("the Concessions overlay (AB#924)", () => {
  it("colours each system by its holder, the viewer's own first, and marks the petition under review", () => {
    const key = concessionKey(WORLD, ["Halcyon Mining"]);
    expect(key.bySystem["alpha-centauri"]).toMatchObject({ token: OWN_TOKEN, holder: "Halcyon Mining", own: true });
    expect(key.bySystem["luyten-726-8"]).toMatchObject({ token: LEADER_TOKENS[0], holder: "Serpent Pact", grace: true });
    expect(key.bySystem["barnards-star"]).toMatchObject({ token: QUIET_TOKEN, holder: null, pending: true });
    expect(key.bySystem.sol).toMatchObject({ token: ISA_TOKEN, isa: true });
    expect(key.legend.map((e) => [e.key, e.systems])).toEqual([
      ["holder:Halcyon Mining", 1], ["holder:Serpent Pact", 1], ["open", 2], ["isa", 1], ["pending", 1]
    ]);
  });

  it("names every mark in the legend, never colour alone", () => {
    const t = text(concessionLegendHtml(concessionKey(WORLD, ["Halcyon Mining"])));
    for (const s of ["You: Halcyon Mining · 1 system", "Serpent Pact · 1 system", "No concession: open to petition · 2 systems", "ISA administered: never conceded · 1 system", "Petition under review · 1 system", "never ownership"]) expect(t).toContain(s);
  });
});

describe("a system's concession section (AB#924)", () => {
  const control = { rule: "Standard", stale: false, others: 0, holders: [{ name: "Kestrel Mining", type: "corp", score: 70, eligible: true }, { name: "Drift Salvage", type: "corp", score: 30, eligible: false }] };

  it("shows the holder, the control scores with eligibility, and the petition under review", () => {
    const t = text(concessionDetailsHtml(WORLD.systems["barnards-star"], control, null));
    for (const s of ["Rule: Standard", "No concession is held here.", "Kestrel Mining Eligible 70%", "Drift Salvage 30%", "Kestrel Mining · petition", "review ends 2147-10-04 07:00 UTC"]) expect(t).toContain(s);
  });

  it("offers an eligible viewer the petition with its fee, and a refused one the reason instead", () => {
    const status = { holder: { type: "corp", name: "Nova Freight" }, eligible: true, streakDays: 14, needDays: 14, petition: { kind: "petition", fee: 25_000, upkeepIfGranted: 290, concessionsAfter: 1, refusal: null, open: null } };
    const html = concessionDetailsHtml(WORLD.systems["ross-248"], control, status);
    expect(html).toMatch(/data-role="concession-petition"[^>]*data-upkeep="290"/);
    expect(html).not.toMatch(/data-role="concession-petition"[^>]*disabled/);
    expect(text(html)).toContain("eligible on 14 of the last 14 days (eligible now)");
    const refused = concessionDetailsHtml(WORLD.systems["ross-248"], control, { ...status, eligible: false, petition: { ...status.petition, refusal: "A petition needs 40% control." } });
    expect(refused).toMatch(/data-role="concession-petition"[^>]*disabled/);
    expect(text(refused)).toContain("A petition needs 40% control.");
  });

  it("gives the holder its management view: upkeep, fee share, the discount and its notice", () => {
    const holds = { state: "granted", termEndsAt: T, upkeepToday: 552, feeShareCollected: 9_000, feeSharePct: 20, ownLeaseDiscountPct: 25, leaseDiscountPct: 10, leaseDiscountMaxPct: 25, noticeHours: 72, pendingLeaseDiscount: { pct: 20, effectiveAt: T + 3 * 86_400_000 } };
    const html = holderPart(holds, "Halcyon Mining");
    const t = text(html);
    for (const s of ["552 credits a day", "9,000 credits so far", "10% off, 20% from 2147-10-04 12:00 UTC", "waiting out its notice"]) expect(t).toContain(s);
    expect(html).toMatch(/name="discountPct" disabled/);
    expect(html.match(/<option/g)).toHaveLength(26);
  });

  it("says a never-concedable system is ISA administered, with its reason", () => {
    expect(text(concessionDetailsHtml(WORLD.systems.sol, { rule: "Every corporation is founded at Earth Station Prime." }, null))).toContain("ISA administered: never conceded. Every corporation is founded");
  });
});

describe("the concession grant's reference (ISP-252, AB#948)", () => {
  it("draws each holder's CSN reference beside its name, as the guide's reference component", () => {
    const summary = { concedable: true, holders: [{ name: "Halcyon Mining", type: "corp", state: "granted", termEndsAt: T, ref: "CSN-2147-7Q2K4M" }], petitions: [] };
    expect(concessionDetailsHtml(summary, null, null, [])).toContain('<span class="ref-no">CSN-2147-7Q2K4M</span>');
  });
});
