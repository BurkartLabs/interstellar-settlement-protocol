import { describe, it, expect, vi, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, fleetStatus } from "../../server/gameState.js";
import { fabricationTick } from "../../server/ticks.js";
import { UNITS } from "../../server/game/units.js";
import { REFUND_STARTED, REFUND_UNSTARTED } from "../../server/shipyard.js";

// ISP-171 (AB#865): ship production at the Orbital Shipyard through the real routes and the server's own tick. The
// client names a ship and a quantity; the cost, the goods and the time are the catalog's (data/units.json).

afterEach(() => vi.restoreAllMocks());

const LF = UNITS.lf, DS = UNITS.ds;
const STATION = "earth-station-prime";

async function corporation(setup) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.level = 10;
    corp.currentStationId = STATION;
    corp.unlockedTech = ["tt-fleet-coordination", "tt-capital-hulls"];
    corp.buildings.push({ name: "Orbital Shipyard", tier: 1, status: "Operational" });
    corp.finances.credits = 1_000_000;
    corp.inventory = { [STATION]: { "Carbon Fibre Sheets": 1000, "Armour Plating": 100 } };
    setup?.(corp);
  }, { sanitize: false, settleMining: false });
  const corp = () => getAccountById(account.id).state.corp;
  const state = () => JSON.stringify(getAccountById(account.id).state);
  const api = authed(app, accessToken);
  return {
    id: account.id, corp, state,
    queue: (body) => api.post(`/api/accounts/${account.id}/gameplay/shipyard/queue`).send(body),
    cancel: (jobId) => api.post(`/api/accounts/${account.id}/gameplay/shipyard/cancel`).send({ jobId })
  };
}
/** Runs the server's fabrication tick as if it were `at`. */
function tickAt(at) {
  vi.spyOn(Date, "now").mockReturnValue(at);
  fabricationTick();
  vi.restoreAllMocks();
}

describe("queueing ships (AB#865)", () => {
  it("takes the catalog's credits and goods, and times the job from the catalog", async () => {
    const c = await corporation();
    const before = c.corp();
    const res = await c.queue({ unitId: "lf", quantity: 3 });
    expect(res.status).toBe(200);
    const job = c.corp().shipyard.queue[0];
    expect(job).toMatchObject({ unitId: "lf", quantity: 3, credits: LF.credits * 3, goods: { "Carbon Fibre Sheets": 30 } });
    expect(job.completesAt - job.startsAt).toBe(LF.buildMinutes * 60_000 * 3);
    expect(c.corp().finances.credits).toBe(before.finances.credits - LF.credits * 3);
    expect(c.corp().inventory[STATION]["Carbon Fibre Sheets"]).toBe(1000 - 30);
    expect(c.corp().finances.expensesByCategory["ship-production"]).toBe(LF.credits * 3);
    expect(res.body.receipt).toMatchObject({ title: "Ship Production Queued", costCredits: LF.credits * 3 });
  });

  it("ignores a cost, a build time and a completion the client sends: the stored job is the catalog's", async () => {
    const c = await corporation();
    const res = await c.queue({ unitId: "lf", quantity: 1, credits: 1, cost: 1, goods: {}, buildMinutes: 0, startsAt: 0, completesAt: 0 });
    expect(res.status).toBe(200);
    const job = c.corp().shipyard.queue[0];
    expect(job.credits).toBe(LF.credits);
    expect(job.goods).toEqual({ "Carbon Fibre Sheets": 10 });
    expect(job.completesAt - job.startsAt).toBe(LF.buildMinutes * 60_000);
    expect(job.completesAt).toBeGreaterThan(Date.now());
  });

  it("queues a second job behind the first, starting when it finishes", async () => {
    const c = await corporation();
    await c.queue({ unitId: "lf", quantity: 2 });
    await c.queue({ unitId: "ds", quantity: 1 });
    const [a, b] = c.corp().shipyard.queue;
    expect(b.startsAt).toBe(a.completesAt);
    expect(b.completesAt - b.startsAt).toBe(DS.buildMinutes * 60_000);
  });
});

