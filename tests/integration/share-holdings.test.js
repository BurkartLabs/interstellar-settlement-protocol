import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getAllAccountIds, mutateAccountState, getStatements } from "../../server/gameState.js";
import { registryProblems, valuePerShare, exitPrice } from "../../server/shareRegistry.js";
import { holdingsOfAccount, exitShares } from "../../server/shareOfferings.js";
import { postLoanOffer, acceptLoanOffer } from "../../server/playerLoans.js";
import { recoverDefault } from "../../server/defaultRecovery.js";
import { ledgerEntries } from "../../server/settlement.js";

// ISP-160 (AB#854): a holding is worth the Board's value per share (company value / shares outstanding, D-0.9-3 on
// AB#704), counts in the investor's balance sheet, and exits to the IGSX market maker at floor(value x 0.95)
// (docs/design/v0.9-equity.md, sections 1, 5 and 8).
const DAY = 86_400_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });
afterEach(() => {
  const bad = getAllAccountIds().map((id) => getAccountById(id)?.state?.corp).filter(Boolean)
    .map((c) => [c.corporationName, registryProblems(c.shareRegistry)]).filter(([, p]) => p.length);
  expect(bad).toEqual([]); // the registry invariant, over every corporation, after every test
});

let seq = 0;
async function corp({ credits = 0, level = 15 } = {}) {
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => { s.corp.finances.credits = credits; s.corp.level = level; }, { sanitize: false, settleMining: false });
  const c = () => getAccountById(account.id).state.corp;
  return { id: account.id, api: authed(app, accessToken), base: `/api/accounts/${account.id}`, corp: c, credits: () => Math.round(c().finances.credits) };
}
/** The issuer's latest closed statement says it is worth `netWorth` (a newer one each call). */
function setNetWorth(issuer, netWorth) {
  const dayStart = Math.floor(Date.now() / DAY) * DAY - DAY + ++seq; // closed, and newer than the last one set
  mutateAccountState(issuer.id, (s) => {
    s.statements = [...(s.statements || []), { day: "fixture", dayStart, pnl: { net: 0 }, cashFlow: {}, balanceSheet: { credits: 0, facilities: 0, inventory: 0, liabilities: 0, totalAssets: netWorth, netWorth } }];
  }, { sanitize: false, settleMining: false });
}
/** `investor` holds `shares` of `issuer`, bought at `price` each (a fixture that keeps the invariant). */
function hold(investor, issuer, shares, price) {
  const investorCorpId = investor.corp().publicId;
  mutateAccountState(issuer.id, (s) => {
    s.corp.shareRegistry.state = "listed";
    s.corp.shareRegistry.holders.push({ holder: { kind: "corp", corpId: investorCorpId }, shares, costBasis: shares * price, dividendsReceived: 0, acquiredAt: 1 });
    s.corp.shareRegistry.unissued -= shares;
  }, { sanitize: false, settleMining: false });
  mutateAccountState(investor.id, (s) => { s.corp.holdingIndex = [...new Set([...(s.corp.holdingIndex || []), issuer.corp().publicId])]; }, { sanitize: false, settleMining: false });
}

describe("what a holding is worth (AB#854)", () => {
  it("is company value / shares outstanding, rising and falling with the issuer, below cost when it falls", async () => {
    const issuer = await corp(), investor = await corp();
    hold(investor, issuer, 1_000, 120); // cost 120,000; outstanding 11,000
    setNetWorth(issuer, 1_320_000);
    const at = () => holdingsOfAccount(investor.id)[0];
    expect(at()).toMatchObject({ shares: 1_000, valuePerShare: 120, value: 120_000, costBasis: 120_000 });
    setNetWorth(issuer, 2_640_000);
    expect(at()).toMatchObject({ valuePerShare: 240, value: 240_000 });
    setNetWorth(issuer, 660_000);
    expect(at().value).toBe(60_000);
    expect(at().value).toBeLessThan(at().costBasis); // investors can lose money (Board, AB#704)
    setNetWorth(issuer, -50_000);
    expect(at()).toMatchObject({ valuePerShare: 0, value: 0, exitPrice: 0 });
    expect(valuePerShare(1_320_000, 11_000)).toBe(120);
    expect(exitPrice(120)).toBe(114);
  });

  it("counts in the investor's balance sheet at that value", async () => {
    const issuer = await corp(), investor = await corp({ credits: 50_000 });
    hold(investor, issuer, 1_000, 120);
    setNetWorth(issuer, 1_320_000);
    mutateAccountState(investor.id, (s) => { s.corp.finances.dayBook = { dayStart: Math.floor(Date.now() / DAY) * DAY - DAY, opening: 50_000, income: {}, expenses: {} }; }, { sanitize: false, settleMining: false });
    const [latest] = getStatements(investor.id, 1).statements; // closes yesterday
    expect(latest.balanceSheet.holdings).toBe(120_000);
    expect(latest.balanceSheet.totalAssets).toBe(latest.balanceSheet.credits + latest.balanceSheet.facilities + latest.balanceSheet.inventory + 120_000);
    expect(latest.balanceSheet.netWorth).toBe(latest.balanceSheet.totalAssets - latest.balanceSheet.liabilities);
  });
});

