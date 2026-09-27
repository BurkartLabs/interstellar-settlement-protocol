import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { SYSTEMS_BY_ID } from "../../server/game/catalog.js";
import { answerInvitation, findConglomerate, inviteCorporation } from "../../server/game/membership.js";
import { setMemberRole } from "../../server/game/conglomerateRoles.js";
import { STATION_BUILDINGS, billOfMaterials, settleStationProject } from "../../server/game/stationProjects.js";
import fs from "node:fs";
import { allStations, stationAtBody } from "../../server/game/stations.js";
import { officeLeaseCost, officeRenewalCost } from "../../public/scripts/ceoEffects.js";
import { ECONOMY } from "../../server/economy.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";

// ISP-212 (AB#907): what membership is worth at the conglomerate's own station (docs/design/CONGLOMERATES.md Part 2,
// "What the station gives members"), each applied where the cost is computed. Every benefit is shown as a member and a
// non-member doing the same thing at the same station; membership is read at the moment of the order.
const DAY = 24 * 60 * 60 * 1000;
const BOM = billOfMaterials();
let seq = 0;

async function player(credits = 3_000_000) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  raw.state.corp.finances.credits = credits;
  raw.state.corp.currentStationId = C.charterStationId;
  return { id: reg.account.id, raw, corp: () => raw.state.corp, corpId: raw.state.corp.publicId, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
}

/** A conglomerate with a built station in a system that also has a neutral station; a member, and an outsider. */
async function stationWorld() {
  const system = [...SYSTEMS_BY_ID.values()].find((s) => s.id !== "sol"
    && allStations().some((x) => x.systemId === s.id && x.jurisdiction === "neutral")
    && (s.bodies || []).filter((b) => !stationAtBody(b.name)).length >= 1);
  const body = system.bodies.map((b) => b.name).find((n) => !stationAtBody(n));
  const neutral = allStations().find((x) => x.systemId === system.id && x.jurisdiction === "neutral");
  const f = await player();
  f.raw.createdAt = Date.now() - 8 * DAY;
  const res = await f.api.post(`${f.base}/conglomerates`).send({ name: `Members ${Date.now() % 1e6} ${(seq += 1)}`, emblem: 1, colour: 1 });
  expect(res.status).toBe(201);
  const c = findConglomerate(res.body.conglomerate.id);
  const m = await player();
  const inv = inviteCorporation(f.id, c.id, m.corpId);
  expect(answerInvitation(m.id, c.id, inv.invitation.id, "accept").refused).toBeUndefined();
  c.level = C.stationMinLevel;
  f.corp().miningLeases = [{ id: `lease-b-${seq}`, body: neutral.body, issuedAt: Date.now() }];
  expect((await f.api.post(`${f.base}/conglomerates/${c.id}/station-project`).send({ systemId: system.id, body, suffix: 2 })).status).toBe(201);
  const give = async (b) => expect((await f.api.post(`${f.base}/conglomerates/${c.id}/station-project/contribute`).send(b)).status).toBe(200);
  await give({ source: "own", credits: BOM.credits });
  for (const [item, n] of Object.entries(BOM.goods)) {
    const held = ((f.corp().inventory ||= {})[C.homeStationId] ||= {});
    held[item] = (held[item] || 0) + n;
    await give({ source: "own", item, quantity: n });
  }
  settleStationProject(c, c.stationProject.completesAt);
  const station = c.station.id;
  const outsider = await player();
  const dock = (p, at) => Object.assign(p.corp(), { currentSystemId: system.id, currentStationId: at, travel: null });
  return { f, m, outsider, c, station, neutral: neutral.id, system: system.id, dock };
}

