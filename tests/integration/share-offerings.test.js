import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getAllAccountIds, mutateAccountState, getStatements } from "../../server/gameState.js";
import { SHARE_TERMS, newShareRegistry, registryProblems } from "../../server/shareRegistry.js";
import { companyValue, founderFloorRoom, marketMakerFill, sharePrice, shareOfferingList, shareOfferingTick } from "../../server/shareOfferings.js";
import { ledgerEntries, settlementTotals } from "../../server/settlement.js";

// ISP-158 (AB#852): listing and primary share offerings (docs/design/v0.9-equity.md, sections 1 to 3 and 5; the Board's
// price rule, D-0.9-3 on AB#704). The issuer is the design's worked example: net worth 1,200,000 and the founder's
// 10,000 shares, so a share is worth 120. Time is injected for the close (P-TEST-TIME).
const ROOT = path.resolve(import.meta.dirname, "../..");
const DAY = 86_400_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });
afterEach(() => {
  const bad = getAllAccountIds().map((id) => getAccountById(id)?.state?.corp).filter(Boolean)
    .map((c) => [c.corporationName, registryProblems(c.shareRegistry)]).filter(([, p]) => p.length);
  expect(bad).toEqual([]); // the registry invariant, over every corporation, after every test
});

async function corporation({ level = 15, credits = 400_000, days = 30, net = 3_500, netWorth = 1_200_000, over = {} } = {}) {
  const { account, accessToken } = await registerAccount(app);
  const today = Math.floor(Date.now() / DAY) * DAY;
  mutateAccountState(account.id, (s) => {
    s.statements = Array.from({ length: days }, (_, i) => ({
      day: new Date(today - (days - i) * DAY).toISOString().slice(0, 10), dayStart: today - (days - i) * DAY,
      pnl: { income: {}, expenses: {}, totalIncome: 30_000, totalExpenses: 30_000 - net, net },
      cashFlow: { opening: 0, inflows: 30_000, outflows: 30_000 - net, closing: 150_000, unrecorded: 0 },
      balanceSheet: { credits: 150_000, facilities: netWorth - 130_000, inventory: 0, liabilities: 20_000, totalAssets: netWorth + 20_000, netWorth }
    }));
    s.corp.level = level;
    s.corp.finances.credits = credits;
    Object.assign(s.corp, over);
  }, { sanitize: false, settleMining: false });
  getStatements(account.id);
  const api = authed(app, accessToken);
  const corp = () => getAccountById(account.id).state.corp;
  return {
    id: account.id, api, corp, credits: () => Math.round(corp().finances.credits),
    list: () => api.post(`/api/accounts/${account.id}/equity/list`).send({}),
    offer: (body) => api.post(`/api/accounts/${account.id}/equity/offerings`).send(body),
    buy: (offeringId, quantity, extra = {}) => api.post(`/api/accounts/${account.id}/equity/offerings/${offeringId}/buy`).send({ quantity, ...extra })
  };
}
/** Set a corporation's registry directly (a fixture), keeping the invariant. */
const setRegistry = (c, change) => mutateAccountState(c.id, (s) => { change(s.corp.shareRegistry); }, { sanitize: false, settleMining: false });
const holderRows = (corpIds, each) => corpIds.map((corpId) => ({ holder: { kind: "corp", corpId }, shares: each, costBasis: 0, dividendsReceived: 0, acquiredAt: 1 }));

async function listed(opts) {
  const c = await corporation(opts);
  const r = await c.list();
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return c;
}

