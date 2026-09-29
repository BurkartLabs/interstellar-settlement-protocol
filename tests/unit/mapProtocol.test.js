import { describe, it, expect, afterEach } from "vitest";
import { concessionDetailsHtml, holderPart } from "../../public/scripts/concessionOverlay.js";
import { setSectionCodes } from "../../public/scripts/sectionCodes.js";

// ISP-255 slice c2 (AB#4831): the Map group's records carry the protocol line (public/scripts/protocol.js) after their
// plain words, with the Starmap's code (ISA-NAV-1): a petition under review is Filed, awaiting review; a held concession In force, a discount waiting out its notice Lodged.
const CODES = { screens: [{ id: "starmap", code: "ISA-NAV-1" }] };
const LINE = (phrase) => `<span class="protocol-line">${phrase}<span class="protocol-line__code" aria-hidden="true"> // ISA-NAV-1</span></span>`;
const T = Date.UTC(2026, 9, 4, 7);
afterEach(() => setSectionCodes(null));

describe("the Map's statuses carry their protocol line (AB#4831)", () => {
  it("a petition under review is Filed, awaiting review, in public and to its petitioner", () => {
    setSectionCodes(CODES);
    const summary = { concedable: true, holders: [], petitions: [{ name: "Kestrel Mining", kind: "petition", reviewEndsAt: T }] };
    const control = { rule: "Standard", stale: false, others: 0, holders: [] };
    expect(concessionDetailsHtml(summary, control, null)).toContain(`${LINE("Filed, awaiting review")}</strong></li>`);
    const status = { holder: { type: "corp", name: "Nova Freight" }, eligible: true, streakDays: 14, needDays: 14, petition: { kind: "petition", open: { reviewEndsAt: T } } };
    expect(concessionDetailsHtml(summary, control, status)).toMatch(new RegExp(`Your petition is under review until [^<]+\\. ${LINE("Filed, awaiting review").replace(/[/()]/g, "\\$&")}</p>`));
  });

  it("a held concession is In force, and a discount waiting out its notice Lodged", () => {
    setSectionCodes(CODES);
    const holds = { state: "granted", termEndsAt: T, upkeepToday: 552, feeShareCollected: 9_000, feeSharePct: 20, ownLeaseDiscountPct: 25, leaseDiscountPct: 10, leaseDiscountMaxPct: 25, noticeHours: 72, pendingLeaseDiscount: { pct: 20, effectiveAt: T } };
    const html = holderPart(holds, "Halcyon Mining");
    expect(html).toContain(`Active ${LINE("In force")}`);
    expect(html).toMatch(new RegExp(`waiting out its notice until [^<]+\\. ${LINE("Lodged").replace(/[/()]/g, "\\$&")}`));
    expect(holderPart({ ...holds, state: "grace", graceSince: T }, "Halcyon Mining")).not.toContain("protocol-line\">In force"); // Suspended says itself
  });
});
