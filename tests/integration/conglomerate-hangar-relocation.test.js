import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { SYSTEMS_BY_ID } from "../../server/game/catalog.js";
import { homeStationOf } from "../../server/game/conglomerates.js";
import { answerInvitation, findConglomerate, inviteCorporation } from "../../server/game/membership.js";
import { dissolveConglomerate, setMemberRole } from "../../server/game/conglomerateRoles.js";
import { billOfMaterials, settleStationProjects } from "../../server/game/stationProjects.js";
import { stationAtBody, stationById } from "../../server/game/stations.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";

// ISP-212a (AB#4654): once a conglomerate owns a station, the hangar moves there and it becomes the home station, so
// pooled goods are where the members mine (docs/design/CONGLOMERATES.md Part 2, "What the station gives members").
// The goods move with it, free: nothing is created, destroyed or charged. The hangar's routes, the station project's
// hangar source and dissolution all read the new home station.
const DAY = 24 * 60 * 60 * 1000;
const EARTH = C.homeStationId;
const BOM = billOfMaterials();
let seq = 0;
const claimed = new Set();

async function player(credits = 3_000_000) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  raw.createdAt = Date.now() - (C.minMemberAgeDays + 1) * DAY; // Bug #4801: registered long enough ago to join a conglomerate
  raw.state.corp.finances.credits = credits;
  raw.state.corp.currentStationId = C.charterStationId;
  return { id: reg.account.id, corp: () => raw.state.corp, corpId: raw.state.corp.publicId, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
}
const stock = (p, stationId, item, n) => { const inv = ((p.corp().inventory ||= {})[stationId] ||= {}); inv[item] = (inv[item] || 0) + n; };

/** A level-4 conglomerate (founder, director, member) whose member leases in a fresh system, and a body to build on. */
async function guild() {
  const f = await player();
  f.corp().createdAt = Date.now() - 8 * DAY;
  accountsStore.accounts[f.id].createdAt = Date.now() - 8 * DAY;
  const res = await f.api.post(`${f.base}/conglomerates`).send({ name: `Movers ${Date.now() % 1e6} ${(seq += 1)}`, emblem: 1, colour: 1 });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const c = findConglomerate(res.body.conglomerate.id);
  const join = async () => {
    const p = await player();
    const inv = inviteCorporation(f.id, c.id, p.corpId);
    expect(answerInvitation(p.id, c.id, inv.invitation.id, "accept").refused).toBeUndefined();
    return p;
  };
  const d = await join();
  setMemberRole(f.id, c.id, d.corpId, "director");
  const m = await join();
  c.level = C.stationMinLevel;
  const s = [...SYSTEMS_BY_ID.values()].find((x) => x.id !== "sol" && (x.bodies || []).filter((b) => !stationAtBody(b.name) && !claimed.has(b.name)).length >= 2);
  const bodies = s.bodies.map((b) => b.name).filter((n) => !stationAtBody(n) && !claimed.has(n));
  claimed.add(bodies[1]);
  m.corp().miningLeases = [{ id: `lease-reloc-${seq}`, body: bodies[0], leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [], issuedAt: Date.now() }];
  const hangar = (p, op = "") => `${p.base}/conglomerates/${c.id}/hangar${op}`;
  return { f, d, m, c, people: [f, d, m], systemId: s.id, body: bodies[1], hangar };
}

