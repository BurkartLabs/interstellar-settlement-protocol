import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { REFINERY_CHAINS, REFINERY_CHAINS_DATA } from "../../server/game/catalog.js";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, applyRefineryOperations } from "../../server/gameState.js";
import { refineMinimum } from "../../public/scripts/refineQuantity.js";

// ISP-131 (AB#825): a chain takes `inputs: [{ item, quantityPerCycle }]`, and start-refinery takes every input in one
// mutation or refuses the whole start. No chain in data has two inputs yet (the tracks add them, AB#830 to AB#834), so
// this file adds one to the server's catalog before the server boots: the helper's beforeAll imports server/index.js
// after this top level has run, and the id check (server/index.js) is built from the catalog then.
const ALLOY = {
  id: "test-alloy-chain",
  inputs: [{ item: "Nickel", quantityPerCycle: 50 }, { item: "Titanium", quantityPerCycle: 30 }],
  outputs: [{ item: "Structural Alloys", quantityPerCycle: 20 }, { item: "Magnetic Cores", quantityPerCycle: 4 }],
  cycleDurationHours: 6, // a week is 28 batches
  requiresResearch: [], requiresTechIds: [], stage: 1, category: "Test"
};
const BROKEN = { ...ALLOY, id: "test-broken-chain", inputs: [] };
REFINERY_CHAINS[ALLOY.id] = ALLOY;
REFINERY_CHAINS[BROKEN.id] = BROKEN;
const ALLOY_OUTPUTS = structuredClone(ALLOY.outputs);
afterEach(() => { REFINERY_CHAINS[ALLOY.id] = ALLOY; ALLOY.outputs = structuredClone(ALLOY_OUTPUTS); });

const STATION = "earth-station-prime";
const ALL_TECH = [...new Set(REFINERY_CHAINS_DATA.chains.flatMap((c) => c.requiresTechIds))];

async function refiner(stock) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.currentStationId = STATION;
    corp.unlockedTech = ALL_TECH;
    corp.refineries = [{ id: "ref-1", name: "Refinery #1", tier: 1, active: false, chainId: null, totalInputConsumed: 0, totalOutputProduced: 0 }];
    corp.inventory = { [STATION]: { ...stock } };
  });
  const api = authed(app, accessToken);
  const corp = () => getAccountById(account.id).state.corp;
  const held = () => ({ ...corp().inventory[STATION] });
  const state = () => JSON.stringify(getAccountById(account.id).state);
  const start = (body) => api.post(`/api/accounts/${account.id}/gameplay/start-refinery`).send({ refineryId: "ref-1", ...body });
  /** The server's refinery tick, a year on: every running cycle has ended. */
  const finish = () => mutateAccountState(account.id, (s) => applyRefineryOperations(s.corp, Date.now() + 365 * 24 * 3600 * 1000));
  return { app, account, accessToken, corp, held, state, start, finish };
}

describe("the six chains in data run exactly as before (AB#825)", () => {
  it.each(REFINERY_CHAINS_DATA.chains.map((c) => [c.id, c]))("%s: takes its one input, runs its hours, delivers its outputs", async (_, chain) => {
    const [{ item, quantityPerCycle: per }] = chain.inputs;
    const qty = refineMinimum(per);
    const batches = qty / per;
    const p = await refiner({ [item]: qty + 7, Water: 3 });
    const res = await p.start({ chainId: chain.id, inputQuantity: qty });
    expect(res.status, JSON.stringify(res.body.error)).toBe(200);
    expect(p.held()).toEqual({ [item]: 7, Water: 3 });
    const ref = p.corp().refineries[0];
    expect(ref).toMatchObject({ active: true, chainId: chain.id, cycleScale: batches, totalInputConsumed: qty, stationId: STATION });
    expect(ref.endsAt - ref.startedAt).toBe(chain.cycleDurationHours * batches * 3600 * 1000);
    expect(res.body.receipt.grants[0]).toEqual({ label: "Input consumed", value: `${qty.toLocaleString("en-US")} ${item}` });

    p.finish();
    const expected = { [item]: 7, Water: 3 };
    for (const o of chain.outputs) expected[o.item] = o.quantityPerCycle * batches;
    expect(p.held()).toEqual(expected);
    expect(p.corp().refineries[0]).toMatchObject({ active: false, chainId: null, inputs: null, outputs: null, cyclesCompleted: batches });
  });
});

