import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore, listAccountNotifications } from "../../server/game/store.js";
import { SYSTEMS_BY_ID } from "../../server/game/catalog.js";
import { moveTreasury, moveHangar } from "../../server/game/conglomerates.js";
import { answerInvitation, findConglomerate, inviteCorporation, onConglomerateEvent } from "../../server/game/membership.js";
import { setMemberRole } from "../../server/game/conglomerateRoles.js";
import { STATION_NAME_SUFFIXES, billOfMaterials, settleStationProject, settleStationProjects } from "../../server/game/stationProjects.js";
import { stationAtBody, stationById, allStations } from "../../server/game/stations.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";

// ISP-210 (AB#905): a conglomerate builds a station as a funded construction project (docs/design/CONGLOMERATES.md
// Part 2, "Co-owned stations"). Who may start it and where; funding from members' own stock and from the pool; the
// build time; completion into the station registry, once; cancelling returns everything; and the misuse the item names.
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const BOM = billOfMaterials();
const events = [];
const stop = onConglomerateEvent((m) => events.push(m));
afterAll(() => stop());

async function player(credits = 3_000_000) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  raw.state.corp.finances.credits = credits;
  raw.state.corp.currentStationId = C.charterStationId;
  return { app, id: reg.account.id, raw, corp: () => raw.state.corp, corpId: raw.state.corp.publicId, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
}
/** A system nobody has built in yet, and a lease a member can hold there. */
function freshSystem() {
  const s = [...SYSTEMS_BY_ID.values()].find((x) => x.id !== "sol" && (x.bodies || []).filter((b) => !stationAtBody(b.name) && !claimed.has(b.name)).length >= 2);
  return { systemId: s.id, bodies: s.bodies.map((b) => b.name).filter((n) => !stationAtBody(n) && !claimed.has(n)) };
}
const claimed = new Set();

/** A level-4 conglomerate with a director and a member; the member holds a lease in a fresh system. */
async function guild({ level = C.stationMinLevel } = {}) {
  const f = await player();
  f.raw.createdAt = Date.now() - 8 * DAY;
  const res = await f.api.post(`${f.base}/conglomerates`).send({ name: `Builders ${Date.now() % 1e6} ${(seq += 1)}`, emblem: 1, colour: 1 });
  expect(res.status).toBe(201);
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
  c.level = level;
  const site = freshSystem();
  m.corp().miningLeases = [{ id: `lease-${seq}`, body: site.bodies[0], leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [], issuedAt: Date.now() }];
  const url = (p) => `${p.base}/conglomerates/${c.id}/station-project`;
  return { f, d, m, c, site, url, body: site.bodies[1] };
}
const start = (g, over = {}) => g.f.api.post(g.url(g.f)).send({ systemId: g.site.systemId, body: g.body, suffix: 1, ...over });
/** Credits and goods held anywhere the project touches: wallets, stock at the hangar's station, treasury, hangar, project. */
function holdings(g) {
  const people = [g.f, g.d, g.m];
  const at = g.c.hangar?.stationId || C.homeStationId;
  const goods = {};
  const add = (item, n) => { goods[item] = (goods[item] || 0) + (Number(n) || 0); };
  for (const p of people) for (const [item, n] of Object.entries(p.corp().inventory?.[at] || {})) add(item, n);
  for (const [item, n] of Object.entries(g.c.hangar?.items || {})) add(item, n);
  for (const [item, n] of Object.entries(g.c.stationProject?.goods || {})) add(item, n);
  return {
    credits: people.reduce((s, p) => s + p.corp().finances.credits, 0) + g.c.treasury.credits + (g.c.stationProject?.credits || 0),
    goods: Object.fromEntries(Object.entries(goods).filter(([, n]) => n))
  };
}
/** Stock a corporation's own goods at the hangar's station. */
function stock(p, item, n) {
  const inv = ((p.corp().inventory ||= {})[C.homeStationId] ||= {});
  inv[item] = (inv[item] || 0) + n;
}