describe("the exit to the market maker (AB#854)", () => {
  it("pays floor(value x 0.95) per share from the market maker's tap, ignoring any price in the request", async () => {
    const issuer = await corp(), investor = await corp({ credits: 10_000 });
    hold(investor, issuer, 1_000, 120);
    setNetWorth(issuer, 1_320_000); // 120 a share, 114 at the exit
    const res = await investor.api.post(`${investor.base}/equity/holdings/${issuer.corp().publicId}/exit`).send({ quantity: 50, pricePerShare: 999_999, price: 1, paid: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ shares: 50, valuePerShare: 120, pricePerShare: 114, paid: 5_700 });
    expect(investor.credits()).toBe(10_000 + 5_700);
    const reg = issuer.corp().shareRegistry;
    expect(reg.holders.find((h) => h.holder.corpId === investor.corp().publicId).shares).toBe(950);
    expect(reg.holders.find((h) => h.holder.kind === "npc").shares).toBe(50);
    expect(ledgerEntries().some((e) => e.from === "tap:igsx" && e.to === investor.id && e.credits === 5_700 && e.reason === "share-purchase")).toBe(true);
    const list = await investor.api.get(`${investor.base}/equity/holdings`);
    expect(list.body.holdings[0]).toMatchObject({ shares: 950, valuePerShare: 120, exitPrice: 114 });
  });

  it("takes at most 1% of shares outstanding a day across sellers, and a full exit clears the holding", async () => {
    const issuer = await corp(), a = await corp(), b = await corp();
    hold(a, issuer, 500, 100);
    hold(b, issuer, 100, 100); // outstanding 10,600: the market maker takes at most 106 a day
    setNetWorth(issuer, 1_060_000);
    const now = Date.now();
    expect(exitShares(a.id, { issuerCorpId: issuer.corp().publicId, quantity: 80 }, now).ok).toBe(true);
    const over = exitShares(b.id, { issuerCorpId: issuer.corp().publicId, quantity: 30 }, now);
    expect(over).toMatchObject({ ok: false, error: expect.stringMatching(/at most 26 more shares/) });
    expect(exitShares(b.id, { issuerCorpId: issuer.corp().publicId, quantity: 26 }, now).ok).toBe(true);
    expect(exitShares(b.id, { issuerCorpId: issuer.corp().publicId, quantity: 74 }, now + DAY).ok).toBe(true); // the next day
    expect(b.corp().holdingIndex).not.toContain(issuer.corp().publicId);
    expect(issuer.corp().shareRegistry.holders.some((h) => h.holder.corpId === b.corp().publicId)).toBe(false);
  });

  it("refuses when the issuer is worth nothing, for a holding one does not have, and for its own shares", async () => {
    const issuer = await corp(), investor = await corp();
    hold(investor, issuer, 100, 100);
    setNetWorth(issuer, 0);
    expect(exitShares(investor.id, { issuerCorpId: issuer.corp().publicId, quantity: 10 })).toMatchObject({ ok: false, error: expect.stringMatching(/worth nothing/) });
    setNetWorth(issuer, 1_010_000);
    expect(exitShares(investor.id, { issuerCorpId: issuer.corp().publicId, quantity: 101 })).toMatchObject({ ok: false, error: expect.stringMatching(/You hold 100 shares/) });
    expect(exitShares(issuer.id, { issuerCorpId: issuer.corp().publicId, quantity: 1 }).ok).toBe(false);
  });
});

describe("share holdings in default recovery (AB#854, Board AB#702)", () => {
  it("sells a defaulting holder's shares to the market maker at the exit price, past its daily limit", async () => {
    const issuer = await corp(), lender = await corp({ credits: 100_000 }), debtor = await corp({ credits: 0 });
    const T0 = Date.now();
    const offer = postLoanOffer(lender.id, { principal: 20_000, ratePct30: 3, termDays: 30, minGrade: "NR-accepted" }, T0);
    const { loan } = acceptLoanOffer(debtor.id, offer.offer.id, T0);
    mutateAccountState(debtor.id, (s) => {
      s.corp.finances.credits = 0;
      s.corp.inventory = {};
      const l = s.corp.loans.find((x) => x.id === loan.id);
      Object.assign(l, { arrearsFees: 0, arrearsInterest: 0, arrearsPrincipal: 2_000, arrears: 2_000, balance: 20_000, state: "arrears", arrearsSince: T0, defaultedAt: T0 + 8 * DAY });
    }, { sanitize: false, settleMining: false });
    hold(debtor, issuer, 1_000, 120);
    setNetWorth(issuer, 1_320_000); // 114 a share at the exit; 22,000 owed takes 193 shares, above the day's 110
    const lenderBefore = lender.credits();
    const r = recoverDefault(debtor.id, loan.id, T0 + 10 * DAY);
    expect(r).toMatchObject({ ok: true, collected: 22_000, shortfall: 0 });
    expect(r.sold.find((s) => s.kind === "shares")).toMatchObject({ name: expect.stringMatching(/^193 shares of /), credits: 193 * 114 });
    expect(r.applied.fromHoldings).toBe(22_000);
    expect(lender.credits() - lenderBefore).toBe(22_000);
    expect(debtor.credits()).toBe(193 * 114 - 22_000); // the surplus stays with the debtor
    expect(issuer.corp().shareRegistry.holders.find((h) => h.holder.corpId === debtor.corp().publicId).shares).toBe(807);
  });
});