describe("a chain of two inputs takes both, or neither (AB#825)", () => {
  it("with both in stock, debits both in full and delivers when it ends", async () => {
    const p = await refiner({ Nickel: 160, Titanium: 100 });
    const res = await p.start({ chainId: ALLOY.id, batches: 3 });
    expect(res.status, JSON.stringify(res.body.error)).toBe(200);
    expect(p.held()).toEqual({ Nickel: 10, Titanium: 10 });
    expect(p.corp().refineries[0]).toMatchObject({ cycleScale: 3, totalInputConsumed: 240, inputs: [{ item: "Nickel", quantity: 150 }, { item: "Titanium", quantity: 90 }] });
    expect(res.body.receipt.grants[0]).toEqual({ label: "Inputs consumed", value: "150 Nickel + 90 Titanium" });
    p.finish();
    expect(p.held()).toEqual({ Nickel: 10, Titanium: 10, "Structural Alloys": 60, "Magnetic Cores": 12 });
  });

  it.each([
    ["Nickel", { Nickel: 149, Titanium: 90 }],
    ["Titanium", { Nickel: 150, Titanium: 89 }],
    ["Titanium", { Nickel: 150 }]
  ])("with %s short, refuses naming it and takes nothing", async (short, stock) => {
    const p = await refiner(stock);
    const before = p.state();
    const res = await p.start({ chainId: ALLOY.id, batches: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(new RegExp(`^Not enough ${short} at this station`));
    expect(res.body.error).not.toMatch(short === "Nickel" ? /Titanium/ : /Nickel/);
    expect(p.state()).toBe(before);
  });

  it("with both short, names both", async () => {
    const p = await refiner({});
    const res = await p.start({ chainId: ALLOY.id, batches: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Not enough Nickel at this station. Need 50 but only have 0. Not enough Titanium at this station. Need 30 but only have 0.");
  });
});

describe("hostile starts change nothing (DOCTRINE constraint 1)", () => {
  const cases = [
    ["an unknown chain", { chainId: "no-such-chain", batches: 1 }],
    ["a prototype key for a chain", { chainId: "__proto__", batches: 1 }],
    ["a chain with no usable recipe (fails closed)", { chainId: BROKEN.id, batches: 1 }],
    ["negative batches", { chainId: ALLOY.id, batches: -1 }],
    ["zero batches", { chainId: ALLOY.id, batches: 0 }],
    ["fractional batches", { chainId: ALLOY.id, batches: 2.5 }],
    ["batches as text", { chainId: ALLOY.id, batches: "two" }],
    ["NaN batches (sent as null: neither field)", { chainId: ALLOY.id, batches: Number.NaN }],
    ["oversized batches", { chainId: ALLOY.id, batches: 1e12 }],
    ["more than a week of batches", { chainId: ALLOY.id, batches: 29 }],
    ["both a quantity and batches", { chainId: ALLOY.id, batches: 1, inputQuantity: 50 }],
    ["neither a quantity nor batches", { chainId: ALLOY.id }],
    ["a quantity for a chain of several inputs", { chainId: ALLOY.id, inputQuantity: 50 }],
    ["an oversized quantity", { chainId: "nickel-chain", inputQuantity: 1e12 }],
    ["more than a week of one input", { chainId: "nickel-chain", inputQuantity: 120 * 34 }],
    ["another corporation's refinery", { chainId: ALLOY.id, batches: 1, refineryId: "ref-someone-else" }]
  ];
  it.each(cases)("%s: 400, and the account is unchanged", async (_, body) => {
    const p = await refiner({ Nickel: 1e6, Titanium: 1e6 });
    const before = p.state();
    const res = await p.start(body);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(p.state()).toBe(before);
  });

  it("answers 401 without a login and 403 for another account, changing nothing", async () => {
    const p = await refiner({ Nickel: 1e6, Titanium: 1e6 });
    const before = p.state();
    const path = `/api/accounts/${p.account.id}/gameplay/start-refinery`;
    expect((await request(p.app).post(path).send({ refineryId: "ref-1", chainId: ALLOY.id, batches: 1 })).status).toBe(401);
    const other = await registerAccount(p.app);
    expect((await authed(p.app, other.accessToken).post(path).send({ refineryId: "ref-1", chainId: ALLOY.id, batches: 1 })).status).toBe(403);
    expect(p.state()).toBe(before);
  });
});

describe("a cycle running across the upgrade completes with its original outputs (AB#825)", () => {
  it("a cycle started before runs recorded their outputs completes from its chain, as it would have", async () => {
    const p = await refiner({});
    // The shape a running cycle had before AB#825: no inputs or outputs record.
    mutateAccountState(p.account.id, (s) => {
      Object.assign(s.corp.refineries[0], { active: true, chainId: "silicates-chain", stationId: STATION, cycleScale: 2, startedAt: 1, lastTickAt: 1, endsAt: 2 });
      delete s.corp.refineries[0].inputs;
      delete s.corp.refineries[0].outputs;
    });
    p.finish();
    expect(p.held()).toEqual({ Aerogel: 80, "Quantum Insulators": 30 });
  });

  it("a recorded cycle delivers its record when its chain's outputs change while it runs", async () => {
    const p = await refiner({ Nickel: 50, Titanium: 30 });
    expect((await p.start({ chainId: ALLOY.id, batches: 1 })).status).toBe(200);
    ALLOY.outputs = [{ item: "Aerogel", quantityPerCycle: 999 }];
    p.finish();
    expect(p.held()).toEqual({ "Structural Alloys": 20, "Magnetic Cores": 4 });
  });

  it("a recorded cycle still delivers when its chain is removed while it runs", async () => {
    const p = await refiner({ Nickel: 50, Titanium: 30 });
    expect((await p.start({ chainId: ALLOY.id, batches: 1 })).status).toBe(200);
    delete REFINERY_CHAINS[ALLOY.id];
    p.finish();
    expect(p.held()).toEqual({ "Structural Alloys": 20, "Magnetic Cores": 4 });
  });
});
