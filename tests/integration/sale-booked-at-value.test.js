import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { accountsStore } from "../../server/game/store.js";
import { ECONOMY, bookableUnitPriceFor, priceCeilingFor } from "../../server/economy.js";
import { FINANCING_CATEGORIES, closeDay } from "../../server/finances.js";

// Bug #4882: within Bug #4797's 5x ceiling, two accounts could still trade at five times the bid and book the whole
// gross as the seller's exchange revenue, dominance and standing. The seller still receives every credit, but only the
// price up to the ISA's own ask books as trade; the rest is financing, outside the P&L the credit rating reads.
const ITEM = "Silicates";
const STATION = "earth-station-prime";
const bid = ECONOMY.npcBuyers.find((b) => b.item === ITEM).unitPrice;
const ASK = bookableUnitPriceFor(ITEM);
const Q = 2_000; // enough tax to earn Earth Assembly standing, so the comparison below is not of two zeros

async function corp(app, { stock = 0, credits = 1_000_000 } = {}) {
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => {
    s.corp.currentStationId = STATION;
    s.corp.inventory = { [STATION]: { [ITEM]: stock } };
    s.corp.finances.credits = credits;
  });
  return { id: account.id, api: authed(app, accessToken) };
}
const corpOf = (id) => accountsStore.accounts[id].state.corp;
const dominanceSales = (id) => Object.values(corpOf(id).dominance?.sales || {}).reduce((sum, day) => sum + (Number(day[STATION]) || 0), 0);

/** A seller lists Q at `unitPrice` and a second account buys it all. Returns the seller's corporation id and its gain. */
async function sale(app, unitPrice) {
  const seller = await corp(app, { stock: Q });
  const buyer = await corp(app);
  const before = Number(getAccountById(seller.id).state.corp.finances.credits);
  const listed = await seller.api.post("/api/market/orders").send({ type: "sell", item: ITEM, quantity: Q, unitPrice });
  expect(listed.status, JSON.stringify(listed.body)).toBeLessThan(300);
  const orderId = listed.body.order?.id ?? listed.body.id ?? listed.body.orderId;
  const bought = await buyer.api.post(`/api/market/orders/${orderId}/buy`).send({ quantity: Q });
  expect(bought.status, JSON.stringify(bought.body)).toBeLessThan(300);
  return { id: seller.id, gained: Number(getAccountById(seller.id).state.corp.finances.credits) - before };
}

describe("a sale books as trade only up to the ISA's own ask (Bug #4882)", () => {
  it("the line is the catalog bid times the NPC ask multiple, under the listing ceiling", () => {
    expect(ASK).toBe(Math.round(bid * ECONOMY.npcAsks.askMultiple));
    expect(priceCeilingFor(ITEM)).toBeGreaterThan(ASK);
    expect(FINANCING_CATEGORIES).toContain("exchange-above-value");
  });

  it("at five times the bid the seller gets every credit, but revenue, dominance and standing book as a sale at the ask", async () => {
    const { app } = await getApp();
    const atAsk = await sale(app, ASK);
    const high = await sale(app, priceCeilingFor(ITEM));
    const total = Q * priceCeilingFor(ITEM);

    // the credits: all of it, less the tax and fees on all of it
    expect(high.gained).toBeGreaterThan(atAsk.gained * 2);
    const books = corpOf(high.id).finances.incomeBySource;
    expect(books.exchange).toBe(Q * ASK);
    expect(books["exchange-above-value"]).toBe(total - Q * ASK);

    // revenue, dominance and standing: the same as the honest sale at the ask
    expect(corpOf(atAsk.id).finances.incomeBySource.exchange).toBe(Q * ASK);
    expect(corpOf(atAsk.id).finances.incomeBySource["exchange-above-value"]).toBeUndefined();
    expect(dominanceSales(high.id)).toBe(dominanceSales(atAsk.id));
    expect(dominanceSales(high.id)).toBe(Q * ASK);
    expect(Number(corpOf(atAsk.id).standing?.["earth-assembly"])).toBeGreaterThan(0);
    expect(corpOf(high.id).standing ?? {}).toEqual(corpOf(atAsk.id).standing ?? {});

    // the P&L the credit rating reads leaves the excess out; the cash flow still counts it
    const c = corpOf(high.id);
    const day = closeDay(c, c.finances.dayBook.dayStart);
    expect(day.pnl.income["exchange-above-value"]).toBeUndefined();
    expect(day.pnl.income.exchange).toBe(Q * ASK);
    expect(day.cashFlow.inflows).toBeGreaterThanOrEqual(total);
  });
});
