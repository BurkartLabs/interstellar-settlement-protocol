import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// Bug #1124: the Suites say a lease "establishes a registered presence at this location, enabling your corporation
// to recruit personnel", and the claims office says "a registered corporate office is required before the ISA
// will process lease applications" -- but the server held to neither. An office rented anywhere, even one that had
// expired, satisfied every check. These test the four repro cases and that the normal path, done at one station,
// still works.
async function freshCorp() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const api = authed(app, accessToken);
  const corp = () => getAccountById(account.id).state.corp;
  return { id: account.id, api, corp };
}

describe("Bug #1124: office presence is per station and must not have lapsed", () => {
  it("refuses to hire with no office at all", async () => {
    const { id, api, corp } = await freshCorp();
    const before = corp().finances.credits;
    const res = await api.post(`/api/accounts/${id}/gameplay/hire`).send({ count: 3 });
    expect(res.status).toBe(400);
    expect(corp().employeeCount).toBe(0);
    expect(corp().finances.credits).toBe(before);
  });

  it("refuses to hire with only an expired office at the docked station", async () => {
    const { id, api, corp } = await freshCorp();
    mutateAccountState(id, (state) => {
      state.corp.offices = [{ stationId: "earth-station-prime", rentedAt: Date.now() - 8 * 86_400_000, rentedUntil: Date.now() - 3_600_000 }];
    });
    const res = await api.post(`/api/accounts/${id}/gameplay/hire`).send({ count: 3 });
    expect(res.status).toBe(400);
    expect(corp().employeeCount).toBe(0);
  });

  it("refuses to rent an office at a station the corporation is not docked at", async () => {
    const { id, api, corp } = await freshCorp();
    const res = await api.post(`/api/accounts/${id}/gameplay/rent-office`).send({ stationId: "mars-orbital-dock" });
    expect(res.status).toBe(400);
    expect(corp().offices).toEqual([]);
  });

  it("refuses to rent an office in a system the corporation cannot reach", async () => {
    const { id, api, corp } = await freshCorp();
    const res = await api.post(`/api/accounts/${id}/gameplay/rent-office`).send({ stationId: "centauri-prime-station" });
    expect(res.status).toBe(400);
    expect(corp().offices).toEqual([]);
  });

  it("refuses to file a lease with an office that is only at a different station", async () => {
    const { id, api, corp } = await freshCorp();
    mutateAccountState(id, (state) => {
      // Docked at Earth (the default) with an office only at Mars, and enough staff that the check under
      // test -- the office -- is the only thing standing between this request and a 200.
      state.corp.employeeCount = 5;
      state.corp.offices = [{ stationId: "mars-orbital-dock", rentedAt: Date.now(), rentedUntil: Date.now() + 7 * 86_400_000 }];
    });
    const res = await api.post(`/api/accounts/${id}/gameplay/purchase-lease`).send({ body: "earth" });
    expect(res.status).toBe(400);
    expect(corp().miningLeases || []).toEqual([]);
  });

  it("refuses to file a lease with an office at the right station that has expired", async () => {
    const { id, api, corp } = await freshCorp();
    mutateAccountState(id, (state) => {
      state.corp.employeeCount = 5;
      state.corp.offices = [{ stationId: "earth-station-prime", rentedAt: Date.now() - 8 * 86_400_000, rentedUntil: Date.now() - 3_600_000 }];
    });
    const res = await api.post(`/api/accounts/${id}/gameplay/purchase-lease`).send({ body: "earth" });
    expect(res.status).toBe(400);
    expect(corp().miningLeases || []).toEqual([]);
  });

  it("refuses to start a mining cycle with an active office that is only at a different station", async () => {
    const { id, api, corp } = await freshCorp();
    mutateAccountState(id, (state) => {
      const c = state.corp;
      c.offices = [{ stationId: "mars-orbital-dock", rentedAt: Date.now(), rentedUntil: Date.now() + 7 * 86_400_000 }];
      c.miningLeases = [{ id: "lease-e", body: "Earth", buildingSlots: 2, extractorIds: ["ext-basic-1"] }];
      c.mining = { silicateExtractors: [{ id: "ext-basic-1", name: "Basic Extractor Yard #1", active: false, leaseId: "lease-e" }] };
    });
    const res = await api.post(`/api/accounts/${id}/gameplay/lease/lease-e/start-mining`).send({ amount: 40, hours: 1, extractorId: "ext-basic-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no office at this station/i);
    expect(corp().mining.silicateExtractors[0].active).toBe(false);
  });

  it("still distinguishes an expired office here from no office at all", async () => {
    const { id, api, corp } = await freshCorp();
    mutateAccountState(id, (state) => {
      const c = state.corp;
      c.offices = [{ stationId: "earth-station-prime", rentedAt: Date.now() - 8 * 86_400_000, rentedUntil: Date.now() - 3_600_000 }];
      c.miningLeases = [{ id: "lease-e", body: "Earth", buildingSlots: 2, extractorIds: ["ext-basic-1"] }];
      c.mining = { silicateExtractors: [{ id: "ext-basic-1", name: "Basic Extractor Yard #1", active: false, leaseId: "lease-e" }] };
    });
    const res = await api.post(`/api/accounts/${id}/gameplay/lease/lease-e/start-mining`).send({ amount: 40, hours: 1, extractorId: "ext-basic-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  it("the normal path still works: rent an office here, hire, and file a lease here", async () => {
    const { id, api, corp } = await freshCorp();
    const rent = await api.post(`/api/accounts/${id}/gameplay/rent-office`).send({ stationId: "earth-station-prime", durationDays: 7 });
    expect(rent.status).toBe(200);
    const hire = await api.post(`/api/accounts/${id}/gameplay/hire`).send({ count: 5 });
    expect(hire.status).toBe(200);
    const lease = await api.post(`/api/accounts/${id}/gameplay/purchase-lease`).send({ body: "earth" });
    expect(lease.status).toBe(200);
    expect(corp().offices).toHaveLength(1);
    expect(corp().employeeCount).toBe(5);
    expect(corp().miningLeases).toHaveLength(1);
  });
});