/** Start the project and fund it in full from the member's own stock, through the routes; returns the project. */
async function fund(g) {
  const url = (p) => `${p.base}/conglomerates/${g.c.id}/station-project`;
  expect((await g.f.api.post(url(g.f)).send({ systemId: g.systemId, body: g.body, suffix: 1 })).status).toBe(201);
  g.m.corp().finances.credits = BOM.credits + 10;
  const contribute = (body) => g.m.api.post(`${url(g.m)}/contribute`).send(body);
  expect((await contribute({ source: "own", credits: BOM.credits })).status).toBe(200);
  for (const [item, n] of Object.entries(BOM.goods)) {
    stock(g.m, EARTH, item, n);
    const res = await contribute({ source: "own", item, quantity: n });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  return g.c.stationProject;
}

/** Every unit of every item the members hold anywhere, plus the hangar's: what a move must conserve. */
function goodsEverywhere(g) {
  const total = {};
  const add = (item, n) => { total[item] = (total[item] || 0) + (Number(n) || 0); };
  for (const p of g.people) for (const inv of Object.values(p.corp().inventory || {})) for (const [item, n] of Object.entries(inv || {})) add(item, n);
  for (const [item, n] of Object.entries(g.c.hangar?.items || {})) add(item, n);
  return Object.fromEntries(Object.entries(total).filter(([, n]) => n));
}
const credits = (g) => g.people.reduce((s, p) => s + p.corp().finances.credits, 0) + g.c.treasury.credits;

/** A conglomerate with goods in its hangar at Earth Station Prime, whose station has just opened. */
async function builtWithGoods() {
  const g = await guild();
  stock(g.f, EARTH, "Silicates", 900);
  stock(g.f, EARTH, "Nickel", 301);
  for (const [item, quantity] of [["Silicates", 900], ["Nickel", 301]]) {
    const res = await g.f.api.post(g.hangar(g.f, "/deposit")).send({ stationId: EARTH, item, quantity });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  const p = await fund(g);
  expect(g.c.hangar).toMatchObject({ stationId: EARTH, items: { Silicates: 900, Nickel: 301 } });
  const before = { goods: goodsEverywhere(g), credits: credits(g) };
  settleStationProjects(p.completesAt);
  const station = stationById(p.stationId);
  expect(g.c.station?.id).toBe(station.id);
  return { g, p, station, before };
}

describe("the hangar moves to the conglomerate's station (ISP-212a, AB#4654)", () => {
  it("moves with its goods when the station opens, free: nothing is created, destroyed or charged", async () => {
    const { g, p, station, before } = await builtWithGoods();
    expect(g.c.hangar).toMatchObject({ stationId: station.id, items: { Silicates: 900, Nickel: 301 } });
    expect(homeStationOf(g.c)).toBe(station.id);
    expect(goodsEverywhere(g)).toEqual(before.goods);
    expect(credits(g)).toBe(before.credits);
    // one ledger row per item held, amount 0, from Earth Station Prime to the station, dated when it opened; each item's
    // rows still sum to its stock
    const moved = g.c.hangar.ledger.filter((r) => r.kind === "relocated");
    expect(moved.map((r) => [r.item, r.amount, r.balanceAfter, r.from, r.stationId, r.at]).sort()).toEqual([
      ["Nickel", 0, 301, EARTH, station.id, p.completesAt], ["Silicates", 0, 900, EARTH, station.id, p.completesAt]
    ]);
    for (const [item, units] of Object.entries(g.c.hangar.items)) expect(g.c.hangar.ledger.filter((r) => r.item === item).reduce((s, r) => s + r.amount, 0)).toBe(units);
    // what the members see
    const view = (await g.d.api.get(g.hangar(g.d))).body;
    expect(view).toMatchObject({ stationId: station.id, stationName: station.name });
  });

  it("deposits and withdrawals happen at the station now, and are refused at Earth Station Prime", async () => {
    const { g, station } = await builtWithGoods();
    stock(g.m, EARTH, "Silicates", 50);
    const atEarth = await g.m.api.post(g.hangar(g.m, "/deposit")).send({ stationId: EARTH, item: "Silicates", quantity: 50 });
    expect(atEarth.status).toBe(409);
    expect(atEarth.body.error).toContain(station.name);
    g.m.corp().currentStationId = station.id; // docked at the conglomerate's station
    stock(g.m, station.id, "Silicates", 40);
    expect((await g.m.api.post(g.hangar(g.m, "/deposit")).send({ stationId: station.id, item: "Silicates", quantity: 40 })).status).toBe(200);
    g.f.corp().currentStationId = station.id;
    const out = await g.f.api.post(g.hangar(g.f, "/withdraw")).send({ stationId: station.id, item: "Nickel", quantity: 60 });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(g.f.corp().inventory[station.id].Nickel).toBe(60);
    expect(g.c.hangar.items).toMatchObject({ Silicates: 940, Nickel: 241 });
  });

  it("dissolution splits the hangar into each member's stock at the station", async () => {
    const { g, station, before } = await builtWithGoods();
    const res = dissolveConglomerate(g.f.id, g.c.id);
    expect(res.refused, JSON.stringify(res)).toBeUndefined();
    expect(g.people.map((p) => p.corp().inventory?.[station.id]?.Silicates)).toEqual([300, 300, 300]);
    expect(g.people.map((p) => p.corp().inventory?.[station.id]?.Nickel)).toEqual([101, 100, 100]); // the founder takes the remainder
    expect(g.people.every((p) => !p.corp().inventory?.[EARTH]?.Nickel)).toBe(true);
    expect(goodsEverywhere(g)).toEqual(before.goods);
  });

  it("a hangar left at Earth Station Prime by a station built before the move moves on its next read, dated when the station opened", async () => {
    const { g, station } = await builtWithGoods();
    // as the server before ISP-212a left it: the station built, the hangar still in Sol, no relocation rows
    g.c.hangar.stationId = EARTH;
    g.c.hangar.ledger = g.c.hangar.ledger.filter((r) => r.kind !== "relocated");
    const view = (await g.f.api.get(g.hangar(g.f))).body;
    expect(view).toMatchObject({ stationId: station.id, stationName: station.name });
    expect(g.c.hangar.ledger.filter((r) => r.kind === "relocated").map((r) => r.at)).toEqual([g.c.station.builtAt, g.c.station.builtAt]);
    expect(g.c.hangar.items).toEqual({ Silicates: 900, Nickel: 301 });
  });

  it("a conglomerate with no station keeps its hangar at Earth Station Prime", async () => {
    const g = await guild();
    expect(homeStationOf(g.c)).toBe(EARTH);
    expect((await g.f.api.get(g.hangar(g.f))).body.stationId).toBe(EARTH);
  });
});
