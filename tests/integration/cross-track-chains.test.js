import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, applyRefineryOperations } from "../../server/gameState.js";
import { REFINERY_CHAINS } from "../../server/game/catalog.js";
import { resolveMetric } from "../../server/game/progression.js";

// ISP-140 (AB#834): the four cross-track chains of docs/design/tier3-recipes.md, whose inputs are other tracks'
// products. Each is gated by Integrated Manufacturing alone (section 2): a corporation that never researched magnets
// can buy Rare-Earth Magnets from one that did, which is where the tracks meet the BRIEF's second measure.
const EARTH = "earth-station-prime";
const CROSS = ["fusion-core-chain", "fission-module-chain", "spaceframe-chain", "ion-thruster-chain"];
// Integrated Manufacturing and what it needs, and nothing of the tracks' own research.
const RESEARCH = ["tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast", "tt-energy-routing", "tt-material-compression",
  "tt-nano-lattice", "tt-containment-physics", "tt-exotic-energy-routing", "tt-integrated-manufacturing"];
const TRACK_RESEARCH = ["tt-fusion-fuel-cycle", "tt-ferrous-metallurgy", "tt-rare-metal-separation", "tt-light-metal-electrolysis"];

async function assembler({ stock = {}, research = RESEARCH } = {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.currentStationId = EARTH;
    corp.unlockedTech = [...research];
    corp.refineries = [{ id: "ref-1", name: "Refinery #1", tier: 1, active: false, chainId: null, totalInputConsumed: 0, totalOutputProduced: 0 }];
    corp.inventory = { [EARTH]: { ...stock } };
  });
  const api = authed(app, accessToken);
  const corp = () => getAccountById(account.id).state.corp;
  const held = () => ({ ...(corp().inventory?.[EARTH] || {}) });
  const start = (chainId, batches = 1) => api.post(`/api/accounts/${account.id}/gameplay/start-refinery`).send({ refineryId: "ref-1", chainId, batches });
  const finish = () => mutateAccountState(account.id, (s) => applyRefineryOperations(s.corp, Date.now() + 365 * 86_400_000));
  return { account, corp, held, start, finish };
}
const oneBatchOf = (chainId) => Object.fromEntries(REFINERY_CHAINS[chainId].inputs.map((i) => [i.item, i.quantityPerCycle]));

describe("the cross-track chains (AB#834)", () => {
  it("are all in the data, each drawing on two or more tracks' products, gated by Integrated Manufacturing", () => {
    for (const id of CROSS) {
      const chain = REFINERY_CHAINS[id];
      expect(chain, id).toBeDefined();
      expect(chain.requiresTechIds, id).toEqual(["tt-integrated-manufacturing"]);
      expect(chain.inputs.length, id).toBeGreaterThanOrEqual(2);
      // Every input is another chain's output: these chains take no raw item.
      for (const { item } of chain.inputs) {
        expect(Object.values(REFINERY_CHAINS).some((c) => c.id !== id && c.outputs.some((o) => o.item === item)), `${id}: ${item}`).toBe(true);
      }
    }
  });

  it.each(CROSS)("%s runs from its inputs to its output, with only Integrated Manufacturing researched", async (chainId) => {
    const chain = REFINERY_CHAINS[chainId];
    const p = await assembler({ stock: { ...oneBatchOf(chainId), Water: 3 } });
    expect(p.corp().unlockedTech.some((t) => TRACK_RESEARCH.includes(t))).toBe(false);
    const res = await p.start(chainId);
    expect(res.status, JSON.stringify(res.body.error)).toBe(200);
    expect(p.held()).toEqual({ Water: 3 });
    p.finish();
    const [out] = chain.outputs;
    expect(p.held()).toEqual({ Water: 3, [out.item]: out.quantityPerCycle });
    expect(resolveMetric(`stat:manufactured:${out.item}`, p.corp())).toBe(out.quantityPerCycle);
  });

  it("a corporation holding only one track's outputs cannot start one, is told which input is missing, and keeps its goods", async () => {
    // The Fuel track's two products, and none of the Rare Metals track's magnets.
    const fuelOnly = { "Fusion Pellets": 20, "Cryogenic Coolant": 20 };
    const p = await assembler({ stock: fuelOnly });
    const res = await p.start("fusion-core-chain");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Not enough Rare-Earth Magnets at this station. Need 10 but only have 0. Bring more to this station, or run fewer batches.");
    expect(p.held()).toEqual(fuelOnly);
    expect(p.corp().refineries[0].active).toBe(false);

    // The Light Metals track's alloy without the Nickel-Iron track's Structural Alloys.
    const lightOnly = { "Aluminium-Lithium Alloy": 30 };
    const q = await assembler({ stock: lightOnly });
    const refused = await q.start("spaceframe-chain");
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("Not enough Structural Alloys at this station. Need 20 but only have 0. Bring more to this station, or run fewer batches.");
    expect(q.held()).toEqual(lightOnly);
  });

  it("without Integrated Manufacturing, none of them starts, whatever the corporation holds", async () => {
    const stock = Object.assign({}, ...CROSS.map(oneBatchOf));
    const p = await assembler({ stock, research: [...RESEARCH.filter((t) => t !== "tt-integrated-manufacturing"), ...TRACK_RESEARCH] });
    for (const chainId of CROSS) {
      const res = await p.start(chainId);
      expect(res.status, chainId).toBe(400);
      expect(res.body.error).toBe("This chain requires: Integrated Manufacturing.");
    }
    expect(p.held()).toEqual(stock);
  });
});
