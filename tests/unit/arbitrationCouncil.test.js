import { describe, it, expect } from "vitest";
import { caseStatus, chambersHtml, docketHtml, evidenceHtml, filingHtml, isaTime, runs } from "../../public/scripts/arbitrationCouncil.js";

// ISP-243 (AB#939): the Arbitration Council's chambers as HTML: the filing wizard's steps, a case with its ruling, and
// the public docket, in the ISA's voice (docs/design/BUREAUCRATIC_UI.md).
const H = 3_600_000;
const T = Date.UTC(2026, 9, 1, 12, 0);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const EVIDENCE = { contract: { id: "merc-1", fleetName: "Vanguard", termHours: 72, price: 60_000, collateral: 15_000, allowedUse: "defense", hiredAt: T - 30 * H, endsAt: T + 42 * H, state: "hired" }, hireReadiness: 100, hourlyReadiness: [100, 100, 100, 100, 90, 90], hoursBelow: 2, refund: 167 };
const PREVIEW = { type: "mercenary-readiness", recordRef: "contract:merc-1", claimant: { type: "corp", id: "c1", name: "Nova Freight" }, respondent: { type: "corp", id: "c2", name: "Kestrel Mining" }, amountClaimed: 167, fee: 1_000, evidence: EVIDENCE, responseHours: 72, freezesEscrow: true };
const CASE = {
  ref: "GAC-2026-000001", type: "mercenary-readiness", claimant: { type: "corp", id: "c1", name: "Nova Freight" }, respondent: { type: "corp", id: "c2", name: "Halcyon Mining" }, state: "closed",
  filedAt: T - 5 * 24 * H, windowEndsAt: T - 2 * 24 * H, decideAt: T - 36 * H, amountClaimed: 6_667, feePaid: 1_000, paid: 6_667, evidence: EVIDENCE, debts: [],
  ruling: { outcome: "upheld", amount: 6_667, order: null, at: T - 36 * H, text: "GAC-2026-000001. Readiness below hire readiness (90) for 48 of 72 contract hours. Upheld: 6,667 credits awarded to Nova Freight. The filing fee of 1,000 credits is returned to the claimant." }
};
const ctx = { now: T, isMe: (p) => p.id === "c1", open: CASE.ref };

describe("the Council's chambers (AB#939)", () => {
  it("writes times in the ISA's year, in UTC, with the real instant for machines", () => {
    expect(isaTime(T)).toBe('<time datetime="2026-10-01T12:00:00.000Z">2147-10-01 12:00 UTC</time>');
    expect(runs([100, 100, 90, 90, 90, 70])).toBe("100 ×2, 90 ×3, 70 ×1");
  });

  it("walks the wizard: claim type, then the record, then the evidence with the rule beside it, then the fee", () => {
    const t1 = text(filingHtml({ type: null, records: null }, ctx));
    expect(t1).toContain("Mercenary readiness");
    expect(t1).not.toContain("2 Record");
    expect(filingHtml({ type: null }, ctx)).toMatch(/value="credit-default" disabled/); // the ISA files these
    expect(text(filingHtml({ type: "tariff-overcharge", records: [] }, ctx))).toContain("No record to file on.");
    const html = filingHtml({ type: "mercenary-readiness", records: [{ recordId: "merc-1", fleetName: "Vanguard", owner: "Kestrel Mining", hiredAt: T - 30 * H, endsAt: T + 42 * H, state: "hired" }], recordId: "merc-1", preview: PREVIEW }, ctx);
    const t3 = text(html);
    for (const s of ["Vanguard, hired from Kestrel Mining", "Evidence the Council will attach", "Respondent Kestrel Mining", "Amount claimed 167 credits", "hour by hour 100 ×4, 90 ×2", "The rule Upheld if the owner", "Filing costs 1,000 credits", "Filing holds the contract", "File case (1,000 credits)"]) expect(t3).toContain(s);
    expect(html).not.toMatch(/<input[^>]*type="text"|<textarea/); // no free text anywhere
  });

  it("shows a party its case: status in the plain word and the protocol phrase, the evidence, and the ruling in the Council's words", () => {
    const t = text(chambersHtml({ state: { type: null }, cases: [CASE], docket: [] }, ctx));
    for (const s of ["GAC-2026-000001", "Mercenary readiness: Nova Freight v. Halcyon Mining", "Complete", "Upheld: 6,667 credits", "Concluded 2147-09-30 00:00 UTC", "You are the claimant", "Evidence as filed (the parties only)", "Readiness below hire readiness (90) for 48 of 72 contract hours"]) expect(t).toContain(s);
    expect(caseStatus({ state: "answering", decideAt: T }).plain).toBe("Pending");
  });

  it("offers the respondent its cure inside the window, and nobody else", () => {
    const pending = { ...CASE, state: "answering", ruling: null, windowEndsAt: T + 2 * H };
    const asRespondent = { ...ctx, isMe: (p) => p.id === "c2" };
    expect(chambersHtml({ state: {}, cases: [pending], docket: [] }, asRespondent)).toMatch(/data-role="gac-cure"/);
    expect(text(chambersHtml({ state: {}, cases: [pending], docket: [] }, asRespondent))).toContain("closes in 2 h 0 min");
    expect(chambersHtml({ state: {}, cases: [pending], docket: [] }, ctx)).not.toMatch(/data-role="gac-cure"/);
  });

  it("draws the public docket from its public fields only", () => {
    const t = text(docketHtml([{ ref: "GAC-2026-000002", type: "tariff-overcharge", claimant: "Drift Salvage", respondent: "Halcyon Mining", state: "closed", ruling: { outcome: "dismissed", amount: 0 }, amountClaimed: 0, filedAt: T, paid: 0 }], ctx));
    expect(t).toContain("GAC-2026-000002 Complete Dismissed Tariff overcharge: Drift Salvage v. Halcyon Mining Filed 2147-10-01 12:00 UTC");
    expect(evidenceHtml("tariff-overcharge", null)).toBe("");
  });
});
