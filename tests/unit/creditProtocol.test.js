import { describe, it, expect, afterEach } from "vitest";
import { seriesBadge } from "../../public/scripts/bondBoard.js";
import { borrowedLoansHtml, lentLoansHtml } from "../../public/scripts/loanBoard.js";
import { bankLoansHtml } from "../../public/scripts/devBank.js";
import { setSectionCodes } from "../../public/scripts/sectionCodes.js";

// ISP-255 (AB#4824, slice b): the Credit group's records carry the protocol line (public/scripts/protocol.js) after
// their plain words. The Bank's own screens and its Bond Board use the Bank's code (ISA-FIN-1); the Loan Board its own
// (ISA-FIN-4). Where the plain word already is the guide's phrase ("In arrears", "Lapsed"), nothing is repeated.
const T = Date.UTC(2026, 8, 27, 12, 0);
const CODES = { drawn: [{ id: "building-deep-space-development-bank", code: "ISA-FIN-1" }, { id: "loans-board", code: "ISA-FIN-4" }] };
const LINE = (phrase, code) => `<span class="protocol-line">${phrase}<span class="protocol-line__code" aria-hidden="true"> // ${code}</span></span>`;
afterEach(() => setSectionCodes(null));

describe("the Credit group's statuses carry their protocol line (AB#4824)", () => {
  it("a bond series: Lodged while subscribing, In force when current, Unsuccessful in default, Concluded when redeemed", () => {
    setSectionCodes(CODES);
    const badge = (state) => seriesBadge({ state });
    expect(badge("subscribing")).toContain(`Subscribing</span> ${LINE("Lodged", "ISA-FIN-1")}`);
    expect(badge("live")).toContain(`Current</span> ${LINE("In force", "ISA-FIN-1")}`);
    expect(badge("defaulted")).toContain(`Defaulted</span> ${LINE("Unsuccessful", "ISA-FIN-1")}`);
    expect(badge("redeemed")).toContain(`Redeemed</span> ${LINE("Concluded", "ISA-FIN-1")}`);
    expect(badge("arrears")).not.toContain("protocol-line"); // "In arrears" is the phrase already
    expect(badge("lapsed")).not.toContain("protocol-line");
  });

  it("a player loan on the Loan Board: In force, Concluded, Unsuccessful in default; a pending sale and a cancelled one", () => {
    setSectionCodes(CODES);
    const loan = { id: "loan-p-1", principal: 20_000, ratePct30: 3, termDays: 30, dailyPayment: 750, balance: 18_000, arrears: 0, state: "active", paymentsMade: 4, borrowerName: "Nadir Mining", borrowerGrade: "BB", lenderName: "Helios Freight", nextDueAt: T };
    expect(lentLoansHtml([loan])).toContain(`Current</span> ${LINE("In force", "ISA-FIN-4")}`);
    expect(lentLoansHtml([{ ...loan, state: "repaid" }])).toContain(`Repaid</span> ${LINE("Concluded", "ISA-FIN-4")}`);
    const defaulted = { ...loan, state: "arrears", arrears: 1_500, arrearsSince: T, defaultedAt: T };
    expect(lentLoansHtml([defaulted])).toContain(`In default</span> ${LINE("Unsuccessful", "ISA-FIN-4")}`);
    expect(lentLoansHtml([{ ...loan, state: "arrears", arrears: 1_500, arrearsSince: T }])).not.toMatch(/In arrears<\/span> <span class="protocol-line"/);
    expect(borrowedLoansHtml([{ ...defaulted, recovery: { state: "grace", saleAt: T } }])).toContain(`UTC.</strong> ${LINE("Filed, awaiting review", "ISA-FIN-4")}`);
    expect(lentLoansHtml([{ ...defaulted, recovery: { state: "cancelled" } }])).toContain(`paid in time ${LINE("Withdrawn", "ISA-FIN-4")}`);
  });

  it("a Bank facility: Current is In force, a repaid one Concluded, at the Bank", () => {
    setSectionCodes(CODES);
    const loan = { id: "loan-1", principal: 63_000, ratePct30: 5, termDays: 30, dailyPayment: 2_155, lastPayment: 2_147, balance: 52_526, paymentsMade: 5, nextDueAt: T, arrears: 0, arrearsSince: null, state: "active" };
    expect(bankLoansHtml([loan], T)).toContain(`Current</span> ${LINE("In force", "ISA-FIN-1")}`);
    expect(bankLoansHtml([{ ...loan, state: "repaid", closedAt: T }], T)).toMatch(new RegExp(`repaid [^<]+ ${LINE("Concluded", "ISA-FIN-1").replace(/[/()]/g, "\\$&")}</li>`));
  });
});
