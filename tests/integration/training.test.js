import { describe, it, expect, vi, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, fleetStatus } from "../../server/gameState.js";
import { fabricationTick } from "../../server/ticks.js";
import { UNITS } from "../../server/game/units.js";
import { EMPLOYEES_PER_LEASE } from "../../public/scripts/leaseStaffing.js";

// ISP-172 (AB#866): troop training at Headquarters through the real routes and the server's own tick, on the production
// queue ship production uses (server/production.js). The client names troops and a number of squads; the cost, the
// goods and the time are the catalog's (data/units.json). Troops take no employees and are not vessels.

afterEach(() => vi.restoreAllMocks());

const AT = UNITS.at, DT = UNITS.dt;
const EARTH = "earth-station-prime";

async function corporation(setup) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.currentStationId = EARTH;
    corp.unlockedTech = ["tt-fleet-coordination"];
    corp.finances.credits = 1_000_000;
    corp.inventory = { [EARTH]: { "Battery Cells": 100, "Structural Alloys": 300 } };
    setup?.(corp);
  }, { sanitize: false, settleMining: false });
  const corp = () => getAccountById(account.id).state.corp;
  const state = () => JSON.stringify(getAccountById(account.id).state);
  const api = authed(app, accessToken);
  return {
    id: account.id, corp, state,
    train: (body) => api.post(`/api/accounts/${account.id}/gameplay/training/queue`).send(body),
    cancel: (jobId) => api.post(`/api/accounts/${account.id}/gameplay/training/cancel`).send({ jobId })
  };
}
function tickAt(at) {
  vi.spyOn(Date, "now").mockReturnValue(at);
  fabricationTick();
  vi.restoreAllMocks();
}

describe("training troops (AB#866)", () => {
  it("takes the catalog's credits and goods, and times the job from the catalog", async () => {
    const c = await corporation();
    const credits = c.corp().finances.credits;
    const res = await c.train({ unitId: "dt", quantity: 10 });
    expect(res.status).toBe(200);
    const job = c.corp().training.queue[0];
    expect(job).toMatchObject({ unitId: "dt", quantity: 10, stationId: EARTH, credits: DT.credits * 10, goods: { "Structural Alloys": 60 } });
    expect(job.completesAt - job.startsAt).toBe(DT.buildMinutes * 60_000 * 10);
    expect(c.corp().finances.credits).toBe(credits - DT.credits * 10);
    expect(c.corp().inventory[EARTH]["Structural Alloys"]).toBe(300 - 60);
    expect(c.corp().finances.expensesByCategory["troop-training"]).toBe(DT.credits * 10);
    expect(res.body.receipt).toMatchObject({ title: "Troop Training Started" });
    expect(res.body.receipt.grants).toContainEqual({ label: "Garrison", value: "Earth Station Prime, where you queued them" });
  });

  it("ignores a cost, a training time and a completion the client sends", async () => {
    const c = await corporation();
    const res = await c.train({ unitId: "at", quantity: 2, credits: 1, cost: 0, goods: {}, buildMinutes: 0, completesAt: 0 });
    expect(res.status).toBe(200);
    const job = c.corp().training.queue[0];
    expect(job.credits).toBe(AT.credits * 2);
    expect(job.goods).toEqual({ "Battery Cells": 4 });
    expect(job.completesAt - job.startsAt).toBe(AT.buildMinutes * 60_000 * 2);
  });

  it("takes no employees: payroll and every lease's staffing are unchanged, and troops are not vessels", async () => {
    const lease = (id, body) => ({ id, body, leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [], issuedAt: Date.now() });
    const c = await corporation((corp) => {
      corp.miningLeases = [lease("lease-a", "Earth"), lease("lease-b", "Mars")];
      corp.employeeCount = 2 * EMPLOYEES_PER_LEASE; // exactly what two leases need
    });
    const before = { employees: c.corp().employeeCount, fleet: fleetStatus(c.corp()).vessels, payroll: c.corp().finances.expensesByCategory?.payroll || 0 };
    expect((await c.train({ unitId: "dt", quantity: 20 })).status).toBe(200);
    expect((await c.train({ unitId: "at", quantity: 10 })).status).toBe(200);
    tickAt(Math.max(...c.corp().training.queue.map((j) => j.completesAt)) + 1000);
    const after = c.corp();
    expect(after.employeeCount).toBe(before.employees);
    expect(after.employeeCount).toBeGreaterThanOrEqual(after.miningLeases.length * EMPLOYEES_PER_LEASE);
    expect(after.finances.expensesByCategory?.payroll || 0).toBe(before.payroll);
    expect(fleetStatus(after).vessels).toBe(before.fleet);
    expect(after.military.units).toMatchObject({ dt: 20, at: 10 });
  });
});

