import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, getStationInventory, getState, mutateState } from "../../server/gameState.js";
import { WALKTHROUGH_STEPS, WALKTHROUGH_COMPLETION, isStepComplete, nextStepIndex } from "../../public/scripts/walkthrough.js";

// AB#581: each state predicate checked on a freshly registered corporation before and after the player's action, and
// the action is the real route the page calls. A predicate reading a field the server never writes fails here, which
// a hand-built fixture would not catch.
const step = (id) => WALKTHROUGH_STEPS.find((s) => s.id === id);
const done = (id, state) => isStepComplete(step(id), state);

describe("walkthrough completion predicates, through the real routes (AB#581)", () => {
  it("each first-day action completes its own step, and none is complete before it", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const api = authed(app, accessToken);
    const play = (path, body = {}) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body);
    const state = () => getAccountById(account.id).state;

    const stateSteps = WALKTHROUGH_STEPS.filter((s) => WALKTHROUGH_COMPLETION[s.id].state).map((s) => s.id);
    expect(stateSteps).toEqual(["office", "hire", "lease", "yard", "cycle", "sell", "research"]);
    for (const id of stateSteps) expect(done(id, state()), `${id} on a new corporation`).toBe(false);
    // A new corporation starts on the first step: nothing it has done yet counts.
    expect(nextStepIndex(0, state())).toBe(0);

    expect((await play("rent-office", { stationId: "earth-station-prime", durationDays: 7 })).status).toBe(200);
    expect(done("office", state())).toBe(true);
    expect(done("hire", state())).toBe(false);

    expect((await play("hire", { count: 4 })).status).toBe(200);
    expect(done("hire", state()), "four employees are not enough for a lease").toBe(false);
    expect((await play("hire", { count: 1 })).status).toBe(200);
    expect(done("hire", state())).toBe(true);

    expect(done("lease", state())).toBe(false);
    expect((await play("purchase-lease", { body: "earth" })).status).toBe(200);
    expect(done("lease", state())).toBe(true);

    expect(done("yard", state())).toBe(false);
    const leaseId = state().corp.miningLeases[0].id;
    expect((await play(`lease/${leaseId}/build-extractor`)).status).toBe(200);
    expect(done("yard", state())).toBe(true);

    expect(done("cycle", state())).toBe(false);
    const extractorId = state().corp.mining.silicateExtractors[0].id;
    expect((await play("mine", { amount: 40, hours: 24, extractorId })).status).toBe(200);
    expect(done("cycle", state())).toBe(true);

    // The mining tickers are off in tests, so the tons the cycle would have produced are put at the station directly.
    mutateAccountState(account.id, (s) => {
      const inventory = getStationInventory(s.corp, s.corp.currentStationId);
      inventory.Silicates = (inventory.Silicates || 0) + 2;
    });
    // A fresh data directory has no standing buy orders until the first-boot fix (!143) lands; this tests the predicate,
    // not the seeding, so the Silicates order is put in place if it is missing.
    if (!(getState().market?.npcBuyOrders || []).some((o) => o.id === "npc-buy-silicates-daily")) {
      mutateState((s) => {
        s.market = s.market || {};
        s.market.npcBuyOrders = [...(s.market.npcBuyOrders || []), {
          id: "npc-buy-silicates-daily", item: "Silicates", buyer: "GEX Commodities Authority", unitPrice: 24,
          totalQtyPerDay: 1000000, remainingQty: 1000000, lastResetDate: ""
        }];
      });
    }
    expect(done("sell", state())).toBe(false);
    const sale = await api.post("/api/market/npc-orders/npc-buy-silicates-daily/sell").send({ quantity: 2 });
    expect(sale.status, JSON.stringify(sale.body)).toBe(200);
    expect(done("sell", state())).toBe(true);

    expect(done("research", state())).toBe(false);
    expect((await play("queue-rnd", { techId: "tt-basic-extraction" })).status).toBe(200);
    expect(done("research", state())).toBe(true);

    // The returning player: every state step done, so only the UI steps are left.
    const remaining = WALKTHROUGH_STEPS.filter((s) => !isStepComplete(s, state())).map((s) => s.id);
    expect(remaining).toEqual(["licence", "station", "bureau", "overview", "starmap"]);
  });

  it("a listing is not a sale: the sell step waits for one to settle", async () => {
    const { app } = await getApp();
    const { account } = await registerAccount(app);
    mutateAccountState(account.id, (s) => {
      s.corp.tradeHistory.unshift({ id: "th-1", type: "listed", item: "Silicates", quantity: 2, unitPrice: 24, at: Date.now() });
    });
    expect(done("sell", getAccountById(account.id).state)).toBe(false);
  });

  it("an office whose lease has run out, or that is at another station, does not count", async () => {
    const { app } = await getApp();
    const { account } = await registerAccount(app);
    const now = Date.now();
    mutateAccountState(account.id, (s) => {
      s.corp.offices = [
        { stationId: s.corp.currentStationId, rentedAt: now - 9e8, rentedUntil: now - 1000 },
        { stationId: "mars-orbital-dock", rentedAt: now, rentedUntil: now + 9e8 }
      ];
    });
    expect(done("office", getAccountById(account.id).state)).toBe(false);
  });
});
