import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState, getStatements } from "../../server/gameState.js";
import { newShareRegistry, registryProblems } from "../../server/shareRegistry.js";
import { dividendFor, dividendTick, largestRemainder, payDividends, setPayoutRatio } from "../../server/dividends.js";
import { ledgerEntries, settlementTotals } from "../../server/settlement.js";

// ISP-159 (AB#853): dividends from performance (docs/design/v0.9-equity.md, section 4), on injected time: the issuer
// is listed 21 days ago with 21 closed statements behind it, so its three weekly periods have all ended.
const DAY = 86_400_000;
const TODAY = () => Math.floor(Date.now() / DAY) * DAY;
const UNITS = [438, 290, 211, 150, 113, 61, 37]; // seven holders of uneven sizes: 1,300 outside, 11,300 outstanding
let app;
beforeAll(async () => { ({ app } = await getApp()); });

async function corporation({ credits = 500_000 } = {}) {
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => { s.corp.finances.credits = credits; }, { sanitize: false, settleMining: false });
  const corp = () => getAccountById(account.id).state.corp;
  return { id: account.id, api: authed(app, accessToken), corp, credits: () => Math.round(corp().finances.credits) };
}

/** A listed issuer with `weeks` of statements (net a day per week) and seven holders; listed `weeks` weeks ago. */
async function issuer(weeks = [3_500, -2_000, 3_500], { credits = 500_000, marketMaker = 0 } = {}) {
  const c = await corporation({ credits });
  const holders = [];
  for (const units of UNITS) holders.push({ ...(await corporation()), units });
  const days = weeks.length * 7;
  const today = TODAY();
  mutateAccountState(c.id, (s) => {
    s.statements = Array.from({ length: days }, (_, i) => {
      const net = weeks[Math.floor(i / 7)];
      return {
        day: new Date(today - (days - i) * DAY).toISOString().slice(0, 10), dayStart: today - (days - i) * DAY,
        pnl: { income: {}, expenses: {}, totalIncome: 30_000, totalExpenses: 30_000 - net, net },
        cashFlow: { opening: 0, inflows: 30_000, outflows: 30_000 - net, closing: 150_000, unrecorded: 0 },
        balanceSheet: { credits: 150_000, facilities: 1_070_000, inventory: 0, liabilities: 20_000, totalAssets: 1_220_000, netWorth: 1_200_000 }
      };
    });
    const r = newShareRegistry();
    r.holders = holders.map((h) => ({ holder: { kind: "corp", corpId: h.corp().publicId }, shares: h.units, costBasis: 0, dividendsReceived: 0, acquiredAt: 1 }));
    if (marketMaker) r.holders.push({ holder: { kind: "npc", id: "igsx-mm" }, shares: marketMaker, costBasis: 0, dividendsReceived: 0, acquiredAt: 1 });
    r.unissued = 100_000 - 10_000 - 1_300 - marketMaker;
    Object.assign(r, { state: "listed", listedAt: today - days * DAY });
    s.corp.shareRegistry = r;
  }, { sanitize: false, settleMining: false });
  getStatements(c.id);
  expect(registryProblems(c.corp().shareRegistry)).toEqual([]);
  const listedAt = today - days * DAY;
  const paidIn = (k) => ledgerEntries().filter((e) => e.key.startsWith(`dividend:${c.corp().publicId}:${listedAt + k * 7 * DAY}:`));
  return { ...c, holders, listedAt, paidIn };
}
/** Each holder's exact share, rounded down, and the leftover to the largest remainders: an independent reckoning. */
function expectedSplit(total, shares) {
  const sum = shares.reduce((a, b) => a + b, 0);
  const exact = shares.map((s) => (total * s) / sum);
  const parts = exact.map(Math.floor);
  const order = exact.map((e, i) => [e - Math.floor(e), shares[i], i]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const left = total - parts.reduce((a, b) => a + b, 0);
  for (let k = 0; k < left; k++) parts[order[k][2]]++;
  return parts;
}

describe("ISP-159 the formula", () => {
  it("earns, loses, earns: pays the formula amount, nothing, then the formula amount", async () => {
    const c = await issuer();
    const records = payDividends(c.id, Date.now());
    expect(records.map((r) => [r.netIncome7, r.pool, r.toHolders, r.paid])).toEqual([
      [24_500, 6_125, 704, 704], // 25% of 24,500; 1,300 of 11,300 shares are outside: floor(6,125 x 1,300 / 11,300)
      [-14_000, 0, 0, 0],
      [24_500, 6_125, 704, 704]
    ]);
    expect(records[1].reason).toBe("no profit this week");
    expect(c.paidIn(1).reduce((a, e) => a + e.credits, 0)).toBe(704);
    expect(c.paidIn(2)).toEqual([]);
    expect(c.paidIn(3).every((e) => e.reason === "dividend" && e.from === c.id)).toBe(true);
    expect(c.corp().shareRegistry).toMatchObject({ lastDividendAt: c.listedAt + 21 * DAY });
    expect(c.corp().shareRegistry.dividendHistory).toHaveLength(3);
  });

  it("seven uneven holders: the parts sum to the formula to the credit, by largest remainder", async () => {
    const c = await issuer([3_500]);
    payDividends(c.id, Date.now());
    const want = expectedSplit(704, UNITS);
    const got = c.holders.map((h) => c.paidIn(1).find((e) => e.to === h.id)?.credits ?? 0);
    expect(got).toEqual(want);
    expect(got.reduce((a, b) => a + b, 0)).toBe(704);
    // what each holder received is on its row, and on its statements as income; the issuer's is financing, not a cost
    c.holders.forEach((h, i) => {
      expect(c.corp().shareRegistry.holders[i].dividendsReceived).toBe(want[i]);
      expect(h.corp().finances.incomeBySource["dividend-received"]).toBe(want[i]);
    });
    expect(c.corp().finances.expensesByCategory["dividend-paid"]).toBe(704);
  });

  it("the design's example: B's 500 of 2,000 outside shares get 291 of 1,166", () => {
    expect(largestRemainder(1_166, [{ key: "b", shares: 500 }, { key: "others", shares: 1_500 }])).toEqual([{ key: "b", amount: 291 }, { key: "others", amount: 875 }]);
    const parts = largestRemainder(1_000_003, UNITS.map((s, i) => ({ key: `h${i}`, shares: s })));
    expect(parts.reduce((a, p) => a + p.amount, 0)).toBe(1_000_003);
    expect(dividendFor({ ...newShareRegistry(), payoutRatioPct: 25 }, [])).toMatchObject({ toHolders: 0, reason: "fewer than 7 closed statements" });
  });
});

describe("ISP-159 the payout ratio", () => {
  it("a change waits for the next period; once in 7 days; within 0 to 80 in steps of 5", async () => {
    const c = await issuer([3_500, 3_500, 3_500]);
    payDividends(c.id, c.listedAt + 7 * DAY); // period 1, at 25%
    const mid = c.listedAt + 7 * DAY + 3_600_000; // during period 2
    expect(setPayoutRatio(c.id, 50, mid)).toMatchObject({ ok: true });
    expect(setPayoutRatio(c.id, 60, mid + DAY).error).toMatch(/once in 7 days\. It may change again \d{4}-\d\d-\d\d \d\d:\d\d UTC\.$/); // Bug #4827
    expect(c.corp().shareRegistry).toMatchObject({ payoutRatioPct: 25, payoutRatioNextPct: 50 });
    const [p2, p3] = payDividends(c.id, Date.now());
    expect(p2).toMatchObject({ ratioPct: 25, pool: 6_125, toHolders: 704 }); // the period in progress kept its ratio
    expect(p3).toMatchObject({ ratioPct: 50, pool: 12_250, toHolders: 1_409 }); // floor(12,250 x 1,300 / 11,300)
    expect(c.corp().shareRegistry).toMatchObject({ payoutRatioPct: 50, payoutRatioNextPct: null });
    for (const bad of [85, 7, -5]) expect(setPayoutRatio(c.id, bad, Date.now() + 8 * DAY).error, String(bad)).toMatch(/0 to 80%, in steps of 5/);
    // the route checks the same list before it runs
    expect((await c.api.post(`/api/accounts/${c.id}/equity/payout-ratio`).send({ payoutRatioPct: 7 })).status).toBe(400);
  });
});

describe("ISP-159 paying", () => {
  it("an issuer short of credits pays what it has, split the same way; the rest is not owed", async () => {
    const c = await issuer([3_500, 3_500], { credits: 300 });
    const [p1, p2] = payDividends(c.id, Date.now());
    expect(p1).toMatchObject({ toHolders: 704, paid: 300, unpaid: 404 });
    expect(c.paidIn(1).map((e) => e.credits).sort((a, b) => b - a)).toEqual(expectedSplit(300, UNITS).filter(Boolean).sort((a, b) => b - a));
    expect(p2).toMatchObject({ toHolders: 704, paid: 0, unpaid: 704 }); // nothing left; and last week's 404 is not carried
    expect(c.credits()).toBe(0);
  });

  it("the market maker's part goes to its tap and is destroyed; the tick pays each period once", async () => {
    const c = await issuer([3_500], { marketMaker: 700 }); // 2,000 outside of 12,000
    const tap = settlementTotals().taps.igsx ?? 0;
    dividendTick(Date.now());
    dividendTick(Date.now());
    const toHolders = Math.floor((6_125 * 2_000) / 12_000); // 1,020
    const mm = c.paidIn(1).find((e) => e.to === "tap:igsx");
    expect(mm.credits).toBe(expectedSplit(toHolders, [...UNITS, 700])[7]);
    expect((settlementTotals().taps.igsx ?? 0) - tap).toBe(-mm.credits);
    expect(c.paidIn(1).reduce((a, e) => a + e.credits, 0)).toBe(toHolders);
    expect(c.corp().shareRegistry.dividendHistory).toHaveLength(1);
  });

  it("an unlisted corporation, or one listed less than 7 days ago, pays nothing", async () => {
    const c = await issuer([3_500]);
    mutateAccountState(c.id, (s) => { s.corp.shareRegistry.listedAt = Date.now() - 6 * DAY; }, { sanitize: false, settleMining: false });
    expect(payDividends(c.id, Date.now())).toEqual([]);
    mutateAccountState(c.id, (s) => { s.corp.shareRegistry.state = "private"; }, { sanitize: false, settleMining: false });
    expect(payDividends(c.id, Date.now() + 30 * DAY)).toEqual([]);
  });
});