describe("each refusal debits nothing (AB#865)", () => {
  const refused = async (c, body, message) => {
    const before = c.state();
    const res = await c.queue(body);
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(c.state(), "nothing in the account changed").toBe(before);
  };

  it("a unit that is not a ship, or not a unit at all (catalog enum)", async () => {
    const c = await corporation();
    for (const unitId of ["at", "dt", "battleship", "", 7]) await refused(c, { unitId, quantity: 1 }, /a ship/);
  });

  it("a quantity that is not a whole number from 1 to 100", async () => {
    const c = await corporation();
    for (const quantity of [0, -1, 2.5, 101, "three", null]) await refused(c, { unitId: "lf", quantity }, /quantity from 1 to 100/);
  });

  it("no shipyard", async () => {
    const c = await corporation((corp) => { corp.buildings = corp.buildings.filter((b) => b.name !== "Orbital Shipyard"); });
    await refused(c, { unitId: "lf", quantity: 1 }, /build one first/);
  });

  it("the unit's research missing", async () => {
    const c = await corporation((corp) => { corp.unlockedTech = ["tt-fleet-coordination"]; });
    await refused(c, { unitId: "ds", quantity: 1 }, /Destroyers need Capital Hull Engineering research/);
  });

  it("the Fleet Cap, counting the ships already queued", async () => {
    const c = await corporation((corp) => { corp.level = 1; corp.unlocks = { ...corp.unlocks, maxFleetSize: 1 }; }); // a cap of 2 + 12
    expect(fleetStatus(c.corp()).cap).toBeLessThan(40);
    const { cap, vessels } = fleetStatus(c.corp());
    const room = cap - vessels;
    expect((await c.queue({ unitId: "lf", quantity: room - 1 })).status).toBe(200); // one place left, counting the queue
    await refused(c, { unitId: "lf", quantity: 2 }, /Fleet Cap/);
    expect((await c.queue({ unitId: "lf", quantity: 1 })).status).toBe(200);
    expect(fleetStatus(c.corp()).full).toBe(true);
  });

  it("credits short of the catalog's price", async () => {
    const c = await corporation((corp) => { corp.finances.credits = LF.credits * 2 - 1; });
    await refused(c, { unitId: "lf", quantity: 2 }, /Light Fighter/);
  });

  it("goods short at the station the corporation is docked at", async () => {
    const c = await corporation((corp) => { corp.inventory[STATION]["Carbon Fibre Sheets"] = 19; });
    await refused(c, { unitId: "lf", quantity: 2 }, /need 20 Carbon Fibre Sheets at Earth Station Prime; it holds 19/);
  });
});

describe("completion is the server's tick, and happens once (AB#865)", () => {
  it("delivers nothing early, the units exactly once past completion, and power follows", async () => {
    const c = await corporation();
    await c.queue({ unitId: "lf", quantity: 3 });
    const job = c.corp().shipyard.queue[0];
    tickAt(job.completesAt - 1);
    expect(c.corp().military.units.lf).toBe(0);
    tickAt(job.completesAt + 1000);
    tickAt(job.completesAt + 2000);
    expect(c.corp().military.units.lf).toBe(3);
    expect(c.corp().shipyard.queue).toEqual([]);
    expect(c.corp().military.power.attack).toBe(3 * LF.attack);
  });
});

describe("cancelling (AB#865)", () => {
  it("a job not yet started returns everything, and the job behind it moves up", async () => {
    const c = await corporation();
    await c.queue({ unitId: "ds", quantity: 1 });
    await c.queue({ unitId: "lf", quantity: 2 });
    const [first, second] = c.corp().shipyard.queue;
    const credits = c.corp().finances.credits, plating = c.corp().inventory[STATION]["Armour Plating"], fibre = c.corp().inventory[STATION]["Carbon Fibre Sheets"];
    const res = await c.cancel(second.id);
    expect(res.status).toBe(200);
    expect(REFUND_UNSTARTED).toBe(1);
    expect(c.corp().finances.credits).toBe(credits + second.credits);
    expect(c.corp().inventory[STATION]["Carbon Fibre Sheets"]).toBe(fibre + 20);
    expect(c.corp().inventory[STATION]["Armour Plating"]).toBe(plating);
    expect(c.corp().shipyard.queue.map((j) => j.id)).toEqual([first.id]);
    expect(c.corp().finances.incomeBySource["ship-production-refund"]).toBe(second.credits);
  });

  it("a job under way returns half its credits and goods", async () => {
    const c = await corporation();
    await c.queue({ unitId: "ds", quantity: 3 });
    const job = c.corp().shipyard.queue[0];
    const credits = c.corp().finances.credits, plating = c.corp().inventory[STATION]["Armour Plating"];
    const res = await c.cancel(job.id);
    expect(res.status).toBe(200);
    expect(REFUND_STARTED).toBe(0.5);
    expect(c.corp().finances.credits).toBe(credits + Math.floor(job.credits / 2));
    expect(c.corp().inventory[STATION]["Armour Plating"]).toBe(plating + 12);
    expect(res.body.receipt.grants).toContainEqual({ label: "Share returned", value: "half: the job was under way" });
  });

  it("a job that moved up behind a cancelled one starts when the slips are free", async () => {
    const c = await corporation();
    await c.queue({ unitId: "lf", quantity: 1 });
    await c.queue({ unitId: "lf", quantity: 1 });
    await c.queue({ unitId: "lf", quantity: 1 });
    const [a, b, third] = c.corp().shipyard.queue;
    await c.cancel(b.id);
    const moved = c.corp().shipyard.queue.find((j) => j.id === third.id);
    expect(moved.startsAt).toBe(a.completesAt);
    expect(moved.completesAt - moved.startsAt).toBe(LF.buildMinutes * 60_000);
  });

  it("will not cancel a job that is not in the caller's queue, and changes nothing", async () => {
    const owner = await corporation();
    await owner.queue({ unitId: "lf", quantity: 1 });
    const other = await corporation();
    const before = owner.state();
    const res = await other.cancel(owner.corp().shipyard.queue[0].id);
    expect(res.status).toBe(404);
    expect(owner.state()).toBe(before);
  });
});