describe("each refusal debits nothing (AB#866)", () => {
  const refused = async (c, body, message) => {
    const before = c.state();
    const res = await c.train(body);
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(c.state(), "nothing in the account changed").toBe(before);
  };

  it("a unit that is not a troop (catalog enum)", async () => {
    const c = await corporation();
    for (const unitId of ["lf", "ds", "militia", "", 3]) await refused(c, { unitId, quantity: 1 }, /Attack Troops or Defense Troops/);
  });

  it("a number of squads that is not a whole number from 1 to 100", async () => {
    const c = await corporation();
    for (const quantity of [0, -3, 1.5, 101, "ten", null]) await refused(c, { unitId: "dt", quantity }, /squads from 1 to 100/);
  });

  it("no Headquarters", async () => {
    const c = await corporation((corp) => { corp.buildings = corp.buildings.filter((b) => b.name !== "Headquarters"); });
    await refused(c, { unitId: "dt", quantity: 1 }, /Headquarters, and it has none/);
  });

  it("Attack Troops without Fleet Coordination Matrix; Defense Troops need no research", async () => {
    const c = await corporation((corp) => { corp.unlockedTech = []; });
    await refused(c, { unitId: "at", quantity: 1 }, /Attack Troops need Fleet Coordination Matrix research/);
    expect((await c.train({ unitId: "dt", quantity: 1 })).status).toBe(200);
  });

  it("credits short of the catalog's price", async () => {
    const c = await corporation((corp) => { corp.finances.credits = DT.credits * 3 - 1; });
    await refused(c, { unitId: "dt", quantity: 3 }, /^3 squads of Defense Troops requires .* Sell goods or finish an assignment to raise the credits, then try again\.$/); // Bug #4820
  });

  it("goods short at the station the corporation is docked at", async () => {
    const c = await corporation((corp) => { corp.inventory[EARTH]["Battery Cells"] = 3; });
    await refused(c, { unitId: "at", quantity: 2 }, /need 4 Battery Cells at Earth Station Prime; it holds 3\. Bring more there, or train fewer squads\.$/); // AB#4810 (ISP-6)
  });

  it("a queue already ten jobs deep", async () => {
    const c = await corporation();
    for (let i = 0; i < 10; i += 1) expect((await c.train({ unitId: "dt", quantity: 1 })).status).toBe(200);
    await refused(c, { unitId: "dt", quantity: 1 }, /10 jobs at most/);
  });
});

describe("completion, and the garrison (AB#866)", () => {
  it("delivers nothing early, the squads exactly once past completion, and Defense Troops join the garrison", async () => {
    const c = await corporation();
    await c.train({ unitId: "dt", quantity: 4 });
    const job = c.corp().training.queue[0];
    tickAt(job.completesAt - 1);
    expect(c.corp().military.units.dt).toBe(0);
    tickAt(job.completesAt + 1000);
    tickAt(job.completesAt + 2000);
    expect(c.corp().military.units.dt).toBe(4);
    expect(c.corp().military.garrisons).toEqual({ [EARTH]: 4 });
    expect(c.corp().training.queue).toEqual([]);
  });

  it("stands Defense Troops at the station the corporation was docked at, and keeps Attack Troops out of any garrison", async () => {
    const c = await corporation((corp) => {
      corp.currentStationId = "luna-gateway";
      corp.inventory["luna-gateway"] = { "Structural Alloys": 30, "Battery Cells": 10 };
    });
    await c.train({ unitId: "dt", quantity: 3 });
    await c.train({ unitId: "at", quantity: 2 });
    tickAt(Math.max(...c.corp().training.queue.map((j) => j.completesAt)) + 1000);
    expect(c.corp().military.garrisons).toEqual({ "luna-gateway": 3 });
    expect(c.corp().military.units).toMatchObject({ dt: 3, at: 2 });
  });
});

describe("cancelling (AB#866)", () => {
  it("returns everything for a job not yet started, and half for one under way", async () => {
    const c = await corporation();
    await c.train({ unitId: "dt", quantity: 6 });
    await c.train({ unitId: "at", quantity: 4 });
    const [first, second] = c.corp().training.queue;
    const credits = c.corp().finances.credits;
    expect((await c.cancel(second.id)).status).toBe(200);
    expect(c.corp().finances.credits).toBe(credits + second.credits);
    expect(c.corp().inventory[EARTH]["Battery Cells"]).toBe(100);
    const mid = c.corp().finances.credits;
    const res = await c.cancel(first.id);
    expect(c.corp().finances.credits).toBe(mid + Math.floor(first.credits / 2));
    expect(c.corp().inventory[EARTH]["Structural Alloys"]).toBe(300 - 36 + 18);
    expect(res.body.receipt.grants).toContainEqual({ label: "Share returned", value: "half: training was under way" });
    expect(c.corp().finances.incomeBySource["troop-training-refund"]).toBe(second.credits + Math.floor(first.credits / 2));
  });

  it("will not cancel another corporation's job, and changes nothing", async () => {
    const owner = await corporation();
    await owner.train({ unitId: "dt", quantity: 1 });
    const other = await corporation();
    const before = owner.state();
    expect((await other.cancel(owner.corp().training.queue[0].id)).status).toBe(404);
    expect(owner.state()).toBe(before);
  });
});
