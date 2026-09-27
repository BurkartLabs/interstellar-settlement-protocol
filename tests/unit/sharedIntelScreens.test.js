import { describe, it, expect } from "vitest";
import { DEFAULT_EXCHANGE_VIEW, partnerNames, partnersEmptyHtml, viewOrders } from "../../public/scripts/exchangeView.js";

// starmap.js preloads planet images when it is imported; node has no Image.
globalThis.Image ??= class { set src(_) {} };
const { scoutedBeltHtml } = await import("../../public/scripts/starmap.js");

// ISP-208 (AB#903): shared intel where it is used. The Starmap's belt panel (the expedition picker) names the partner
// who scouted a belt; the Exchange's Sellers filter shows only current partners' listings, and badges them.
const conglomerate = { members: [{ corp: "corp-me", corpName: "Halcyon Freight", role: "founder" }, { corp: "corp-p", corpName: "Meridian  Freight", role: "member" }] };
const orders = [
  { id: "a", item: "Silicates", quantity: 10, unitPrice: 25, seller: "Meridian Freight", createdAt: 3 },
  { id: "b", item: "Silicates", quantity: 99, unitPrice: 20, seller: "Outsider Ltd", createdAt: 2 },
  { id: "c", item: "Nickel", quantity: 5, unitPrice: 90, seller: "meridian freight", createdAt: 1 }
];

describe("the Exchange's Sellers filter (AB#903)", () => {
  it("knows the viewer's partners: every current member but the viewer, whatever the case or spacing", () => {
    expect([...partnerNames(conglomerate, "corp-me")]).toEqual(["meridian freight"]);
    expect(partnerNames(null, "corp-me").size).toBe(0);
  });

  it("shows only current partners' listings when set to My conglomerate, and everyone's otherwise", () => {
    const partners = partnerNames(conglomerate, "corp-me");
    expect(viewOrders(orders, { ...DEFAULT_EXCHANGE_VIEW, sellers: "conglomerate" }, { partners }).map((o) => o.id)).toEqual(["a", "c"]);
    expect(viewOrders(orders, { ...DEFAULT_EXCHANGE_VIEW, sellers: "conglomerate", resource: "Silicates" }, { partners }).map((o) => o.id)).toEqual(["a"]);
    expect(viewOrders(orders, DEFAULT_EXCHANGE_VIEW, { partners }).map((o) => o.id)).toEqual(["a", "b", "c"]);
    // A corporation that left is no longer a partner: the next read of the conglomerate drops it.
    const after = partnerNames({ members: [conglomerate.members[0]] }, "corp-me");
    expect(viewOrders(orders, { ...DEFAULT_EXCHANGE_VIEW, sellers: "conglomerate" }, { partners: after })).toEqual([]);
  });

  it("says when the filter hid every listing, how many, and offers to clear it", () => {
    const html = partnersEmptyHtml(2, "Silicates");
    expect(html).toContain("No player sell orders from your conglomerate's members for <strong>Silicates</strong>");
    expect(html).toContain("hiding 2 listings from other corporations");
    expect(html).toContain("data-clear-filters");
  });
});

describe("the expedition picker names a partner's scouting (AB#903)", () => {
  const view = { key: "sol:belt", generation: 2, rarity: "rich", composition: { Silicates: 60, Nickel: 40 }, reserve: 1000, remaining: 400 };

  it("marks a shared belt with the scouting member's name, and that it can be launched to", () => {
    const html = scoutedBeltHtml({ ...view, sharedBy: ["Meridian Freight"] }, view.composition);
    expect(html).toContain('<span class="ui-badge ui-badge--success">Shared intel</span> Scouted by Meridian Freight, a partner in your conglomerate. You can launch here without scouting it yourself.');
  });

  it("says nothing of sharing for a belt the corporation scouted itself, and escapes names", () => {
    expect(scoutedBeltHtml(view, view.composition)).not.toContain("data-belt-shared");
    expect(scoutedBeltHtml({ ...view, sharedBy: ["<b>X</b>"] }, view.composition)).toContain("&lt;b&gt;X&lt;/b&gt;");
  });
});