describe("ISP-158 the terms are the design's (P-TWO-SOURCES)", () => {
  it("listing, buying, offering and the market maker", () => {
    const doc = fs.readFileSync(path.join(ROOT, "docs/design/v0.9-equity.md"), "utf8").replace(/\r\n/g, "\n");
    const L = SHARE_TERMS.listing, O = SHARE_TERMS.offering, MM = SHARE_TERMS.marketMaker;
    expect(doc).toContain(`**Level ${L.minLevel}** or above`);
    expect(doc).toContain("A credit grade of **BBB or better**");
    expect(doc).toContain(`At least **${L.minStatements} closed statements**, and positive net income over the last ${L.minStatements} of them.`);
    expect(doc).toContain(`The **listing fee**: ${L.feePct}% of company value`);
    expect(doc).toContain(`Any corporation at **Level ${SHARE_TERMS.buyerMinLevel}** or above`);
    expect(doc).toContain(`at least ${O.minQuantity} shares; at most ${O.maxPctOfOutstanding}% of shares outstanding at open; at most what keeps the founder at ${O.founderFloorPct}%`);
    expect(doc).toContain(`an offering is open for **${O.openDays} days**`);
    expect(doc).toContain(`the next may open ${O.cadenceDays} days after the last one opened`);
    expect(doc).toContain(`| \`feePct\` | number | ${O.feePct.toFixed(1)}, charged on proceeds (sink) |`);
    expect(doc).toContain(`fill            = clip((expectedYield30 - ${MM.yieldFloorPct}%) / ${MM.yieldSpanPct}%, 0, 1) x gradeFactor`);
    expect(doc).toContain(`gradeFactor     = ${MM.gradeFactor.A} at A or better, ${MM.gradeFactor.BBB} at BBB`);
    expect(doc).toContain("outstanding can never exceed 19,607 shares");
    expect(founderFloorRoom(newShareRegistry())).toBe(9_607);
  });
});

describe("ISP-158 listing", () => {
  it("refuses below level 15, too few statements, a losing record, a grade below BBB; lists once for 1% of company value", async () => {
    expect((await (await corporation({ level: 14 })).list()).body.error).toMatch(/level 15; yours is level 14/);
    expect((await (await corporation({ days: 29 })).list()).body.error).toMatch(/30 closed daily statements; your corporation has 29/);
    expect((await (await corporation({ net: -100 })).list()).body.error).toMatch(/positive net income/);
    const late = { loans: [{ id: "loan-x", state: "arrears", balance: 50_000, arrears: 5_000, arrearsSince: Date.now() - 2 * DAY, principal: 60_000, termDays: 30 }] };
    expect((await (await corporation({ over: late })).list()).body.error).toMatch(/BBB or better; your corporation is CCC/);
    const c = await corporation();
    const r = await c.list();
    expect(r.status).toBe(200);
    expect(r.body.fee).toBe(12_000);
    expect(c.credits()).toBe(400_000 - 12_000);
    expect(c.corp().shareRegistry).toMatchObject({ state: "listed", founderShares: 10_000, unissued: 90_000 });
    expect(ledgerEntries().find((e) => e.key === `listing:${c.id}`)).toMatchObject({ to: "sink:fee", credits: 12_000, reason: "fee" });
    expect((await c.list()).body.error).toMatch(/already listed/);
  });
});