describe("offices at the member rate (ISP-212, AB#907)", () => {
  it("a built station opens with the Orbital Executive Suites, where an office is leased", async () => {
    const w = await stationWorld();
    const catalog = JSON.parse(fs.readFileSync(new URL("../../data/buildings.json", import.meta.url), "utf8")).buildings.map((b) => b.id);
    for (const id of STATION_BUILDINGS) expect(catalog).toContain(id);
    expect(allStations().find((s) => s.id === w.station).buildingIds).toEqual(["orbital-executive-suites"]);
  });

  it("a member leases at 50% of the rent a non-member pays at the same station, and renews at 50% too", async () => {
    const w = await stationWorld();
    const pct = C.stationMemberRentPct;
    expect(pct).toBe(50);
    for (const p of [w.m, w.outsider]) w.dock(p, w.station);
    const lease = async (p) => {
      const before = p.corp().finances.credits;
      const res = await p.api.post(`${p.base}/gameplay/rent-office`).send({ stationId: w.station, durationDays: 14 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return { paid: before - p.corp().finances.credits, receipt: res.body.receipt };
    };
    const member = await lease(w.m);
    const outsider = await lease(w.outsider);
    expect(outsider.paid).toBe(officeLeaseCost(14));
    expect(member.paid).toBe(Math.round((officeLeaseCost(14) * pct) / 100));
    expect(member.receipt.costCredits).toBe(member.paid);
    const renew = async (p) => {
      const before = p.corp().finances.credits;
      expect((await p.api.post(`${p.base}/gameplay/renew-office`).send({ stationId: w.station, durationDays: 7 })).status).toBe(200);
      return before - p.corp().finances.credits;
    };
    expect(await renew(w.outsider)).toBe(officeRenewalCost(w.outsider.corp().completedInsights, 7));
    expect(await renew(w.m)).toBe(Math.round((officeRenewalCost(w.m.corp().completedInsights, 7) * pct) / 100));
  });

  it("is the member's own station only: at a neutral station, a member pays what anyone pays", async () => {
    const w = await stationWorld();
    w.dock(w.m, w.neutral);
    const before = w.m.corp().finances.credits;
    expect((await w.m.api.post(`${w.m.base}/gameplay/rent-office`).send({ stationId: w.neutral, durationDays: 7 })).status).toBe(200);
    expect(before - w.m.corp().finances.credits).toBe(officeLeaseCost(7));
  });

  it("is read at the moment of the order: a member removed a moment ago renews at the full rent", async () => {
    const w = await stationWorld();
    w.dock(w.m, w.station);
    expect((await w.m.api.post(`${w.m.base}/gameplay/rent-office`).send({ stationId: w.station, durationDays: 7 })).status).toBe(200);
    expect((await w.f.api.post(`${w.f.base}/conglomerates/${w.c.id}/members/${w.m.corpId}/remove`).send({})).status).toBe(200);
    const before = w.m.corp().finances.credits;
    expect((await w.m.api.post(`${w.m.base}/gameplay/renew-office`).send({ stationId: w.station, durationDays: 7 })).status).toBe(200);
    expect(before - w.m.corp().finances.credits).toBe(officeRenewalCost(w.m.corp().completedInsights, 7));
    // the roster decides, not the corporation's own pointer: a stale conglomerateId buys nothing
    w.m.corp().conglomerateId = w.c.id;
    const again = w.m.corp().finances.credits;
    expect((await w.m.api.post(`${w.m.base}/gameplay/renew-office`).send({ stationId: w.station, durationDays: 7 })).status).toBe(200);
    expect(again - w.m.corp().finances.credits).toBe(officeRenewalCost(w.m.corp().completedInsights, 7));
  });
});

describe("free logistics within the station's system (ISP-212, AB#907)", () => {
  const move = async (p, from, item, quantity) => {
    const held = ((p.corp().inventory ||= {})[from] ||= {});
    held[item] = (held[item] || 0) + quantity;
    const before = p.corp().finances.credits;
    const res = await p.api.post(`${p.base}/gameplay/transfer-resources`).send({ fromStationId: from, lines: [{ item, quantity }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { fee: before - p.corp().finances.credits, shipment: res.body.shipment };
  };

  it("a member moves goods to its station from another in the system for nothing; a non-member pays the in-system fee", async () => {
    const w = await stationWorld();
    for (const p of [w.m, w.outsider]) w.dock(p, w.station);
    const member = await move(w.m, w.neutral, "Silicates", 400);
    const outsider = await move(w.outsider, w.neutral, "Silicates", 400);
    expect(outsider.fee).toBe(400 * ECONOMY.logistics.sameSystemFeePerUnit);
    expect(outsider.fee).toBeGreaterThan(0);
    expect(member.fee).toBe(0);
    expect(member.shipment.fee).toBe(0);
  });

  it("and from its station to another in the system; but a jump out of the system costs a member the normal fee", async () => {
    const w = await stationWorld();
    w.dock(w.m, w.neutral);
    expect((await move(w.m, w.station, "Silicates", 100)).fee).toBe(0);
    const earth = "earth-station-prime";
    const jumps = await move(w.m, earth, "Silicates", 100); // from Sol to the station's system
    w.dock(w.outsider, w.neutral);
    expect(jumps.fee).toBeGreaterThan(0);
    expect(jumps.fee).toBe((await move(w.outsider, earth, "Silicates", 100)).fee);
  });

  it("a removed member pays the fee on its next transfer", async () => {
    const w = await stationWorld();
    w.dock(w.m, w.station);
    expect((await move(w.m, w.neutral, "Silicates", 50)).fee).toBe(0);
    expect((await w.f.api.post(`${w.f.base}/conglomerates/${w.c.id}/members/${w.m.corpId}/remove`).send({})).status).toBe(200);
    expect((await move(w.m, w.neutral, "Silicates", 50)).fee).toBe(50 * ECONOMY.logistics.sameSystemFeePerUnit);
  });
});

describe("what the page is told (ISP-212, AB#907)", () => {
  it("a member's conglomerate view names its station and the member rate; the station stays open to everyone by default", async () => {
    const w = await stationWorld();
    const view = (await w.m.api.get(`${w.m.base}/conglomerate`)).body;
    expect(view.conglomerate.station).toEqual({ id: w.station, officeRentPct: C.stationMemberRentPct });
    expect((await w.outsider.api.get(`${w.outsider.base}/conglomerate`)).body.conglomerate).toBeNull();
    Object.assign(w.outsider.corp(), { currentSystemId: w.system, currentStationId: w.neutral, travel: null });
    expect((await w.outsider.api.post(`${w.outsider.base}/gameplay/travel`).send({ toStationId: w.station })).status).toBe(200);
  });
});
