import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState } from "../../server/gameState.js";

// Bug #1057: what the build routes answer when there is no room, through the real routes.
// (Bug #1195 covered the unleased POST /gameplay/build-extractor route, deleted for AB#1121.)
async function corporation(setup) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.finances.credits = 1_000_000;
    state.corp.offices = [{ stationId: "earth-station-prime", name: "HQ" }];
    setup(state.corp);
  });
  return { id: account.id, api: authed(app, accessToken) };
}
const earthLease = (used) => ({ id: "lease-earth", body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: Array.from({ length: used }, (_, i) => `ext-basic-${i + 1}`) });
const MISSING_VERBS = /upgrade|release|additional claim|acquire|tier|headquarters|perk/i;

describe("slot errors name only what the game can do (Bug #1057)", () => {
  it("a third extractor on a full Earth lease is told where to file the next lease", async () => {
    const c = await corporation((corp) => {
      corp.miningLeases = [earthLease(2)];
      corp.buildings = [{ name: "Basic Extractor Yard" }, { name: "Basic Extractor Yard" }];
      corp.buildingSlots = 4;
    });
    const res = await c.api.post(`/api/accounts/${c.id}/gameplay/lease/lease-earth/build-extractor`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This Earth lease has used both of its building slots (2/2). To build more extractors, file a lease on Mars (at Mars Orbital Dock) or Luna (at Luna Gateway): travel there and apply at the ISA Claims & Leases Division.");
  });

  it("a lease with room but no corporation slot left is told what adds slots", async () => {
    const c = await corporation((corp) => {
      corp.miningLeases = [earthLease(1)];
      corp.buildings = [{}, {}, {}, {}];
      corp.buildingSlots = 4;
      corp.level = 1;
    });
    const res = await c.api.post(`/api/accounts/${c.id}/gameplay/lease/lease-earth/build-extractor`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^All 4\/4 of your corporation's building slots are in use\. Each new mining lease adds 2: file one on Mars \(at Mars Orbital Dock\) or Luna \(at Luna Gateway\)/);
    expect(res.body.error).not.toMatch(MISSING_VERBS);
  });
});
