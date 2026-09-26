import { describe, it, expect, afterEach, vi } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { miningTick } from "../../server/ticks.js";

// ISP-98 (AB#788): the Cryo-vapor Extractor Array through the real routes: POST /gameplay/build on a Luna lease, the
// lease's slots counted by every route that reads them, and the server's own mining tick mining 1.2 times there.

afterEach(() => vi.restoreAllMocks());

async function corporation() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.finances.credits = 1_000_000;
    corp.buildingSlots = 6;
    corp.unlockedTech = ["tt-containment-physics"];
    corp.miningLeases = [
      { id: "lease-luna", body: "Luna", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [], issuedAt: Date.now() },
      { id: "lease-earth", body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [], issuedAt: Date.now() }
    ];
  });
  return { id: account.id, api: authed(app, accessToken), corp: () => getAccountById(account.id).state.corp, state: () => JSON.stringify(getAccountById(account.id).state) };
}
const post = (c, path, body = {}) => c.api.post(`/api/accounts/${c.id}/gameplay/${path}`).send(body);

describe("the Cryo-vapor Extractor Array through the routes (ISP-98)", () => {
  it("is refused on a lease that is not on Luna, and nothing changes", async () => {
    const c = await corporation();
    const before = c.state();
    const res = await post(c, "build", { buildingId: "cryo-vapor-extractor-array", leaseId: "lease-earth" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("The Cryo-vapor Extractor Array is built only on a Luna lease.");
    expect(c.state()).toBe(before);
  });

  it("is built on the Luna lease, once, and the lease's second slot is all a yard has left", async () => {
    const c = await corporation();
    const res = await post(c, "build", { buildingId: "cryo-vapor-extractor-array", leaseId: "lease-luna" });
    expect(res.status).toBe(200);
    expect(res.body.receipt).toMatchObject({ title: "Cryo-vapor Extractor Array Commissioned", costCredits: 80_000 });
    expect(c.corp().miningLeases.find((l) => l.id === "lease-luna").facilities).toEqual(["Cryo-vapor Extractor Array"]);
    const again = await post(c, "build", { buildingId: "cryo-vapor-extractor-array", leaseId: "lease-luna" });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("Your Luna lease already has a Cryo-vapor Extractor Array.");
    expect((await post(c, "lease/lease-luna/build-extractor")).status).toBe(200);
    const full = await post(c, "lease/lease-luna/build-extractor");
    expect(full.status).toBe(400);
    expect(full.body.error).toMatch(/^This Luna lease has used both of its building slots \(2\/2\)/);
  });

  it("the server's mining tick mines 1.2 times on its lease", async () => {
    const c = await corporation();
    expect((await post(c, "build", { buildingId: "cryo-vapor-extractor-array", leaseId: "lease-luna" })).status).toBe(200);
    expect((await post(c, "lease/lease-luna/build-extractor")).status).toBe(200);
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no downtime
    const now = Date.now();
    mutateAccountState(c.id, (state) => {
      const ex = state.corp.mining.silicateExtractors[0];
      Object.assign(ex, { active: true, startedAt: now - 3_600_000, lastTickAt: now - 3_600_000, endsAt: now + 3_600_000, throughputPerHour: 100, operationCostPerHour: 0 });
      state.corp.inventory = {};
    }, { settleMining: false });
    miningTick();
    // AB#830, AB#833: Luna yields Silicates 60, Helium-3 25, Bauxite 15; the array multiplies the whole yield.
    expect(c.corp().inventory["luna-gateway"]).toEqual({ Silicates: 72, "Helium-3": 30, Bauxite: 18 });
  });
});
