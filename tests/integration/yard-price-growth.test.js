import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { ECONOMY } from "../../server/economy.js";

// ISP-303 (AB#2286): each extractor yard past the starting kit costs more than the last, through the real build route.
// ISP-309 (AB#2305): the kit's two yards are flat at 50,000; growth starts at yard 3.
async function corporation(credits) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    const now = Date.now();
    corp.finances.credits = credits;
    corp.buildingSlots = 10;
    corp.employeeCount = 5;
    corp.offices = [{ stationId: "earth-station-prime", rentedAt: now, rentedUntil: now + 7 * 86_400_000, durationDays: 7 }];
    corp.miningLeases = [{ id: "lease-2286", body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 6, extractorIds: [] }];
  });
  const api = authed(app, accessToken);
  const build = () => api.post(`/api/accounts/${account.id}/gameplay/build`).send({ buildingId: "basic-extractor-yard", leaseId: "lease-2286" });
  const corp = () => getAccountById(account.id).state.corp;
  return { id: account.id, build, corp };
}

describe("each extractor yard past the starting kit costs more than the last (AB#2286, AB#2305)", () => {
  it("charges 50,000, 50,000, 63,000 and 78,000 for the first four, and each receipt says so", async () => {
    const c = await corporation(1_000_000);
    for (const price of [50_000, 50_000, 63_000, 78_000]) {
      const before = c.corp().finances;
      const res = await c.build();
      expect(res.status, JSON.stringify(res.body.error)).toBe(200);
      expect(before.credits - c.corp().finances.credits).toBe(price);
      expect(res.body.receipt.costCredits).toBe(price);
      // Only the next purchase costs more: each yard adds the same book value, and none already built is revalued.
      expect(c.corp().finances.assets - before.assets).toBe(ECONOMY.buildings.extractorYardAssetValue);
    }
  });

  it("refuses the third yard short of credit with the escalated price, not the base one, and changes nothing", async () => {
    const c = await corporation(50_000 + 50_000 + 60_000);
    expect((await c.build()).status).toBe(200);
    expect((await c.build()).status).toBe(200);
    const before = JSON.stringify(c.corp().buildings);
    const res = await c.build();
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("63,000");
    expect(res.body.error).not.toContain("50,000");
    expect(JSON.stringify(c.corp().buildings)).toBe(before);
  });

  it("takes the Supply Forecast discount after the rise", async () => {
    const c = await corporation(1_000_000);
    mutateAccountState(c.id, (s) => { s.corp.unlockedTech = [...(s.corp.unlockedTech || []), "tt-supply-forecast"]; });
    const spent = [];
    for (let i = 0; i < 3; i++) {
      const before = c.corp().finances.credits;
      expect((await c.build()).status).toBe(200);
      spent.push(before - c.corp().finances.credits);
    }
    expect(spent).toEqual([50_000, 50_000, 63_000].map((p) => Math.round(p * ECONOMY.buildings.supplyForecastCostMultiplier)));
  });
});
