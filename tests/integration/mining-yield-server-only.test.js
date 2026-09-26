import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById } from "../../server/gameState.js";

// AB#828: what a yard yields is the server tick's, from the lease body's catalog profile. Starting a cycle takes a
// rate, hours and an extractor; a client that also sends output figures moves nothing.
describe("mining output comes only from the server's tick (AB#828)", () => {
  it("start-mining with forged output fields deposits nothing and records no output", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const api = authed(app, accessToken);
    const play = (path, body = {}) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body);
    expect((await play("rent-office", { stationId: "earth-station-prime", durationDays: 7 })).status).toBe(200);
    expect((await play("hire", { count: 5 })).status).toBe(200);
    expect((await play("purchase-lease", { body: "Earth" })).status).toBe(200);
    const corp = () => getAccountById(account.id).state.corp;
    const leaseId = corp().miningLeases[0].id;
    expect((await play(`lease/${leaseId}/build-extractor`)).status).toBe(200);
    const extractorId = corp().mining.silicateExtractors[0].id;
    const res = await play(`lease/${leaseId}/start-mining`, {
      amount: 40, hours: 1, extractorId,
      Silicates: 999_999, "Iron Ore": 500, totalMined: 5000, minedByItem: { Silicates: 5000, Thorium: 9 }, yields: { Silicates: 9999 }
    });
    // The request is refused or taken without the extras; either way no output appears until time passes.
    const ext = corp().mining.silicateExtractors[0];
    const held = Object.values(corp().inventory || {}).reduce((n, inv) => n + Object.values(inv).reduce((a, b) => a + b, 0), 0);
    expect(held, `status ${res.status}`).toBe(0);
    expect(ext.totalMined).toBe(0);
    expect(Object.values(ext.minedByItem || {}).reduce((a, b) => a + b, 0)).toBe(0);
    expect(corp().stats?.["mined:Thorium"] || 0).toBe(0);
  });
});
