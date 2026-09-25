import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// Bug #1014: a non-numeric or fractional number in a request body got past Math.max and was written into state.
async function corp(setup) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.finances.credits = 100000;
    setup?.(state);
  });
  return { id: account.id, api: authed(app, accessToken), corp: () => getAccountById(account.id).state.corp };
}

describe("POST /gameplay/hire with a bad count (Bug #1014)", () => {
  const hirer = () => corp((s) => {
    s.corp.employeeCap = 20;
    s.corp.employeeCount = 0;
    s.corp.offices = [{ stationId: "earth-station-prime", rentedAt: Date.now(), rentedUntil: Date.now() + 7 * 86_400_000 }];
  });

  for (const count of ["abc", 1.5, -3, "Infinity"]) {
    it(`keeps credits and headcount whole numbers for count ${JSON.stringify(count)}`, async () => {
      const { id, api, corp: read } = await hirer();
      await api.post(`/api/accounts/${id}/gameplay/hire`).send({ count });
      const c = read();
      expect(Number.isInteger(c.employeeCount), `employeeCount ${c.employeeCount}`).toBe(true);
      expect(Number.isFinite(c.finances.credits), `credits ${c.finances.credits}`).toBe(true);
      expect(100000 - c.finances.credits).toBe(c.employeeCount * 2000);
    });
  }

  // AB#2058: a cleared Head Count box was hired as 1 because the client turned it into 1 before sending. The server was
  // never the problem: a count that is missing or not a whole number of at least 1 is refused before the route runs
  // (gameplayInput.js, AB#731). Pinned here so the client can send what was typed and rely on it.
  for (const [label, body] of [["a blank count", { count: "" }], ["no count at all", {}], ["count \"abc\"", { count: "abc" }], ["count 1.5", { count: 1.5 }], ["count 0", { count: 0 }], ["count -3", { count: -3 }]]) {
    it(`refuses ${label} with 400, hires nobody and spends nothing (AB#2058)`, async () => {
      const { id, api, corp: read } = await hirer();
      const res = await api.post(`/api/accounts/${id}/gameplay/hire`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/^Enter the number of employees to hire/); // gameplayInput.js (AB#731), before the route
      expect(read().employeeCount).toBe(0);
      expect(read().finances.credits).toBe(100000);
    });
  }

  it("still hires the number asked for", async () => {
    const { id, api, corp: read } = await hirer();
    expect((await api.post(`/api/accounts/${id}/gameplay/hire`).send({ count: 3 })).status).toBe(200);
    expect(read().employeeCount).toBe(3);
    expect(read().finances.credits).toBe(100000 - 6000);
  });
});

describe("POST /api/market/orders with a bad quantity or price (Bug #1014)", () => {
  const seller = () => corp((s) => {
    s.corp.currentStationId = "earth-station-prime";
    s.corp.inventory = { "earth-station-prime": { silicates: 100 } };
  });

  for (const [label, body] of [
    ["quantity \"abc\"", { quantity: "abc", unitPrice: 10 }],
    ["unitPrice \"abc\"", { quantity: 5, unitPrice: "abc" }]
  ]) {
    it(`refuses ${label} with 400 and leaves the inventory whole`, async () => {
      const { api, corp: read } = await seller();
      const res = await api.post("/api/market/orders").send({ type: "sell", item: "silicates", ...body });
      expect(res.status).toBe(400);
      expect(read().inventory["earth-station-prime"].silicates).toBe(100);
    });
  }
});
