import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { findConglomerate } from "../../server/game/membership.js";
import { conglomerateList } from "../../server/game/conglomerates.js";
import { CONGLOMERATE_CATALOG as C, ROLES, can, isKnownAction } from "../../server/conglomerates.js";

// ISP-199 (AB#893): one permission check, can(), behind every conglomerate route; the roles table row by row; removal,
// promotion, the founder's transfer, succession and dissolution; and the misuse the item names.
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const uniqueName = (stem) => `${stem} ${Date.now() % 1e6} ${(seq += 1)}`;

async function player() {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  raw.createdAt = Date.now() - (C.minMemberAgeDays + 1) * DAY; // Bug #4801: registered long enough ago to join a conglomerate
  return { id: reg.account.id, token: reg.accessToken, raw, corpId: raw.state.corp.publicId, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
}

/** A founder, its conglomerate, and `directors` directors and `members` members, in joining order. */
async function guild({ directors = 0, members = 0 } = {}) {
  const f = await player();
  f.raw.createdAt = Date.now() - (C.minFounderAgeDays + 1) * DAY;
  f.raw.state.corp.currentStationId = C.charterStationId;
  f.raw.state.corp.finances.credits = 250_000;
  const res = await f.api.post(`${f.base}/conglomerates`).send({ name: uniqueName("Order"), emblem: 1, colour: 1 });
  expect(res.status).toBe(201);
  const cid = res.body.conglomerate.id;
  findConglomerate(cid).maxMembers = 20; // as if levels were bought (level-ups are a later story): room for the roster below
  const at = (p) => `${p.base}/conglomerates/${cid}`;
  const join = async () => {
    const p = await player();
    const inv = await f.api.post(`${at(f)}/invitations`).send({ corpId: p.corpId });
    expect((await p.api.post(`${at(p)}/invitations/${inv.body.invitation.id}/accept`)).status).toBe(200);
    return p;
  };
  const ds = [];
  for (let i = 0; i < directors; i += 1) {
    const d = await join();
    expect((await f.api.post(`${at(f)}/members/${d.corpId}/role`).send({ role: "director" })).status).toBe(200);
    ds.push(d);
  }
  const ms = [];
  for (let i = 0; i < members; i += 1) ms.push(await join());
  return { f, ds, ms, cid, at, c: () => findConglomerate(cid), roleOf: (p) => findConglomerate(cid)?.members.find((m) => m.corp === p.corpId)?.role ?? null };
}

describe("every conglomerate route goes through can() (ISP-199, AB#893)", () => {
  it("finds no conglomerate route on the router without a guard naming an action can() knows", async () => {
    const { app } = await getApp();
    const found = [];
    for (const layer of app._router.stack) {
      if (!layer.route || !/conglomerate/.test(layer.route.path)) continue;
      const handler = layer.route.stack.at(-1).handle;
      found.push(layer.route.path);
      expect(handler.conglomerateAction, `${layer.route.path} is not guarded by can()`).toBeDefined();
      const actions = typeof handler.conglomerateAction === "function"
        ? ["accept", "decline", "withdraw"].map((answer) => handler.conglomerateAction({ params: { answer } }))
        : [handler.conglomerateAction];
      for (const action of actions) expect(isKnownAction(action), `${layer.route.path}: ${action}`).toBe(true);
    }
    expect(found.length).toBeGreaterThanOrEqual(13);
  });

  it("refuses an unknown role or action (fails closed)", () => {
    expect(can("overlord", "view")).toBe(false);
    expect(can("founder", "seize-treasury")).toBe(false);
    expect(can(undefined, "invite")).toBe(false);
    expect(can(null, "invite")).toBe(false);
  });
});

describe("the roles table, row by row (ISP-199, AB#893)", () => {
  it.each(C.permissions.map((p) => [p.label, p]))("%s", (_label, p) => {
    const allowed = ROLES.filter((r) => p[r]);
    const refused = ROLES.filter((r) => !p[r]);
    expect(allowed.length, "someone holds every permission").toBeGreaterThan(0);
    for (const r of allowed) expect(can(r, p.id), `${r} may`).toBe(true);
    for (const r of refused) expect(can(r, p.id), `${r} may not`).toBe(false);
    // Every row has a refused actor: the roles without it, and always a corporation that is not a member.
    expect(can(null, p.id)).toBe(false);
  });

  it("holds through the API for each built action: an allowed actor and a refused one", async () => {
    const g = await guild({ directors: 2, members: 3 });
    const [d1, d2] = g.ds;
    const [m1, m2, m3] = g.ms;
    const outsider = await player();
    const post = (p, path, body) => p.api.post(`${g.at(p)}${path}`).send(body || {});
    // invite: director yes, member no
    expect((await post(d1, "/invitations", { corpId: outsider.corpId })).status).toBe(201);
    expect((await post(m1, "/invitations", { corpId: outsider.corpId })).status).toBe(403);
    // answer-application: director yes, member no
    const other = await player();
    const app1 = await other.api.post(`${g.at(other)}/applications`);
    expect((await post(m1, `/applications/${app1.body.application.id}/decline`)).status).toBe(403);
    expect((await post(d1, `/applications/${app1.body.application.id}/decline`)).status).toBe(200);
    // set-director: founder yes, director no
    expect((await post(d1, `/members/${m1.corpId}/role`, { role: "director" })).status).toBe(403);
    expect((await post(g.f, `/members/${m1.corpId}/role`, { role: "director" })).status).toBe(200);
    expect((await post(g.f, `/members/${m1.corpId}/role`, { role: "member" })).status).toBe(200);
    // remove-member: director yes, member no
    expect((await post(m1, `/members/${m2.corpId}/remove`)).status).toBe(403);
    expect((await post(d1, `/members/${m2.corpId}/remove`)).status).toBe(200);
    // remove-director: founder yes, director no
    expect((await post(d1, `/members/${d2.corpId}/remove`)).status).toBe(403);
    expect((await post(g.f, `/members/${d2.corpId}/remove`)).status).toBe(200);
    // set-identity: founder yes, director no
    expect((await post(d1, "/identity", { emblem: 4, colour: 5 })).status).toBe(403);
    expect((await post(g.f, "/identity", { emblem: 4, colour: 5 })).body.conglomerate).toMatchObject({ emblem: 4, colour: 5 });
    // leave: member yes, founder no
    expect((await post(g.f, "/leave")).body.code).toBe("founder-cannot-leave");
    expect((await post(m3, "/leave")).status).toBe(200);
    // view: a member sees the roster; a corporation outside sees only its own invitations
    expect((await m1.api.get(`${m1.base}/conglomerate`)).body.conglomerate.members.length).toBe(g.c().members.length);
    expect((await outsider.api.get(`${outsider.base}/conglomerate`)).body.conglomerate).toBeNull();
    // transfer-founder and dissolve: director no (founder yes: below)
    expect((await post(d1, "/founder", { corpId: d1.corpId })).status).toBe(403);
    expect((await post(d1, "/dissolve")).status).toBe(403);
  });
});

describe("removal, promotion and the founder's transfer (ISP-199, AB#893)", () => {
  it("never lets a director remove the founder or promote anyone, nor anyone escalate their own role", async () => {
    const g = await guild({ directors: 1, members: 1 });
    const [d] = g.ds;
    const [m] = g.ms;
    expect((await d.api.post(`${g.at(d)}/members/${g.f.corpId}/remove`)).status).toBe(403);
    expect((await d.api.post(`${g.at(d)}/members/${m.corpId}/role`).send({ role: "director" })).status).toBe(403);
    expect((await m.api.post(`${g.at(m)}/members/${m.corpId}/role`).send({ role: "director" })).status).toBe(403);
    expect((await d.api.post(`${g.at(d)}/members/${d.corpId}/role`).send({ role: "founder" })).status).toBe(400); // not a role the API takes
    expect((await g.f.api.post(`${g.at(g.f)}/members/${g.f.corpId}/role`).send({ role: "member" })).body.code).toBe("founder-role");
    expect([g.roleOf(g.f), g.roleOf(d), g.roleOf(m)]).toEqual(["founder", "director", "member"]);
  });

  it(`holds at most ${C.maxDirectors} directors`, async () => {
    const g = await guild({ directors: C.maxDirectors, members: 1 });
    const res = await g.f.api.post(`${g.at(g.f)}/members/${g.ms[0].corpId}/role`).send({ role: "director" });
    expect(res.body.code).toBe("directors-full");
  });

  it("refuses acting on another conglomerate's members", async () => {
    const [g, h] = [await guild({ members: 1 }), await guild({ members: 1 })];
    // h's founder names g's member under h: not a member there.
    expect((await h.f.api.post(`${h.at(h.f)}/members/${g.ms[0].corpId}/remove`)).status).toBe(404);
    // h's founder acting under g's id: not a member of g.
    expect((await h.f.api.post(`${h.f.base}/conglomerates/${g.cid}/members/${g.ms[0].corpId}/remove`)).status).toBe(404);
    expect(g.roleOf(g.ms[0])).toBe("member");
  });

  it("refuses a demoted director's next request, from the same session", async () => {
    const g = await guild({ directors: 1 });
    const [d] = g.ds;
    const target = await player();
    expect((await g.f.api.post(`${g.at(g.f)}/members/${d.corpId}/role`).send({ role: "member" })).status).toBe(200);
    expect((await d.api.post(`${g.at(d)}/invitations`).send({ corpId: target.corpId })).status).toBe(403);
  });

  it("removes a member: its link cleared, the join cooldown started, and it is told", async () => {
    const g = await guild({ members: 1 });
    const [m] = g.ms;
    const res = await g.f.api.post(`${g.at(g.f)}/members/${m.corpId}/remove`);
    expect(res.status).toBe(200);
    expect(m.raw.state.corp.conglomerateId).toBeNull();
    expect(m.raw.state.corp.joinCooldownUntil).toBeGreaterThan(Date.now());
    expect(g.c().past.at(-1)).toMatchObject({ corp: m.corpId, state: "removed" });
    expect(m.raw.notifications[0].title).toBe("Removed from a conglomerate");
  });

  it("transfers the founder role to a director in one step, and two transfers at once leave one founder", async () => {
    const g = await guild({ directors: 2, members: 1 });
    const [d1, d2] = g.ds;
    expect((await g.f.api.post(`${g.at(g.f)}/founder`).send({ corpId: g.ms[0].corpId })).body.code).toBe("not-a-director");
    const results = await Promise.all([
      g.f.api.post(`${g.at(g.f)}/founder`).send({ corpId: d1.corpId }),
      g.f.api.post(`${g.at(g.f)}/founder`).send({ corpId: d2.corpId })
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    const founders = g.c().members.filter((m) => m.role === "founder");
    expect(founders).toHaveLength(1);
    expect(g.c().founder).toBe(founders[0].corp);
    expect(g.roleOf(g.f)).toBe("director");
    expect((await g.f.api.post(`${g.at(g.f)}/leave`)).status).toBe(200); // a director now, so it may go
  });
});

describe("succession (ISP-199, AB#893)", () => {
  it(`hands the founder role to the longest-serving director when the founder has not signed in for ${C.founderAbsentDays} days`, async () => {
    const g = await guild({ directors: 2, members: 1 });
    const [d1] = g.ds;
    g.f.raw.lastLoginAt = Date.now() - (C.founderAbsentDays * DAY + 1000);
    const seen = await g.ms[0].api.get(`${g.ms[0].base}/conglomerate`);
    expect(seen.body.conglomerate.members.find((m) => m.role === "founder").corp).toBe(d1.corpId);
    expect(g.roleOf(g.f)).toBe("director");
    expect(d1.raw.notifications[0].title).toBe("You are now your conglomerate's founder");
    expect(d1.raw.notifications[0].body).toMatch(/longest-serving director/);
  });

  it("hands it on when the founder's account is gone, and leaves no founder behind", async () => {
    const g = await guild({ members: 2 });
    delete accountsStore.accounts[g.f.id];
    const seen = await g.ms[0].api.get(`${g.ms[0].base}/conglomerate`);
    expect(seen.body.conglomerate.members.map((m) => [m.corp, m.role])).toEqual([[g.ms[0].corpId, "founder"], [g.ms[1].corpId, "member"]]);
    expect(g.c().past.at(-1)).toMatchObject({ corp: g.f.corpId, state: "account-deleted" });
  });

  it("leaves an active founder alone", async () => {
    const g = await guild({ directors: 1 });
    g.f.raw.lastLoginAt = Date.now() - DAY;
    await g.ds[0].api.get(`${g.ds[0].base}/conglomerate`);
    expect(g.roleOf(g.f)).toBe("founder");
  });
});

describe("dissolution (ISP-199, AB#893)", () => {
  it("splits the treasury equally among the members, frees them with no cooldown, and holds the name for the release period", async () => {
    const g = await guild({ directors: 1, members: 1 });
    const name = g.c().name;
    const everyone = [g.f, ...g.ds, ...g.ms];
    const before = everyone.map((p) => p.raw.state.corp.finances.credits);
    g.f.raw.state.corp.currentStationId = "somewhere-else";
    expect((await g.f.api.post(`${g.at(g.f)}/dissolve`)).body.code).toBe("not-at-bureau");
    g.f.raw.state.corp.currentStationId = C.charterStationId;
    const res = await g.f.api.post(`${g.at(g.f)}/dissolve`);
    expect(res.status).toBe(200);
    // 10,000 among three: 3,333 each, the remaining 1 to the founder.
    expect(everyone.map((p, i) => p.raw.state.corp.finances.credits - before[i])).toEqual([3_334, 3_333, 3_333]);
    for (const p of everyone) {
      expect(p.raw.state.corp.conglomerateId).toBeNull();
      expect(Number(p.raw.state.corp.joinCooldownUntil) || 0).toBeLessThanOrEqual(Date.now());
    }
    expect(findConglomerate(g.cid)).toBeNull();
    expect((await g.f.api.get("/api/conglomerates")).body.conglomerates.map((c) => c.id)).not.toContain(g.cid);
    expect((await g.ms[0].api.post(`${g.at(g.ms[0])}/leave`)).status).toBe(404);

    // The name is held for nameReleaseDays, then free.
    const founder2 = await player();
    Object.assign(founder2.raw, { createdAt: Date.now() - 8 * DAY });
    Object.assign(founder2.raw.state.corp, { currentStationId: C.charterStationId });
    founder2.raw.state.corp.finances.credits = 250_000;
    expect((await founder2.api.post(`${founder2.base}/conglomerates`).send({ name, emblem: 1, colour: 1 })).body.code).toBe("name-taken");
    conglomerateList().find((c) => c.id === g.cid).dissolvedAt -= C.nameReleaseDays * DAY;
    expect((await founder2.api.post(`${founder2.base}/conglomerates`).send({ name, emblem: 1, colour: 1 })).status).toBe(201);
  });
});

describe("role changes reach the affected member through its account room (ISP-199, AB#893)", () => {
  let url;
  const sockets = [];
  beforeAll(async () => { url = await serverUrl(); });
  afterAll(() => { for (const s of sockets) s.close(); });
  async function socket(token) {
    const s = connect(url, { transports: ["websocket"], forceNew: true, auth: { token } });
    sockets.push(s);
    await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
    return s;
  }
  const heard = (s, events) => { const got = []; for (const e of events) s.on(e, (p) => got.push([e, p])); return got; };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  it("tells a promoted member and a removed one, and an outsider hears nothing", async () => {
    const g = await guild({ members: 2 });
    const [m1, m2] = g.ms;
    const outsider = await player();
    const events = ["conglomerate:role-changed", "conglomerate:removed"];
    const [h1, h2, ho] = [heard(await socket(m1.token), events), heard(await socket(m2.token), events), heard(await socket(outsider.token), events)];
    await g.f.api.post(`${g.at(g.f)}/members/${m1.corpId}/role`).send({ role: "director" });
    await g.f.api.post(`${g.at(g.f)}/members/${m2.corpId}/remove`);
    await settle();
    expect(h1.map(([e, p]) => [e, p.corp])).toEqual([["conglomerate:role-changed", m1.corpId], ["conglomerate:removed", m2.corpId]]);
    expect(h2.map(([e, p]) => [e, p.corp])).toEqual([["conglomerate:role-changed", m1.corpId], ["conglomerate:removed", m2.corpId]]);
    expect(m1.raw.notifications[0].title).toBe("Promoted to director");
    await g.f.api.post(`${g.at(g.f)}/members/${m1.corpId}/role`).send({ role: "member" });
    await settle();
    expect(h2).toHaveLength(2); // removed: it hears nothing more
    expect(ho).toEqual([]);
  });
});