describe("starting a station project (ISP-210, AB#905)", () => {
  it("files one for the founder, at the Bureau, at an open orbit in a system where a member holds a lease", async () => {
    const g = await guild();
    const res = await start(g, { suffix: 2 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.project).toMatchObject({ state: "funding", systemId: g.site.systemId, body: g.body, name: `${g.body} ${STATION_NAME_SUFFIXES[1]}`, needs: BOM, has: { credits: 0, goods: {} } });
    claimed.add(g.body);
    const view = (await g.m.api.get(g.url(g.m))).body;
    expect(view.project.name).toBe(res.body.project.name);
    expect(events.some((e) => e.conglomerateId === g.c.id && e.event === "conglomerate:station-project" && e.payload.kind === "started")).toBe(true);
    expect(listAccountNotifications(g.m.id).notifications.find((n) => n.title === `${g.c.name} is building a station`)?.protocol).toEqual({ meaning: "queued", screen: "conglomerate" }); // ISP-254 (AB#4821): Lodged
  });

  it("refuses each thing the design rules out, each with its own reason, and files nothing", async () => {
    const g = await guild();
    const cases = [
      [() => g.d.api.post(g.url(g.d)).send({ systemId: g.site.systemId, body: g.body, suffix: 1 }), 403, "not-permitted"],
      [() => g.m.api.post(g.url(g.m)).send({ systemId: g.site.systemId, body: g.body, suffix: 1 }), 403, "not-permitted"],
      [() => start(g, { systemId: "sol", body: "Earth" }), 409, "body-taken"],
      [() => start(g, { systemId: "sol", body: g.site.bodies.find((b) => b !== g.body) || "Mercury" }), 400, "unknown-body"],
      [() => start(g, { systemId: "sol", body: allStations().length && SYSTEMS_BY_ID.get("sol").bodies.find((b) => !stationAtBody(b.name))?.name }), 409, "no-lease-in-system"],
      [() => start(g, { suffix: 7 }), 400, null],
      [() => start(g, { systemId: "andromeda" }), 400, null]
    ];
    for (const [call, status, code] of cases) {
      const res = await call();
      expect(res.status, JSON.stringify(res.body)).toBe(status);
      if (code) expect(res.body.code).toBe(code);
    }
    g.f.corp().currentStationId = "luna-gateway";
    expect((await start(g)).body.code).toBe("not-at-bureau");
    g.f.corp().currentStationId = C.charterStationId;
    g.c.level = C.stationMinLevel - 1;
    expect((await start(g)).body.code).toBe("level-too-low");
    g.c.level = C.stationMinLevel;
    g.c.arrearsSince = Date.now();
    expect((await start(g)).body.code).toBe("in-arrears");
    g.c.arrearsSince = null;
    expect(g.c.stationProject ?? null).toBeNull();
    // at most one at a time, and not at a body another conglomerate has claimed
    expect((await start(g)).status).toBe(201);
    claimed.add(g.body);
    expect((await start(g, { body: g.site.bodies.find((b) => b !== g.body) })).body.code).toBe("project-open");
    const other = await guild();
    other.m.corp().miningLeases = [{ id: "lease-x", body: g.site.bodies[0], issuedAt: Date.now() }];
    expect((await other.f.api.post(other.url(other.f)).send({ systemId: g.site.systemId, body: g.body, suffix: 1 })).body.code).toBe("body-claimed");
  });
});

describe("funding it (ISP-210, AB#905)", () => {
  it("takes a member's own credits and goods and records them as that member's; the founder moves the pool, recorded as nobody's", async () => {
    const g = await guild();
    expect((await start(g)).status).toBe(201);
    claimed.add(g.body);
    const contribute = (p, body) => p.api.post(`${g.url(p)}/contribute`).send(body);
    const mBefore = g.m.corp().finances.credits;
    const own = await contribute(g.m, { source: "own", credits: 400_000 });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(g.m.corp().finances.credits).toBe(mBefore - 400_000);
    expect(g.m.corp().finances.expensesByCategory["conglomerate-station"]).toBe(400_000);
    stock(g.m, "Structural Alloys", 300);
    expect((await contribute(g.m, { source: "own", item: "structural-alloys", quantity: 300 })).status).toBe(200);
    expect(g.m.corp().inventory[C.homeStationId]["Structural Alloys"] ?? 0).toBe(0);
    // the pool: members may not move it; the founder may, and the ledgers say so
    expect((await contribute(g.m, { source: "treasury", credits: 1 })).status).toBe(403);
    moveTreasury(g.c, { at: Date.now(), kind: "deposit", corp: g.d.corpId, amount: 1_000_000, by: g.d.corpId });
    moveHangar(g.c, { at: Date.now(), kind: "deposit", corp: g.d.corpId, item: "Pressure Vessels", quantity: 500, by: g.d.corpId });
    const tBefore = g.c.treasury.credits;
    expect((await contribute(g.f, { source: "treasury", credits: 600_000 })).status).toBe(200);
    expect(g.c.treasury.credits).toBe(tBefore - 600_000);
    expect(g.c.ledger.at(-1)).toMatchObject({ kind: "station-project", amount: -600_000 });
    expect((await contribute(g.f, { source: "hangar", item: "Pressure Vessels", quantity: 500 })).status).toBe(200);
    expect(g.c.hangar.items["Pressure Vessels"] ?? 0).toBe(0);
    expect(g.c.hangar.ledger.at(-1)).toMatchObject({ kind: "station-project", amount: -500 });
    const view = (await g.d.api.get(g.url(g.d))).body.project;
    expect(view.has).toEqual({ credits: 1_000_000, goods: { "Structural Alloys": 300, "Pressure Vessels": 500 } });
    expect(view.byMember).toEqual([{ corp: g.m.corpId, corpName: g.m.corp().corporationName, value: 400_000 + 300 * 25 }]);
    expect(view.contributions.filter((r) => r.corp === null).map((r) => r.source)).toEqual(["treasury", "hangar"]);
    expect(view.remaining.credits).toBe(BOM.credits - 1_000_000);
  });

  it("refuses more than is held, more than is needed, a thing not in the bill, both or neither, and another conglomerate's project", async () => {
    const g = await guild();
    expect((await start(g)).status).toBe(201);
    claimed.add(g.body);
    const contribute = (p, body, url = `${g.url(p)}/contribute`) => p.api.post(url).send(body);
    g.m.corp().finances.credits = 1_000;
    const before = holdings(g);
    const cases = [
      // AB#4821 (ISP-6): each says what to do next
      [{ source: "own", credits: 1_001 }, 409, "insufficient-credits", /it cannot put in 1,001\. Put in 1,000 or less\.$/],
      [{ source: "own", credits: BOM.credits + 1 }, 409, "over-need", /more credits\. Put in [\d,]+ or less\.$/],
      [{ source: "own", item: "Structural Alloys", quantity: 1 }, 409, "insufficient-stock", /Bring more there, or put in fewer\.$/],
      [{ source: "own", item: "Iron Ore", quantity: 1 }, 409, "not-needed", /Choose one of the goods its bill lists\.$/],
      [{ source: "own", credits: 10, item: "Structural Alloys", quantity: 1 }, 400, "credits-or-goods"],
      [{ source: "own" }, 400, "credits-or-goods"],
      [{ source: "treasury", item: "Structural Alloys", quantity: 1 }, 403, "not-permitted"] // a member, and the pool: permission first
    ];
    for (const [body, status, code, next] of cases) {
      const res = await contribute(g.m, body);
      expect(res.status, JSON.stringify(body)).toBe(status);
      if (code) expect(res.body.code, JSON.stringify(body)).toBe(code);
      if (next) expect(res.body.error, JSON.stringify(body)).toMatch(next);
    }
    const overTreasury = (await contribute(g.f, { source: "treasury", credits: g.c.treasury.credits + 1 })).body;
    expect(overTreasury.code).toBe("insufficient-treasury");
    expect(overTreasury.error).toMatch(/credits\. Put in [\d,]+ or less\.$/); // AB#4821 (ISP-6)
    const overHangar = (await contribute(g.f, { source: "hangar", item: "Structural Alloys", quantity: 1 })).body;
    expect(overHangar.code).toBe("insufficient-hangar");
    expect(overHangar.error).toMatch(/Put in 0 or fewer\.$/);
    expect((await contribute(g.f, { source: "treasury", item: "Structural Alloys", quantity: 1 })).body.code).toBe("treasury-holds-credits");
    // an outsider, and a member of another conglomerate, cannot reach this project at all
    const other = await guild();
    const res = await contribute(other.m, { source: "own", credits: 10 }, `${other.m.base}/conglomerates/${g.c.id}/station-project/contribute`);
    expect(res.status).toBe(404);
    expect(g.c.stationProject.contributions).toEqual([]);
    expect(holdings(g)).toEqual(before); // every refusal moved nothing
  });
});

describe("building it (ISP-210, AB#905)", () => {
  /** A project funded in full from members' own stock: returns the time it was funded. */
  async function fund(g) {
    expect((await start(g)).status).toBe(201);
    claimed.add(g.body);
    const contribute = (body) => g.m.api.post(`${g.url(g.m)}/contribute`).send(body);
    expect((await contribute({ source: "own", credits: BOM.credits })).status).toBe(200);
    for (const [item, n] of Object.entries(BOM.goods)) {
      stock(g.m, item, n);
      const res = await contribute({ source: "own", item, quantity: n });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    expect(g.c.stationProject).toMatchObject({ state: "building" });
    expect(g.c.stationProject.completesAt - g.c.stationProject.fundedAt).toBe(C.stationBuildDays * DAY);
    expect((await contribute({ source: "own", credits: 1 })).body.code).toBe("fully-funded");
    return g.c.stationProject;
  }

  it("opens the station after the build time: in the registry, in GET /api/stations, and every member told in the room", async () => {
    const g = await guild();
    g.m.corp().finances.credits = BOM.credits + 10;
    const p = await fund(g);
    settleStationProjects(p.completesAt - 1);
    expect(stationAtBody(g.body)).toBeNull();
    settleStationProjects(p.completesAt);
    const station = stationById(p.stationId);
    expect(station).toMatchObject({ name: p.name, systemId: g.site.systemId, body: g.body, jurisdiction: "conglomerate", owner: { type: "conglomerate", id: g.c.id } });
    expect(g.c.station).toMatchObject({ id: station.id, projectId: p.id });
    expect(g.c.station.contributions.every((r) => r.corp === g.m.corpId)).toBe(true);
    expect(g.c.stationProject).toBeNull();
    const pub = (await request(g.f.app).get("/api/stations")).body.stations.find((s) => s.id === station.id);
    expect(pub).toMatchObject({ ownerType: "conglomerate", ownerName: g.c.name });
    for (const p2 of [g.f, g.d, g.m]) expect(listAccountNotifications(p2.id).notifications.find((n) => n.title === `${station.name} is open`)?.protocol, p2.id).toEqual({ meaning: "complete", screen: "conglomerate" }); // AB#4821: Concluded
    expect(listAccountNotifications(g.d.id).notifications.find((n) => n.title === `${p.name} is fully funded`)?.protocol).toEqual({ meaning: "active", screen: "conglomerate" }); // In force
    expect(events.some((e) => e.conglomerateId === g.c.id && e.event === "conglomerate:station-built")).toBe(true);
    // twice is once
    const count = allStations().length;
    settleStationProjects(p.completesAt + DAY);
    expect(allStations().length).toBe(count);
    expect((await g.f.api.get(g.url(g.f))).body).toMatchObject({ project: null, station: { id: station.id }, canStart: false, openOrbits: [] });
    expect((await start(g, { body: g.site.bodies[0] })).body.code).toBe("owns-station");
  });

  it("completes without a second station when the station is already in the registry (a restart between the two writes)", async () => {
    const g = await guild();
    g.m.corp().finances.credits = BOM.credits;
    const p = await fund(g);
    settleStationProjects(p.completesAt);
    const count = allStations().length;
    g.c.stationProject = { ...p }; // as if the accounts were saved before the project was closed
    g.c.station = null;
    settleStationProject(g.c, p.completesAt + 1);
    expect(allStations().length).toBe(count);
    expect(g.c.station.id).toBe(p.stationId);
  });

  it("fails closed: a project short of its bill of materials creates no station", async () => {
    const g = await guild();
    g.m.corp().finances.credits = BOM.credits;
    const p = await fund(g);
    p.credits -= 1; // tampered, or a movement lost
    expect(settleStationProject(g.c, p.completesAt)).toMatchObject({ blocked: expect.stringMatching(/short/) });
    expect(stationById(p.stationId)).toBeNull();
    expect(g.c.station ?? null).toBeNull();
    expect(g.c.stationProject.blocked).toMatch(/short/);
  });
});

describe("cancelling it (ISP-210, AB#905)", () => {
  it("returns every contribution where it came from, so credits and goods are conserved exactly", async () => {
    const g = await guild();
    moveTreasury(g.c, { at: Date.now(), kind: "deposit", corp: g.d.corpId, amount: 500_000, by: g.d.corpId });
    moveHangar(g.c, { at: Date.now(), kind: "deposit", corp: g.d.corpId, item: "Precision Frames", quantity: 400, by: g.d.corpId });
    stock(g.m, "Structural Alloys", 1_000);
    const before = holdings(g);
    const mBefore = { credits: g.m.corp().finances.credits, alloys: 1_000 };
    const treasuryBefore = g.c.treasury.credits;
    expect((await start(g)).status).toBe(201);
    claimed.add(g.body);
    const contribute = (p, body) => p.api.post(`${g.url(p)}/contribute`).send(body);
    for (const [p, body] of [[g.m, { source: "own", credits: 250_000 }], [g.m, { source: "own", item: "Structural Alloys", quantity: 700 }],
      [g.f, { source: "treasury", credits: 300_000 }], [g.f, { source: "hangar", item: "Precision Frames", quantity: 400 }], [g.d, { source: "own", credits: 5 }]]) {
      expect((await contribute(p, body)).status, JSON.stringify(body)).toBe(200);
    }
    expect(holdings(g)).toEqual(before);
    // only the founder cancels; dissolving is refused while the project holds anything
    expect((await g.d.api.post(`${g.url(g.d)}/cancel`).send({})).status).toBe(403);
    expect((await g.f.api.post(`${g.f.base}/conglomerates/${g.c.id}/dissolve`).send({})).body.code).toBe("station-project-open");
    const res = await g.f.api.post(`${g.url(g.f)}/cancel`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(g.c.stationProject).toBeNull();
    expect(listAccountNotifications(g.m.id).notifications.find((n) => /was cancelled$/.test(n.title))?.protocol).toEqual({ meaning: "cancelled", screen: "conglomerate" }); // AB#4821: Withdrawn
    expect(holdings(g)).toEqual(before);
    expect(g.m.corp().finances.credits).toBe(mBefore.credits);
    expect(g.m.corp().inventory[C.homeStationId]["Structural Alloys"]).toBe(mBefore.alloys);
    expect(g.c.treasury.credits).toBe(treasuryBefore);
    expect(g.c.hangar.items["Precision Frames"]).toBe(400);
    expect(g.c.ledger.reduce((s, r) => s + r.amount, 0)).toBe(g.c.treasury.credits);
    expect(g.m.corp().finances.incomeByCategory?.["conglomerate-station-refund"] ?? g.m.corp().finances.dayBook.income["conglomerate-station-refund"]).toBe(250_000);
    expect(stationAtBody(g.body)).toBeNull();
    claimed.delete(g.body);
  });
});
