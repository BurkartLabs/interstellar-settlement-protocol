import { describe, it, expect } from "vitest";
import { TERMS_HOURS, USES, myContractsHtml, offerFormHtml, offerPreview, offersTableHtml } from "../../public/scripts/mercenaryView.js";
import { CONTRACT_RULES } from "../../server/mercenaries.js";
import { UNITS_DATA } from "../../server/game/units.js";

// ISP-177 (AB#871): the Mercenary Rentals panel's markup.
const CATALOG = UNITS_DATA.units;
const NOW = Date.UTC(2026, 8, 27, 12);
const HOUR = 3_600_000;
const offer = (over = {}) => ({
  id: "m1", state: "open", fleetName: "Corsair", ownerName: "Vega Freight", units: { lf: 8, ds: 2 }, attack: 64, defense: 88, readiness: 70,
  termHours: 24, price: 5000, collateral: 15000, allowedUse: "defense", mine: false, expiresAt: NOW + 48 * HOUR, ...over
});

describe("the offers table (AB#871)", () => {
  it("shows each offer's units by type, attack and defense, term, price, collateral and allowed use, with Hire", () => {
    const html = offersTableHtml([offer(), offer({ id: "m2", fleetName: "Talon", units: { se: 1, at: 3 }, termHours: 12, allowedUse: "raids" })], CATALOG);
    expect(html).toContain("8 Light Fighters, 2 Destroyers");
    expect(html).toContain("1 Siege Engine, 3 squads of Attack Troops");
    expect(html).toContain("64 ATK / 88 DEF");
    expect(offersTableHtml([offer({ attack: 316, defense: 1320 })], CATALOG)).toContain("316 ATK / 1,320 DEF");
    expect(html).toContain(">70%<"); // the owner's readiness, which a hired fleet fights at (AB#859 section 7)
    expect(html).toContain("1 day");
    expect(html).toContain("12 hours");
    expect(html).toContain("¤5,000");
    expect(html).toContain("¤15,000");
    expect(html).toContain("Defense only");
    expect(html).toContain("Raids, PvE and defense");
    expect(html.match(/data-merc-hire=/g)).toHaveLength(2);
    // every cell carries its label for the phone card layout
    for (const td of html.match(/<td\b[^>]*>/g)) expect(td).toContain("data-label=");
  });
  it("offers no Hire on the caller's own offer, and says so when there is nothing for hire", () => {
    expect(offersTableHtml([offer({ mine: true })], CATALOG)).not.toContain("data-merc-hire");
    expect(offersTableHtml([], CATALOG)).toContain("No fleets for hire");
  });
  it("escapes what players name", () => {
    expect(offersTableHtml([offer({ fleetName: "<b>x</b>", ownerName: "<i>" })], CATALOG)).not.toMatch(/<b>x|<i>/);
  });
});

describe("the offer form (AB#871)", () => {
  it("has the server's terms and uses, and previews the income and what a renter posts", () => {
    expect(TERMS_HOURS).toEqual(CONTRACT_RULES.termsHours);
    expect(USES.map(([id]) => id)).toEqual(CONTRACT_RULES.uses);
    const p = offerPreview({ termHours: 72, price: 9000, collateral: 12000, value: 19468 });
    expect(p).toMatchObject({ income: 9000, perDay: 3000, renterPosts: 21000 });
    expect(p.text).toContain("You earn ¤9,000");
    expect(p.text).toContain("A renter posts ¤21,000");
    expect(p.text).toContain("¤19,468");
  });
  it("offers only fleets that are stationed and free, and caps the collateral at the fleet's value", () => {
    const fleets = [
      { id: "a", name: "Aegis", units: { lf: 4 } },
      { id: "b", name: "Talon", units: { lf: 1 }, transit: { arrivesAt: NOW + HOUR } },
      { id: "c", name: "Bastion", units: { ds: 1 }, contract: { offerId: "m1" } }
    ];
    const html = offerFormHtml(fleets, (f) => ({ a: 6000 })[f.id] || 0, CATALOG, NOW);
    expect(html).toContain("Aegis");
    expect(html).not.toContain("Talon");
    expect(html).not.toContain("Bastion");
    expect(html).toContain('max="6000"');
    expect(html).toContain('value="6000" data-merc-collateral');
    expect(offerFormHtml([fleets[1]], () => 0, CATALOG, NOW)).toContain("None of your fleets can be offered");
  });
});

describe("my contracts (AB#871)", () => {
  it("shows an active contract's time left and escrow, and a finished one's losses and settlement", () => {
    const hired = { ...offer(), state: "hired", renterName: "Orion Mining", endsAt: NOW + 5 * HOUR, escrow: 20000 };
    const done = { ...offer({ id: "m3" }), state: "completed", renterName: "Orion Mining", lost: { lf: 3 }, settlement: { price: 5000, compensation: 4200, refund: 10800 } };
    const html = myContractsHtml({ offered: [hired, done], hired: [{ ...hired, id: "m4" }] }, CATALOG, NOW);
    expect(html).toContain("Hired by Orion Mining");
    expect(html).toContain("From Vega Freight");
    expect(html).toContain("left. Escrow holds ¤20,000");
    expect(html).toMatch(/5 ?h/);
    expect(html).toContain("Lost: 3 Light Fighters");
    expect(html).toContain("collateral ¤4,200 paid for losses, ¤10,800 returned to the renter");
  });
  it("lets the owner withdraw an open offer, and says when either side is empty", () => {
    expect(myContractsHtml({ offered: [offer()], hired: [] }, CATALOG, NOW)).toContain("data-merc-withdraw=\"m1\"");
    const empty = myContractsHtml({ offered: [], hired: [] }, CATALOG, NOW);
    expect(empty).toContain("None of your fleets is on offer.");
    expect(empty).toContain("You have not hired a fleet.");
  });
});
