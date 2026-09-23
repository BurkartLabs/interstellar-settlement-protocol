import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState } from "../../server/gameState.js";

// Bug #1058, #1201: the refusals through the real routes.
async function corporation(setup) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => setup(state.corp));
  return { id: account.id, api: authed(app, accessToken) };
}

describe("refusals say what to do next (Bug #1058)", () => {
  it("hiring past the cap names the level that raises it", async () => {
    const c = await corporation((corp) => { corp.level = 0; corp.employeeCap = 8; corp.employeeCount = 8; corp.finances.credits = 100000; });
    const res = await c.api.post(`/api/accounts/${c.id}/gameplay/hire`).send({ count: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Employee cap reached: 8/8 on payroll. Reaching corporation level 1 raises the cap to 20; the Overview lists what the next level needs.");
  });

  it("a mining cycle without the credits says how many, and how to need fewer", async () => {
    const c = await corporation((corp) => {
      corp.finances.credits = 300;
      corp.offices = [{ stationId: "earth-station-prime", rentedUntil: Date.now() + 86400000 }];
      corp.miningLeases = [{ id: "lease-e", body: "Earth", buildingSlots: 2, extractorIds: ["ext-basic-1"] }];
      corp.mining = { silicateExtractors: [{ id: "ext-basic-1", name: "Basic Extractor Yard #1", active: false, leaseId: "lease-e" }] };
    });
    const res = await c.api.post(`/api/accounts/${c.id}/gameplay/lease/lease-e/start-mining`).send({ amount: 250, hours: 1, extractorId: "ext-basic-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Starting this mining cycle requires 1,750 credits. Current reserves: 300 credits. A throughput of 86 t/h or less starts for 500 credits. Selling stock to the standing buy orders on the Galactic Exchange raises credits.");
  });

  it("a short contract delivery names the item, the amount, the station and where the rest is", async () => {
    const c = await corporation((corp) => {
      corp.currentStationId = "earth-station-prime";
      corp.inventory = { "earth-station-prime": { Silicates: 120 }, "mars-orbital-dock": { Silicates: 300 } };
      corp.activeMissions = [{ id: "m-1058", title: "Silicate run", type: "delivery", quota: { resource: "Silicates", amount: 400 }, reward: { credits: 1000 } }];
    });
    const res = await c.api.post(`/api/accounts/${c.id}/gameplay/complete-mission`).send({ missionId: "m-1058" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This contract needs 400 Silicates delivered where you are docked, Earth Station Prime; you have 120 here. You hold 300 at Mars Orbital Dock: move it here with a Logistics transfer.");
  });

  it("a funding refusal says 'credits' once (Bug #1201)", async () => {
    const c = await corporation((corp) => { corp.employeeCap = 50; corp.employeeCount = 0; corp.finances.credits = 1234; });
    const res = await c.api.post(`/api/accounts/${c.id}/gameplay/hire`).send({ count: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Hiring requires 20,000 credits. Current reserves: 1,234 credits.");
  });
});
