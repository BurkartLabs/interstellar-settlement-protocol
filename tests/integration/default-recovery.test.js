import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState, getState, listAccountNotifications } from "../../server/gameState.js";
import { postLoanOffer, acceptLoanOffer } from "../../server/playerLoans.js";
import { loanServicingTick, owedOnDefault } from "../../server/loanServicing.js";
import { defaultRecoveryTick, recoverDefault, pickAsset, liquidInventory, GRACE_HOURS } from "../../server/defaultRecovery.js";
import { recoveryHold } from "../../server/recoveryHold.js";
import { settlementTotals } from "../../server/settlement.js";

// ISP-286 (AB#993): recovering a defaulted player debt (docs/design/v0.9-debt.md section 10; the Board on AB#702:
// "Anything liquid, assets force sold if not able to cover."). Time is injected (P-TEST-TIME).
const DAY = 86_400_000, HOUR = 3_600_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });

const bidItem = () => {
  const o = (getState().market?.npcBuyOrders || []).find((x) => Number(x.unitPrice) > 0);
  return { item: o.item, bid: Math.floor(Number(o.unitPrice)) };
};

async function corp(credits = 0) {
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => {
    s.corp.finances.credits = credits;
    s.corp.level = 8;
    s.corp.buildingSlots = 8;
    s.corp.unlockedTech = ["tt-material-compression", "tt-nano-lattice"];
  }, { sanitize: false, settleMining: false });
  const c = () => getAccountById(account.id).state.corp;
  const api = authed(app, accessToken);
  return { id: account.id, api, corp: c, credits: () => Math.round(c().finances.credits) };
}
const build = async (who, buildingId) => {
  const res = await who.api.post(`/api/accounts/${who.id}/gameplay/build`).send({ buildingId });
  expect(res.status, JSON.stringify(res.body.error)).toBe(200);
};

/** A 20,000 player loan from `lender` to `debtor`, put straight into default: 2,000 in arrears (100 of it late fees). */
function defaultedLoan(lender, debtor, T0) {
  const offer = postLoanOffer(lender.id, { principal: 20_000, ratePct30: 3, termDays: 30, minGrade: "NR-accepted" }, T0);
  const { loan } = acceptLoanOffer(debtor.id, offer.offer.id, T0);
  mutateAccountState(debtor.id, (s) => {
    const l = s.corp.loans.find((x) => x.id === loan.id);
    Object.assign(l, { arrearsFees: 100, arrearsInterest: 400, arrearsPrincipal: 1_500, arrears: 2_000, balance: 20_000, state: "arrears", arrearsSince: T0, defaultedAt: T0 + 8 * DAY, nextDueAt: T0 + 400 * DAY });
  }, { sanitize: false, settleMining: false });
  return loan.id;
}
const loanOf = (debtor, id) => debtor.corp().loans.find((l) => l.id === id);

