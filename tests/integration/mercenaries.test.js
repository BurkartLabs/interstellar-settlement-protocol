import { describe, it, expect, vi, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { fabricationTick } from "../../server/ticks.js";
import { ledgerEntries, settlementTotals } from "../../server/settlement.js";
import { mercenaryUseAllowed, recordContractLosses, unitValue, unitsValue } from "../../server/mercenaries.js";

// ISP-176 (AB#870): mercenary contracts through the real routes, the settlement ledger and the server's own tick. The
// raid and mercenary design (AB#859) is not written yet; this is the shape the PR states.

afterEach(() => vi.restoreAllMocks());

const EARTH = "earth-station-prime";
const TERMS = { termHours: 24, price: 5_000, collateral: 15_000, allowedUse: "defense" }; // the fleet is worth 19,468

async function corporation(credits = 1_000_000, units = { lf: 10, ds: 2 }) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = EARTH;
    state.corp.finances.credits = credits;
    state.corp.military = { units };
  }, { sanitize: false, settleMining: false });
  const api = authed(app, accessToken);
  const at = (path) => `/api/accounts/${account.id}/gameplay${path}`;
  return {
    id: account.id, api, at,
    corp: () => getAccountById(account.id).state.corp,
    credits: () => getAccountById(account.id).state.corp.finances.credits,
    state: () => JSON.stringify(getAccountById(account.id).state)
  };
}
async function withFleet() {
  const owner = await corporation();
  const fleetId = (await owner.api.post(owner.at("/fleets/form")).send({ lf: 8, ds: 2, name: "Corsair" })).body.fleet.id;
  return { owner, fleetId };
}
const offer = async (owner, fleetId, terms = TERMS) => owner.api.post(owner.at("/mercenaries/offer")).send({ fleetId, ...terms });
function tickAt(at) {
  vi.spyOn(Date, "now").mockReturnValue(at);
  fabricationTick();
  vi.restoreAllMocks();
}

