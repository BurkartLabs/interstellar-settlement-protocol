import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, REFINERY_CHAINS } from "../../server/gameState.js";
import { resolveMetric } from "../../server/game/progression.js";
import { refineryTick } from "../../server/ticks.js";

// ISP-97 (AB#787): the Refinery Complex through the real routes: POST /gameplay/build upgrades a Refinery, the start
// receipt quotes the larger output, and the server's own refinery tick delivers it.

async function corporation(setup) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.finances.credits = 1_000_000;
    state.corp.buildingSlots = 4;
    state.corp.currentStationId = "earth-station-prime";
    state.corp.unlockedTech = ["tt-material-compression", "tt-nano-lattice"];
    setup?.(state.corp);
  });
  return { id: account.id, api: authed(app, accessToken), corp: () => getAccountById(account.id).state.corp, state: () => JSON.stringify(getAccountById(account.id).state) };
}
const post = (c, path, body = {}) => c.api.post(`/api/accounts/${c.id}/gameplay/${path}`).send(body);

describe("the Refinery Complex through the routes (ISP-97)", () => {
  it("is refused with no Refinery to upgrade, and nothing changes", async () => {
    const c = await corporation();
    const before = c.state();
    const res = await post(c, "build", { buildingId: "refinery-complex" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("The Refinery Complex upgrades a Refinery: build one first.");
    expect(c.state()).toBe(before);
  });

  it("upgrades a Refinery, takes no slot, and the building: metric resolves to 1", async () => {
    const c = await corporation();
    expect((await post(c, "build", { buildingId: "refinery" })).status).toBe(200);
    const slots = c.corp().buildings.length;
    const res = await post(c, "build", { buildingId: "refinery-complex" });
    expect(res.status).toBe(200);
    expect(res.body.receipt).toMatchObject({ title: "Refinery Complex Commissioned", costCredits: 100_000 });
    expect(c.corp().buildings).toHaveLength(slots);
    expect(c.corp().refineries[0].tier).toBe(2);
    expect(resolveMetric("building:Refinery Complex", c.corp())).toBe(1);
    const again = await post(c, "build", { buildingId: "refinery-complex" });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("Every Refinery you have is already a Refinery Complex.");
  });

  it("a run on it is quoted at 1.5 times, and the server's refinery tick delivers that", async () => {
    const chain = Object.values(REFINERY_CHAINS).find((ch) => !(ch.requiresTechIds || []).length) || Object.values(REFINERY_CHAINS)[0];
    const c = await corporation((corp) => {
      corp.unlockedTech = [...new Set([...corp.unlockedTech, ...(chain.requiresTechIds || [])])];
      corp.inventory = { "earth-station-prime": { [chain.inputs[0].item]: chain.inputs[0].quantityPerCycle } };
    });
    expect((await post(c, "build", { buildingId: "refinery" })).status).toBe(200);
    expect((await post(c, "build", { buildingId: "refinery-complex" })).status).toBe(200);
    const started = await post(c, "start-refinery", { refineryId: c.corp().refineries[0].id, chainId: chain.id, inputQuantity: chain.inputs[0].quantityPerCycle });
    expect(started.status, JSON.stringify(started.body.error)).toBe(200);
    const quoted = chain.outputs.map((o) => `${Math.floor(o.quantityPerCycle * 1.5).toLocaleString("en-US")} ${o.item}`).join(", ");
    expect(started.body.receipt.grants.find((g) => g.label === "Output when it ends").value).toBe(quoted);

    mutateAccountState(c.id, (state) => { state.corp.refineries[0].endsAt = Date.now() - 1; });
    refineryTick();
    const held = c.corp().inventory["earth-station-prime"];
    for (const o of chain.outputs) expect(held[o.item], o.item).toBe(Math.floor(o.quantityPerCycle * 1.5));
  });
});
