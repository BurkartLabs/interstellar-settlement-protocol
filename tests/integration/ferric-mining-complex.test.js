import { describe, it, expect, afterEach, vi } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, BELT_KEYS } from "../../server/gameState.js";
import { resolveMetric } from "../../server/game/progression.js";
import { asteroidExpeditionTick } from "../../server/ticks.js";

// ISP-96 (AB#786): the Ferric Mining Complex through the real routes: built with POST /gameplay/build once its
// research is done, counted by the ladder's building: metric, and applied by the server's own expedition tick.

afterEach(() => vi.restoreAllMocks());

async function corporation(setup) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.finances.credits = 1_000_000;
    state.corp.buildingSlots = 4;
    state.corp.currentStationId = "earth-station-prime";
    setup?.(state.corp);
  });
  return { id: account.id, api: authed(app, accessToken), corp: () => getAccountById(account.id).state.corp, state: () => JSON.stringify(getAccountById(account.id).state) };
}
const build = (c) => c.api.post(`/api/accounts/${c.id}/gameplay/build`).send({ buildingId: "ferric-mining-complex" });

describe("the Ferric Mining Complex through the routes (ISP-96)", () => {
  it("is refused until Material Compression I is researched, and nothing changes", async () => {
    const c = await corporation((corp) => { corp.unlockedTech = []; });
    const before = c.state();
    const res = await build(c);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Ferric Mining Complex construction requires Material Compression I research.");
    expect(c.state()).toBe(before);
  });

  it("is built once, charged at its price, and the building: metric resolves to 1", async () => {
    const c = await corporation((corp) => { corp.unlockedTech = ["tt-material-compression"]; });
    expect(resolveMetric("building:Ferric Mining Complex", c.corp())).toBe(0);
    const res = await build(c);
    expect(res.status).toBe(200);
    expect(res.body.receipt).toMatchObject({ title: "Ferric Mining Complex Commissioned", costCredits: 90_000 });
    expect(c.corp().finances.credits).toBe(910_000);
    expect(resolveMetric("building:Ferric Mining Complex", c.corp())).toBe(1);
    const again = await build(c);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("You already operate the maximum of 1 of the Ferric Mining Complex.");
  });

  it("the server's expedition tick deposits 1.25 times the Nickel and Titanium, and the report says so", async () => {
    const c = await corporation((corp) => { corp.unlockedTech = ["tt-material-compression"]; });
    expect((await build(c)).status).toBe(200);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const now = Date.now();
    mutateAccountState(c.id, (state) => {
      state.corp.inventory = {};
      state.corp.asteroidMining.activeExpeditions = [{ id: "exp-fmc", status: "active", beltKey: BELT_KEYS[0], systemId: "sol",
        duration: "standard", deployedAt: now - 120_000, lastTickAt: now - 1_000, completesAt: now - 1_000, yields: { Nickel: 40, Titanium: 20, Silicates: 12 } }];
    });
    asteroidExpeditionTick();
    const corp = c.corp();
    expect(corp.inventory["earth-station-prime"]).toMatchObject({ Nickel: 50, Titanium: 25, Silicates: 12 });
    const inbox = await c.api.get(`/api/accounts/${c.id}/messages`);
    const report = JSON.stringify(inbox.body);
    expect(report).toContain("Mining Probe Return");
    expect(report).toContain("+10 from your Ferric Mining Complex");
  });
});
