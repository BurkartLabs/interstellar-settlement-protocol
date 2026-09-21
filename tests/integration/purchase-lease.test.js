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
    const res = await lease("mars");
    expect(res.status).toBe(200);
    const corp = getAccountById(id).state.corp;
    expect(corp.miningLeases.map((l) => [l.body, l.cost])).toEqual([["Mars", 25000]]);
    expect(corp.finances.credits).toBe(500000 - 25000);
  });
});
