import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// Bug #691: POST /gameplay/purchase-lease leased any string as a body, for 25,000, and put it in a notification.
async function readyCorp() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.offices = [{ stationId: "earth-orbital", leasedAt: Date.now() }];
    state.corp.employeeCount = 20;
    state.corp.finances.credits = 500000;
  });
  const api = authed(app, accessToken);
  const lease = (body) => api.post(`/api/accounts/${account.id}/gameplay/purchase-lease`).send({ body });
  const snapshot = () => JSON.stringify(getAccountById(account.id).state);
  return { id: account.id, lease, snapshot };
}

describe("POST /api/accounts/:id/gameplay/purchase-lease (Bug #691)", () => {
  for (const [label, body] of [
    ["a body in a system the corporation cannot reach", "Kestrel"],
    ["a body that does not exist", "Atlantis"],
    ["markup", "<img src=x onerror=alert(document.domain)>"],
    ["an oversized string", "x".repeat(10000)],
    ["a real body with no lease terms", "Venus"]
  ]) {
    it(`rejects ${label} with 400 and changes nothing`, async () => {
      const { lease, snapshot } = await readyCorp();
      const before = snapshot();
      const res = await lease(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
      expect(JSON.stringify(res.body)).not.toContain("<img");
      expect(snapshot()).toBe(before);
    });
  }

  it("leases a catalog body at its catalog price and stores the catalog's name", async () => {
    const { id, lease } = await readyCorp();
    dockAt(id, "mars-orbital-dock");
    const res = await lease("mars");
    expect(res.status).toBe(200);
    const corp = getAccountById(id).state.corp;
    expect(corp.miningLeases.map((l) => [l.body, l.cost])).toEqual([["Mars", 25000]]);
    expect(corp.finances.credits).toBe(500000 - 25000);
  });
});

// AB#1061: a station files leases only on the body it orbits (NEW_PLAYER_EXPERIENCE.md). The server used to file a
// Mars lease from Earth Station Prime, which the claims office there never offers.
function dockAt(id, stationId) {
  mutateAccountState(id, (state) => {
    state.corp.currentStationId = stationId;
    state.corp.currentSystemId = "sol";
    state.corp.travel = null;
  });
}

describe("a lease is filed at the station orbiting its body (AB#1061)", () => {
  it("refuses Mars from Earth Station Prime, says where to file it, and changes nothing", async () => {
    const { id, lease, snapshot } = await readyCorp();
    dockAt(id, "earth-station-prime");
    const before = snapshot();
    const res = await lease("Mars");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Mars Orbital Dock/);
    expect(snapshot()).toBe(before);
  });

  it("files Earth from Earth Station Prime and Luna from Luna Gateway", async () => {
    const earth = await readyCorp();
    dockAt(earth.id, "earth-station-prime");
    expect((await earth.lease("Earth")).status).toBe(200);
    const luna = await readyCorp();
    dockAt(luna.id, "luna-gateway");
    expect((await luna.lease("Luna")).status).toBe(200);
  });

  it("refuses any lease while the corporation is in transit", async () => {
    const { id, lease, snapshot } = await readyCorp();
    mutateAccountState(id, (state) => {
      state.corp.currentStationId = null;
      state.corp.travel = { travelType: "local", fromStationId: "earth-station-prime", toStationId: "mars-orbital-dock", departedAt: Date.now(), arrivesAt: Date.now() + 60_000 };
    });
    const before = snapshot();
    const res = await lease("Earth");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/in transit/i);
    expect(snapshot()).toBe(before);
  });
});