describe("ISP-158 an offering's price", () => {
  it("is company value / shares outstanding at open, on the server; a price in the request is ignored", async () => {
    const issuer = await listed();
    const r = await issuer.offer({ quantity: 2_000, pricePerShare: 1, price: 1 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.offering).toMatchObject({ quantity: 2_000, left: 2_000, pricePerShare: 120, state: "open" });
    const buyer = await corporation({ level: 8, credits: 100_000 });
    const b = await buyer.buy(r.body.offering.id, 10, { pricePerShare: 1, paid: 10 });
    expect(b.body.paid).toBe(1_200);
    expect(buyer.credits()).toBe(100_000 - 1_200);
  });

  it("selling at that price leaves the price per share unchanged (the design's worked example)", async () => {
    const issuer = await listed();
    const o = (await issuer.offer({ quantity: 2_000 })).body.offering;
    let raised = 0;
    for (let i = 0; i < 5; i++) {
      const buyer = await corporation({ level: 8, credits: 100_000 });
      raised += (await buyer.buy(o.id, 400)).body.paid;
    }
    expect(raised).toBe(240_000);
    const r = issuer.corp().shareRegistry;
    expect(r.authorized - r.unissued).toBe(12_000);
    // the next statement's net worth carries what was raised: 1,440,000 over 12,000 shares is still 120
    const before = companyValue(getStatements(issuer.id, 30).statements);
    expect(sharePrice(before + raised, r.authorized - r.unissued)).toBe(120);
    // and with floor: a value that does not divide evenly keeps its floor too
    expect(sharePrice(1_200_999, 10_000)).toBe(120);
    expect(sharePrice(1_200_999 + 2_000 * 120, 12_000)).toBe(120);
  });
});

describe("ISP-158 an offering's size", () => {
  it("at least 100, at most 20% of shares outstanding: exactly at and one over", async () => {
    const issuer = await listed();
    expect((await issuer.offer({ quantity: 99 })).status).toBe(400); // the input table's floor
    expect((await issuer.offer({ quantity: 2_001 })).body.error).toMatch(/At most 2,000 shares may be offered now: it is more than 20% of shares outstanding/);
    expect((await issuer.offer({ quantity: 2_000 })).status).toBe(200);
  });

  it("never leaves the founder below 51% after a full sale: exactly at and one over", async () => {
    const issuer = await listed();
    // 7,607 already outside (four holders of 1,901.75: three of 1,902 and one of 1,901), so 17,607 outstanding
    setRegistry(issuer, (r) => { r.holders = [...holderRows(["corp-a", "corp-b", "corp-c"], 1_902), ...holderRows(["corp-d"], 1_901)]; r.unissued = 100_000 - 10_000 - 7_607; });
    expect(founderFloorRoom(issuer.corp().shareRegistry)).toBe(2_000); // 19,607 - 17,607; 20% would allow 3,521
    expect((await issuer.offer({ quantity: 2_001 })).body.error).toMatch(/At most 2,000 shares may be offered now: it would leave the founder below 51%/);
    expect((await issuer.offer({ quantity: 2_000 })).status).toBe(200);
    expect(10_000 / (17_607 + 2_000)).toBeGreaterThanOrEqual(0.51);
    expect(10_000 / (17_607 + 2_001)).toBeLessThan(0.51);
  });

  it("one open at a time, the next 30 days after the last opened, and only once listed", async () => {
    expect((await (await corporation()).offer({ quantity: 500 })).body.error).toMatch(/List your corporation/);
    const issuer = await listed();
    const o = (await issuer.offer({ quantity: 500 })).body.offering;
    expect((await issuer.offer({ quantity: 500 })).body.error).toMatch(/already has an offering open/);
    const stored = shareOfferingList().find((x) => x.id === o.id);
    shareOfferingTick(stored.closesAt);
    expect(stored.state).toBe("closed");
    expect((await issuer.offer({ quantity: 500 })).body.error).toMatch(/30 days after the last one opened/);
    stored.openedAt -= 30 * DAY; // as if it had opened 30 days ago
    expect((await issuer.offer({ quantity: 500 })).status).toBe(200);
  });
});

describe("ISP-158 buying", () => {
  it("refuses, moving nothing: the issuer, a buyer below level 8, a bad quantity, more than is left", async () => {
    const issuer = await listed();
    const o = (await issuer.offer({ quantity: 500 })).body.offering;
    const junior = await corporation({ level: 7, credits: 100_000 });
    const buyer = await corporation({ level: 8, credits: 100_000 });
    const moved = () => ledgerEntries().filter((e) => e.key.startsWith(`shares:${o.id}:`)).length;
    expect((await issuer.buy(o.id, 10)).body.error).toMatch(/cannot buy its own shares/);
    expect((await junior.buy(o.id, 10)).body.error).toMatch(/level 8/);
    for (const q of [0, -3, 2.5, "ten"]) expect((await buyer.buy(o.id, q)).status, String(q)).toBe(400);
    expect((await buyer.buy(o.id, 501)).body.error).toMatch(/Only 500 shares/);
    expect((await buyer.buy("so-nope", 1)).status).toBe(404);
    expect(moved()).toBe(0);
    expect(buyer.credits()).toBe(100_000);
    expect(issuer.corp().shareRegistry.holders).toEqual([]);
  });

  it("no holder above 20% of shares outstanding after a purchase: exactly at and one over", async () => {
    const issuer = await listed();
    const buyer = await corporation({ level: 8, credits: 400_000 });
    // the buyer already holds 2,400 of 12,400 outstanding
    setRegistry(issuer, (r) => { r.holders = holderRows([buyer.corp().publicId], 2_400); r.unissued = 100_000 - 12_400; });
    const o = (await issuer.offer({ quantity: 1_000 })).body.offering;
    expect((await buyer.buy(o.id, 101)).body.error).toMatch(/more than 20% of shares outstanding: you may buy at most 100 more/);
    expect((await buyer.buy(o.id, 100)).status).toBe(200); // 2,500 of 12,500: exactly 20%
    expect((await buyer.buy(o.id, 1)).body.error).toMatch(/at most 0 more/);
  });

  it("moves the credits through settleTransfer (share-purchase) and the shares into the buyer's row together", async () => {
    const issuer = await listed();
    const buyer = await corporation({ level: 8, credits: 100_000 });
    const o = (await issuer.offer({ quantity: 500 })).body.offering;
    const before = issuer.credits();
    const r = await buyer.buy(o.id, 250);
    expect(r.body).toMatchObject({ shares: 250, paid: 30_000, offering: { left: 250 } });
    expect(ledgerEntries().filter((e) => e.key.startsWith(`shares:${o.id}:`)).map((e) => [e.from, e.to, e.credits, e.reason])).toEqual([[buyer.id, issuer.id, 30_000, "share-purchase"]]);
    expect(issuer.credits() - before).toBe(30_000);
    expect(issuer.corp().shareRegistry.holders).toEqual([{ holder: { kind: "corp", corpId: buyer.corp().publicId }, shares: 250, costBasis: 30_000, dividendsReceived: 0, acquiredAt: expect.any(Number) }]);
    expect(issuer.corp().shareRegistry.unissued).toBe(89_750);
    expect(buyer.corp().holdingIndex).toEqual([issuer.corp().publicId]);
    expect(buyer.corp().finances.expensesByCategory["share-purchase-paid"]).toBe(30_000);
  });

  it("200 random purchases: the credits and the shares both balance after every one", async () => {
    const issuer = await listed();
    const buyers = [];
    for (let i = 0; i < 8; i++) buyers.push(await corporation({ level: 8, credits: 60_000 }));
    const o = (await issuer.offer({ quantity: 2_000 })).body.offering;
    const total = () => issuer.credits() + buyers.reduce((a, b) => a + b.credits(), 0);
    const start = total();
    let x = 852, sold = 0;
    const rnd = (n) => ((x = (x * 1_103_515_245 + 12_345) % 2 ** 31) % n);
    for (let i = 0; i < 200; i++) {
      const b = buyers[rnd(buyers.length)];
      const r = await b.buy(o.id, 1 + rnd(12));
      if (r.status === 200) sold += r.body.shares;
      const reg = issuer.corp().shareRegistry;
      expect(registryProblems(reg), `after purchase ${i}`).toEqual([]);
      expect(total(), `credits after purchase ${i}`).toBe(start);
      expect(reg.holders.reduce((a, h) => a + h.shares, 0)).toBe(sold);
      expect(100_000 - 10_000 - reg.unissued).toBe(sold);
    }
    expect(sold).toBeGreaterThan(500);
    for (const b of buyers) {
      const row = issuer.corp().shareRegistry.holders.find((h) => h.holder.corpId === b.corp().publicId);
      expect(row ? 60_000 - b.credits() : 0).toBe(row ? row.costBasis : 0);
    }
  }, 120_000); // AB#854: 200 purchases, each a synchronous ledger and snapshot write, passed 20 s in a full parallel run
});

describe("ISP-158 the close", () => {
  it("the market maker takes its fill of what is left from its tap, within 20%; then the 2% fee on the proceeds", async () => {
    const issuer = await listed();
    const buyer = await corporation({ level: 8, credits: 100_000 });
    const o = (await issuer.offer({ quantity: 2_000 })).body.offering;
    await buyer.buy(o.id, 500);
    const stored = shareOfferingList().find((y) => y.id === o.id);
    const tap = settlementTotals().taps.igsx ?? 0;
    const credits = issuer.credits();
    // the window ends now (as if its 7 days had passed), so the close reads the fixture's statements
    const now = Date.now();
    stored.closesAt = now + 1;
    shareOfferingTick(now);
    expect(stored.state).toBe("open");
    stored.closesAt = now;
    shareOfferingTick(now);
    // payout 25% of 105,000 over 30 days on 1,200,000 of value: 2.1875% a month; (2.1875 - 0.5) / 2 = 0.84375
    const fill = marketMakerFill({ payoutRatioPct: 25, netIncome30: 105_000, value: 1_200_000, grade: "A" });
    expect(fill).toBeCloseTo(0.84375, 10);
    expect(stored.soldToMarketMaker).toBe(Math.floor(1_500 * fill)); // 1,265, and within its 20% cap
    const mm = issuer.corp().shareRegistry.holders.find((h) => h.holder.kind === "npc");
    expect(mm).toMatchObject({ holder: { kind: "npc", id: "igsx-mm" }, shares: 1_265 });
    const proceeds = (500 + 1_265) * 120;
    expect(stored).toMatchObject({ state: "closed", proceeds, feePaid: Math.floor(proceeds * 0.02) });
    expect((settlementTotals().taps.igsx ?? 0) - tap).toBe(1_265 * 120);
    expect(issuer.credits() - credits).toBe(1_265 * 120 - Math.floor(proceeds * 0.02));
    expect(issuer.corp().shareRegistry.unissued).toBe(90_000 - 1_765); // what nobody bought stays unissued
    shareOfferingTick(now + DAY); // closing twice changes nothing
    expect(stored.soldToMarketMaker).toBe(1_265);
  });

  it("the fill is 0 for an issuer that pays nothing out, and scaled at BBB", () => {
    expect(marketMakerFill({ payoutRatioPct: 0, netIncome30: 105_000, value: 1_200_000, grade: "A" })).toBe(0);
    expect(marketMakerFill({ payoutRatioPct: 80, netIncome30: 105_000, value: 1_200_000, grade: "A" })).toBe(1);
    expect(marketMakerFill({ payoutRatioPct: 80, netIncome30: 105_000, value: 1_200_000, grade: "BBB" })).toBe(0.75);
    expect(marketMakerFill({ payoutRatioPct: 80, netIncome30: 105_000, value: 1_200_000, grade: "BB" })).toBe(0);
  });
});

describe("ISP-158 shares are economic only", () => {
  it("nothing outside the equity modules reads who holds shares, so no stake grants an action", () => {
    const allowed = new Set(["server/shareRegistry.js", "server/shareOfferings.js", "server/routes/capTable.js"]);
    const readers = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith(".js")) {
          const rel = path.relative(ROOT, p).split(path.sep).join("/");
          if (!allowed.has(rel) && /\.holders\b/.test(fs.readFileSync(p, "utf8").replace(/\/\/.*$/gm, "")) && /shareRegistry/.test(fs.readFileSync(p, "utf8"))) readers.push(rel);
        }
      }
    };
    walk(path.join(ROOT, "server"));
    expect(readers).toEqual([]);
  });
});