describe("offering (AB#870)", () => {
  it("takes numbers and enums only, with the collateral at most the fleet's value", async () => {
    const { owner, fleetId } = await withFleet();
    const value = unitsValue({ lf: 8, ds: 2 });
    for (const bad of [{ termHours: 13 }, { price: 50 }, { allowedUse: "anything" }, { price: "cheap" }, { collateral: value + 1 }]) {
      const res = await offer(owner, fleetId, { ...TERMS, ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(owner.corp().military.fleets[0].contract).toBeUndefined();
    const ok = await offer(owner, fleetId);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.offer).toMatchObject({ termHours: 24, price: 5000, collateral: 15000, allowedUse: "defense", fleetName: "Corsair", value });
  });

  it("escrows the fleet: its owner can give it no order while it is on offer", async () => {
    const { owner, fleetId } = await withFleet();
    await offer(owner, fleetId);
    const other = (await owner.api.post(owner.at("/fleets/form")).send({ lf: 2 })).body.fleet.id;
    for (const [path, body] of [[`/fleets/${fleetId}/deploy`, { toStationId: "mars-orbital-dock" }], [`/fleets/${fleetId}/split`, { lf: 1 }],
      [`/fleets/${fleetId}/disband`, {}], [`/fleets/${fleetId}/merge`, { intoFleetId: other }], [`/fleets/${other}/merge`, { intoFleetId: fleetId }]]) {
      const res = await owner.api.post(owner.at(path)).send(body);
      expect(res.status, path).toBe(400);
      expect(res.body.error).toMatch(/under a mercenary contract/);
    }
    expect((await offer(owner, fleetId)).status).toBe(409);
  });
});

describe("hiring (AB#870)", () => {
  it("holds price plus collateral in the contract's escrow through settleTransfer, and puts the fleet under the renter's command", async () => {
    const { owner, fleetId } = await withFleet();
    const offerId = (await offer(owner, fleetId)).body.offer.id;
    const renter = await corporation(100_000, {});
    const res = await renter.api.post(renter.at(`/mercenaries/${offerId}/hire`)).send({});
    expect(res.status).toBe(200);
    expect(renter.credits()).toBe(100_000 - 20_000);
    const hold = ledgerEntries().find((e) => e.key === `merc:${offerId}:hold`);
    expect(hold).toMatchObject({ reason: "escrow-hold", credits: 20_000, to: `escrow:merc-${offerId}` });
    expect(settlementTotals().escrow[`escrow:merc-${offerId}`]).toBe(20_000);
    expect(renter.corp().military.hired[0]).toMatchObject({ contractId: offerId, fleetName: "Corsair", allowedUse: "defense", units: { lf: 8, ds: 2 } });
    expect(owner.corp().military.fleets.find((f) => f.id === fleetId).contract).toMatchObject({ state: "hired" });
  });

  it("refuses self-hire, a withdrawn offer and a second hire, moving nothing each time", async () => {
    const { owner, fleetId } = await withFleet();
    const offerId = (await offer(owner, fleetId)).body.offer.id;
    const ownerBefore = owner.credits();
    expect((await owner.api.post(owner.at(`/mercenaries/${offerId}/hire`)).send({})).status).toBe(400);
    expect(owner.credits()).toBe(ownerBefore);

    const renter = await corporation(100_000, {});
    expect((await owner.api.post(owner.at(`/mercenaries/${offerId}/withdraw`)).send({})).status).toBe(200);
    expect(owner.corp().military.fleets.find((f) => f.id === fleetId).contract).toBeUndefined();
    const before = renter.state();
    expect((await renter.api.post(renter.at(`/mercenaries/${offerId}/hire`)).send({})).status).toBe(409);
    expect(renter.state()).toBe(before);
    expect(ledgerEntries().some((e) => e.key === `merc:${offerId}:hold`)).toBe(false);

    const again = (await offer(owner, fleetId)).body.offer.id;
    expect((await renter.api.post(renter.at(`/mercenaries/${again}/hire`)).send({})).status).toBe(200);
    const third = await corporation(100_000, {});
    const thirdBefore = third.state();
    expect((await third.api.post(third.at(`/mercenaries/${again}/hire`)).send({})).status).toBe(409);
    expect(third.state()).toBe(thirdBefore);
  });

  it("gives the renter no way to disband, split, deploy, sell or re-hire the units", async () => {
    const { owner, fleetId } = await withFleet();
    const offerId = (await offer(owner, fleetId)).body.offer.id;
    const renter = await corporation(100_000, {});
    await renter.api.post(renter.at(`/mercenaries/${offerId}/hire`)).send({});
    const before = owner.state();
    for (const [path, body] of [[`/fleets/${fleetId}/disband`, {}], [`/fleets/${fleetId}/split`, { lf: 1 }], [`/fleets/${fleetId}/deploy`, { toStationId: "mars-orbital-dock" }]]) {
      expect((await renter.api.post(renter.at(path)).send(body)).status, path).toBe(404);
    }
    expect((await renter.api.post(renter.at("/mercenaries/offer")).send({ fleetId, ...TERMS })).status).toBe(404);
    expect((await renter.api.post(renter.at(`/mercenaries/${offerId}/withdraw`)).send({})).status).toBe(404);
    expect(owner.state()).toBe(before);
  });
});

describe("the end of the term (AB#870)", () => {
  it("without losses: the fleet returns to its owner, the owner has the price and the renter all the collateral back", async () => {
    const { owner, fleetId } = await withFleet();
    const offerId = (await offer(owner, fleetId)).body.offer.id;
    const renter = await corporation(100_000, {});
    const { endsAt } = (await renter.api.post(renter.at(`/mercenaries/${offerId}/hire`)).send({})).body.offer;
    const ownerBefore = owner.credits();
    tickAt(endsAt - 1);
    expect(owner.credits()).toBe(ownerBefore);
    tickAt(endsAt + 1);
    tickAt(endsAt + 2); // settled once
    expect(owner.credits()).toBe(ownerBefore + 5_000);
    expect(renter.credits()).toBe(100_000 - 5_000);
    expect(owner.corp().military.fleets.find((f) => f.id === fleetId)).toMatchObject({ units: { lf: 8, ds: 2 } });
    expect(owner.corp().military.fleets.find((f) => f.id === fleetId).contract).toBeUndefined();
    expect(renter.corp().military.hired).toEqual([]);
    expect(`escrow:merc-${offerId}` in settlementTotals().escrow).toBe(false); // released in full, so the escrow is gone
  });

  it("with losses: the lost units leave the owner's books, and the collateral pays their value to the owner before the rest goes back", async () => {
    const { owner, fleetId } = await withFleet();
    const offerId = (await offer(owner, fleetId, { ...TERMS, collateral: 15_000 })).body.offer.id;
    const renter = await corporation(100_000, {});
    const { endsAt } = (await renter.api.post(renter.at(`/mercenaries/${offerId}/hire`)).send({})).body.offer;
    recordContractLosses(offerId, { lf: 3 });
    const ownerBefore = owner.credits();
    tickAt(endsAt + 1);
    const lost = 3 * unitValue("lf");
    expect(owner.credits()).toBe(ownerBefore + 5_000 + Math.min(15_000, lost));
    expect(renter.credits()).toBe(100_000 - 5_000 - Math.min(15_000, lost));
    expect(owner.corp().military.units.lf).toBe(7);
    expect(owner.corp().military.fleets.find((f) => f.id === fleetId).units.lf).toBe(5);
  });

  it("caps what losses cost the renter at the collateral", async () => {
    const { owner, fleetId } = await withFleet();
    const offerId = (await offer(owner, fleetId, { ...TERMS, collateral: 1_000 })).body.offer.id;
    const renter = await corporation(100_000, {});
    const { endsAt } = (await renter.api.post(renter.at(`/mercenaries/${offerId}/hire`)).send({})).body.offer;
    recordContractLosses(offerId, { ds: 2 });
    tickAt(endsAt + 1);
    expect(renter.credits()).toBe(100_000 - 5_000 - 1_000);
  });
});

describe("allowed use (AB#870)", () => {
  it("keeps a defense-only fleet out of a raid; a PvE contract may defend and hunt; a raids contract may do all three", () => {
    expect(mercenaryUseAllowed({ allowedUse: "defense" }, "raids")).toBe(false);
    expect(mercenaryUseAllowed({ allowedUse: "defense" }, "defense")).toBe(true);
    expect(mercenaryUseAllowed({ allowedUse: "pve" }, "raids")).toBe(false);
    expect(mercenaryUseAllowed({ allowedUse: "pve" }, "pve")).toBe(true);
    expect(["defense", "pve", "raids"].every((u) => mercenaryUseAllowed({ allowedUse: "raids" }, u))).toBe(true);
  });
});