describe("recovering a defaulted player loan (AB#993)", () => {
  it("takes credits, then goods at the NPC bid, then the cheapest building that covers the rest, and stops at what is owed", async () => {
    const lender = await corp(100_000), debtor = await corp(1_000_000);
    await build(debtor, "refinery");
    await build(debtor, "refinery");
    const T0 = Date.now();
    const loanId = defaultedLoan(lender, debtor, T0);
    const { item, bid } = bidItem();
    const units = Math.floor(5_000 / bid);
    mutateAccountState(debtor.id, (s) => {
      s.corp.finances.credits = 3_000;
      s.corp.inventory = { "earth-station-prime": { [item]: units } };
      s.corp.offices = [{ stationId: "earth-station-prime", rentedUntil: T0 + 30 * DAY }];
    }, { sanitize: false, settleMining: false });
    const keep = JSON.stringify({ offices: debtor.corp().offices, tech: debtor.corp().unlockedTech, level: debtor.corp().level });
    const owed = owedOnDefault(loanOf(debtor, loanId));
    expect(owed).toBe(22_000);
    const lenderBefore = lender.credits();
    const feesBefore = Number(settlementTotals().sinks?.fee) || 0;

    defaultRecoveryTick(T0 + 9 * DAY); // the warning; the grace period starts
    defaultRecoveryTick(T0 + 9 * DAY + GRACE_HOURS * HOUR); // the grace period ends: recovery runs

    const rec = debtor.corp().recoveries.find((r) => r.loanId === loanId);
    expect(rec.state).toBe("done");
    expect(rec.result.collected).toBe(22_000);
    expect(rec.result.shortfall).toBe(0);
    expect(rec.result.sold.map((s) => s.kind)).toEqual(["inventory", "building"]); // the stated order
    expect(lender.credits() - lenderBefore).toBe(22_000 - 100); // everything owed but the late fees, which go to the sink
    expect((Number(settlementTotals().sinks?.fee) || 0) - feesBefore).toBe(100);
    // one Refinery sold at 40% of 75,000 = 30,000; after 3,000 in credits and the goods, 30,000 more than covers the rest
    const goods = units * bid;
    expect(debtor.corp().buildings.filter((b) => b.name === "Refinery")).toHaveLength(1);
    expect(debtor.credits()).toBe(3_000 + goods + 30_000 - 22_000); // the surplus stays with the debtor
    expect(debtor.corp().inventory["earth-station-prime"]?.[item] || 0).toBe(0);
    expect(loanOf(debtor, loanId).state).toBe("repaid");
    expect(debtor.corp().buildings.some((b) => b.name === "Headquarters")).toBe(true);
    expect(JSON.stringify({ offices: debtor.corp().offices, tech: debtor.corp().unlockedTech, level: debtor.corp().level })).toBe(keep);
    expect(listAccountNotifications(lender.id).notifications.some((n) => n.title === "Debt recovered")).toBe(true);
  });

  it("sells nothing before the grace period ends, holds value in meanwhile, and a payment in time cancels the sale", async () => {
    const lender = await corp(100_000), debtor = await corp(1_000_000);
    await build(debtor, "refinery");
    const T0 = Date.now();
    const loanId = defaultedLoan(lender, debtor, T0);
    mutateAccountState(debtor.id, (s) => { s.corp.finances.credits = 0; }, { sanitize: false, settleMining: false });
    const start = T0 + 9 * DAY;
    defaultRecoveryTick(start);
    defaultRecoveryTick(start + (GRACE_HOURS - 1) * HOUR); // not yet
    expect(debtor.corp().buildings.filter((b) => b.name === "Refinery")).toHaveLength(1);
    expect(debtor.corp().recoveries[0].state).toBe("grace");
    // in the grace period nothing of value goes to another corporation
    expect(recoveryHold(debtor.corp())).toMatch(/in default/);
    const listing = await debtor.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 1, unitPrice: 1 });
    expect(listing.status).toBe(409);
    expect(postLoanOffer(debtor.id, { principal: 1_000, ratePct30: 3, termDays: 7, minGrade: "NR-accepted" }, start).ok).toBe(false);
    // the debtor pays its arrears: servicing collects them and the loan is active again
    mutateAccountState(debtor.id, (s) => { s.corp.finances.credits = 50_000; const l = s.corp.loans.find((x) => x.id === loanId); l.nextDueAt = start + HOUR; }, { sanitize: false, settleMining: false });
    loanServicingTick(start + 2 * HOUR);
    expect(loanOf(debtor, loanId).state).toBe("active");
    defaultRecoveryTick(start + GRACE_HOURS * HOUR);
    expect(debtor.corp().recoveries[0].state).toBe("cancelled");
    expect(debtor.corp().buildings.filter((b) => b.name === "Refinery")).toHaveLength(1); // nothing was sold
    expect(recoveryHold(debtor.corp())).toBe("");
  });

  it("leaves the corporation as it was when a sale fails part way", async () => {
    const lender = await corp(100_000), debtor = await corp(1_000_000);
    await build(debtor, "refinery");
    const T0 = Date.now();
    const loanId = defaultedLoan(lender, debtor, T0);
    mutateAccountState(debtor.id, (s) => { s.corp.finances.credits = 0; s.corp.inventory = {}; }, { sanitize: false, settleMining: false });
    const before = JSON.stringify({ buildings: debtor.corp().buildings, refineries: debtor.corp().refineries, assets: debtor.corp().finances.assets, credits: debtor.credits() });
    expect(() => recoverDefault(debtor.id, loanId, T0 + 10 * DAY, { faultAfterSale: "asset" })).toThrow(/injected fault/);
    expect(JSON.stringify({ buildings: debtor.corp().buildings, refineries: debtor.corp().refineries, assets: debtor.corp().finances.assets, credits: debtor.credits() })).toBe(before);
    expect(owedOnDefault(loanOf(debtor, loanId))).toBe(22_000);
  });

  it("stops at what is recoverable: a debtor with only its Headquarters keeps it, and the rest is still owed", async () => {
    const lender = await corp(100_000), debtor = await corp(0);
    const T0 = Date.now();
    const loanId = defaultedLoan(lender, debtor, T0);
    mutateAccountState(debtor.id, (s) => { s.corp.finances.credits = 0; s.corp.inventory = {}; s.corp.miningLeases = []; }, { sanitize: false, settleMining: false });
    const r = recoverDefault(debtor.id, loanId, T0 + 10 * DAY);
    expect(r).toMatchObject({ ok: true, collected: 0, shortfall: 22_000, sold: [] });
    expect(debtor.corp().buildings.map((b) => b.name)).toEqual(["Headquarters"]);
  });

  it("never touches an NPC loan: the Development Bank is non-destructive", async () => {
    const debtor = await corp(0);
    mutateAccountState(debtor.id, (s) => {
      s.corp.loans = [{ id: "loan-npc-x", lender: { kind: "npc", productId: "dsdb-30" }, principal: 10_000, balance: 10_000, arrears: 500, arrearsFees: 0, arrearsInterest: 0, arrearsPrincipal: 500, state: "arrears", arrearsSince: 1, defaultedAt: 2 }];
    }, { sanitize: false, settleMining: false });
    defaultRecoveryTick(Date.now());
    expect(debtor.corp().recoveries || []).toEqual([]);
    expect(recoverDefault(debtor.id, "loan-npc-x", Date.now()).ok).toBe(false);
  });
});

describe("the rules, pure", () => {
  it("sells the cheapest asset that covers what is owed, or the dearest if none does", () => {
    const assets = [{ id: "a", value: 30_000 }, { id: "b", value: 12_000 }, { id: "c", value: 50_000 }];
    expect(pickAsset(assets, 10_000).id).toBe("b");
    expect(pickAsset(assets, 31_000).id).toBe("c");
    expect(pickAsset(assets, 90_000).id).toBe("c");
    expect(pickAsset([], 1)).toBeNull();
  });

  it("counts only goods the NPC exchange bids for, highest bid first", () => {
    const lots = liquidInventory({ inventory: { s1: { A: 5, B: 2, Z: 9 } } }, [{ item: "A", unitPrice: 10 }, { item: "B", unitPrice: 40 }]);
    expect(lots.map((l) => [l.item, l.units, l.bid])).toEqual([["B", 2, 40], ["A", 5, 10]]);
  });
});
