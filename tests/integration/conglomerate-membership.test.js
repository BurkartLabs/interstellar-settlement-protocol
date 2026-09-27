import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { findConglomerate } from "../../server/game/membership.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";

// ISP-198 (AB#892): joining and leaving a conglomerate (docs/design/CONGLOMERATES.md, "Membership"). One test per
// transition of the design's state list; the cap under two acceptances at once; the misuse the item names; and the
// socket events reaching the conglomerate's room and the affected account, and nobody else.
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const uniqueName = (stem) => `${stem} ${Date.now() % 1e6} ${(seq += 1)}`;
let url;
const sockets = [];
beforeAll(async () => { url = await serverUrl(); });
afterAll(() => { for (const s of sockets) s.close(); });

async function player() {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  const api = authed(app, reg.accessToken);
  const base = `/api/accounts/${reg.account.id}`;
  return { id: reg.account.id, token: reg.accessToken, raw, corpId: raw.state.corp.publicId, api, base };
}

/** A founder and the conglomerate it has just chartered. */
async function founded() {
  const f = await player();
  f.raw.createdAt = Date.now() - (C.minFounderAgeDays + 1) * DAY;
  f.raw.state.corp.currentStationId = C.charterStationId;
  f.raw.state.corp.finances.credits = 250_000;
  const res = await f.api.post(`${f.base}/conglomerates`).send({ name: uniqueName("Guild"), emblem: 1, colour: 1 });
  expect(res.status).toBe(201);
  f.cid = res.body.conglomerate.id;
  f.c = `${f.base}/conglomerates/${f.cid}`;
  return f;
}

const invite = (from, to) => from.api.post(`${from.c}/invitations`).send({ corpId: to.corpId });
const answerInvite = (who, cid, id, answer) => who.api.post(`${who.base}/conglomerates/${cid}/invitations/${id}/${answer}`);
const apply = (who, cid) => who.api.post(`${who.base}/conglomerates/${cid}/applications`);
const answerApp = (who, cid, id, answer) => who.api.post(`${who.base}/conglomerates/${cid}/applications/${id}/${answer}`);
const view = async (who) => (await who.api.get(`${who.base}/conglomerate`)).body;

async function joined(f) {
  const p = await player();
  const inv = await invite(f, p);
  expect((await answerInvite(p, f.cid, inv.body.invitation.id, "accept")).status).toBe(200);
  return p;
}

describe("invitations (ISP-198, AB#892)", () => {
  it("invited -> member: the invited corporation accepts and joins; the invitation cannot be accepted again", async () => {
    const f = await founded();
    const p = await player();
    const inv = await invite(f, p);
    expect(inv.status).toBe(201);
    expect(inv.body.invitation).toMatchObject({ corp: p.corpId, state: "invited" });
    expect((await view(p)).invitations.map((i) => i.id)).toEqual([inv.body.invitation.id]);
    const ok = await answerInvite(p, f.cid, inv.body.invitation.id, "accept");
    expect(ok.status).toBe(200);
    expect(ok.body.conglomerate.memberCount).toBe(2);
    expect(p.raw.state.corp.conglomerateId).toBe(f.cid);
    const mine = (await view(p)).conglomerate;
    expect(mine.role).toBe("member");
    expect(mine.members.map((m) => [m.corp, m.role])).toEqual([[f.corpId, "founder"], [p.corpId, "member"]]);
    const replay = await answerInvite(p, f.cid, inv.body.invitation.id, "accept");
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe("invitation-closed");
    expect(findConglomerate(f.cid).members).toHaveLength(2);
  });

  it("invited -> declined, and invited -> withdrawn by the inviting side", async () => {
    const f = await founded();
    const [p, q] = [await player(), await player()];
    const a = await invite(f, p);
    const d = await answerInvite(p, f.cid, a.body.invitation.id, "decline");
    expect(d.status).toBe(200);
    expect(d.body.invitation.state).toBe("declined");
    const b = await invite(f, q);
    expect((await answerInvite(q, f.cid, b.body.invitation.id, "withdraw")).status).toBe(404); // not the inviter's side
    const w = await answerInvite(f, f.cid, b.body.invitation.id, "withdraw");
    expect(w.body.invitation.state).toBe("withdrawn");
    expect((await answerInvite(q, f.cid, b.body.invitation.id, "accept")).body.code).toBe("invitation-closed");
    expect(p.raw.state.corp.conglomerateId ?? null).toBeNull();
    expect(q.raw.state.corp.conglomerateId ?? null).toBeNull();
  });

  it("invited -> expired after inviteExpiryDays", async () => {
    const f = await founded();
    const p = await player();
    const inv = await invite(f, p);
    findConglomerate(f.cid).invitations.find((i) => i.id === inv.body.invitation.id).at -= (C.inviteExpiryDays * DAY + 1);
    const late = await answerInvite(p, f.cid, inv.body.invitation.id, "accept");
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/expired/);
  });
});

describe("applications (ISP-198, AB#892)", () => {
  it("applied -> member: the founder accepts; applied -> declined; applied -> withdrawn by the applicant", async () => {
    const f = await founded();
    const [p, q, r] = [await player(), await player(), await player()];
    const a = await apply(p, f.cid);
    expect(a.status).toBe(201);
    expect((await view(f)).conglomerate.applications.map((x) => x.corp)).toContain(p.corpId);
    expect((await answerApp(q, f.cid, a.body.application.id, "accept")).status).toBe(404); // an outsider cannot answer it
    const ok = await answerApp(f, f.cid, a.body.application.id, "accept");
    expect(ok.status).toBe(200);
    expect(p.raw.state.corp.conglomerateId).toBe(f.cid);

    const b = await apply(q, f.cid);
    expect((await answerApp(p, f.cid, b.body.application.id, "decline")).status).toBe(403); // a member without the permission (ISP-199: can() answers 403 to a member)
    expect((await answerApp(f, f.cid, b.body.application.id, "decline")).body.application.state).toBe("declined");

    const c = await apply(r, f.cid);
    expect((await answerApp(r, f.cid, c.body.application.id, "withdraw")).body.application.state).toBe("withdrawn");
    expect((await answerApp(f, f.cid, c.body.application.id, "accept")).body.code).toBe("application-closed");
  });

  it("holds one open application at a time", async () => {
    const [f, g] = [await founded(), await founded()];
    const p = await player();
    expect((await apply(p, f.cid)).status).toBe(201);
    const second = await apply(p, g.cid);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("already-applied");
  });
});

describe("leaving (ISP-198, AB#892)", () => {
  it("member -> left: clears corp.conglomerateId and starts the join cooldown; the founder cannot leave", async () => {
    const f = await founded();
    const p = await joined(f);
    const out = await p.api.post(`${p.base}/conglomerates/${f.cid}/leave`);
    expect(out.status).toBe(200);
    expect(p.raw.state.corp.conglomerateId).toBeNull();
    expect(out.body.joinCooldownUntil).toBeGreaterThan(Date.now() + (C.joinCooldownHours - 1) * 60 * 60 * 1000);
    expect(findConglomerate(f.cid).members.map((m) => m.corp)).toEqual([f.corpId]);
    expect(findConglomerate(f.cid).past.at(-1)).toMatchObject({ corp: p.corpId, state: "left" });
    const again = await apply(p, f.cid);
    expect(again.body.code).toBe("join-cooldown");
    expect((await invite(f, p)).body.code).toBe("join-cooldown");
    const founderOut = await f.api.post(`${f.c}/leave`);
    expect(founderOut.status).toBe(409);
    expect(founderOut.body.code).toBe("founder-cannot-leave");
    expect(f.raw.state.corp.conglomerateId).toBe(f.cid);
    expect((await p.api.post(`${p.base}/conglomerates/${f.cid}/leave`)).status).toBe(404); // no longer a member
  });
});

describe("the member cap, and a corporation's one membership (ISP-198, AB#892)", () => {
  it("refuses acceptance at the cap, and two acceptances for the last place admit exactly one", async () => {
    const f = await founded();
    findConglomerate(f.cid).maxMembers = 2; // one place left
    const [p, q] = [await player(), await player()];
    const [ip, iq] = [await invite(f, p), await invite(f, q)];
    const results = await Promise.all([
      answerInvite(p, f.cid, ip.body.invitation.id, "accept"),
      answerInvite(q, f.cid, iq.body.invitation.id, "accept")
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const refused = results.find((r) => r.status === 409);
    expect(refused.body.code).toBe("conglomerate-full");
    expect(refused.body.error).toMatch(/has no room: it has 2 of 2 members/);
    expect(findConglomerate(f.cid).members).toHaveLength(2);
    const r = await player();
    const a = await apply(r, f.cid);
    expect((await answerApp(f, f.cid, a.body.application.id, "accept")).body.code).toBe("conglomerate-full");
  });

  it("never gives a corporation two memberships", async () => {
    const [f, g] = [await founded(), await founded()];
    const p = await player();
    const [a, b] = [await invite(f, p), await invite(g, p)];
    expect((await answerInvite(p, f.cid, a.body.invitation.id, "accept")).status).toBe(200);
    const second = await answerInvite(p, g.cid, b.body.invitation.id, "accept");
    expect(second.status).toBe(409); // accepting one closed the other
    expect(p.raw.state.corp.conglomerateId).toBe(f.cid);
    expect(findConglomerate(g.cid).members.map((m) => m.corp)).not.toContain(p.corpId);
    expect((await invite(g, p)).body.code).toBe("already-in-conglomerate");
    expect((await apply(p, g.cid)).body.code).toBe("already-in-conglomerate");
  });
});

describe("misuse (ISP-198, AB#892)", () => {
  it("refuses inviting oneself, a member without the permission inviting, another corporation's invitation, and unknown ids", async () => {
    const f = await founded();
    const member = await joined(f);
    const [p, q] = [await player(), await player()];
    expect((await f.api.post(`${f.c}/invitations`).send({ corpId: f.corpId })).body.code).toBe("invite-self");
    expect((await invite({ ...member, c: `${member.base}/conglomerates/${f.cid}` }, p)).status).toBe(403);
    const inv = await invite(f, p);
    expect((await answerInvite(q, f.cid, inv.body.invitation.id, "accept")).status).toBe(404);
    expect(q.raw.state.corp.conglomerateId ?? null).toBeNull();
    expect((await answerInvite(p, f.cid, "cinv-does-not-exist", "accept")).status).toBe(404);
    expect((await answerInvite(p, "cgl-does-not-exist", inv.body.invitation.id, "accept")).status).toBe(404);
    expect((await f.api.post(`${f.c}/invitations`).send({ corpId: "corp-does-not-exist" })).status).toBe(404);
    expect((await answerInvite(p, f.cid, inv.body.invitation.id, "join")).status).toBe(400);
    expect(p.raw.state.corp.conglomerateId ?? null).toBeNull();
    // Another account's id in the URL.
    expect((await f.api.post(`/api/accounts/${p.id}/conglomerates/${f.cid}/invitations/${inv.body.invitation.id}/accept`)).status).toBe(403);
  });

  it(`limits invitations to ${C.invitesPerDay} per conglomerate in 24 hours`, async () => {
    const f = await founded();
    const c = findConglomerate(f.cid);
    const now = Date.now();
    for (let i = 0; i < C.invitesPerDay; i += 1) c.invitations.push({ id: `cinv-flood-${i}`, corp: `corp-flood-${i}`, by: f.corpId, at: now - i * 1000, state: "declined", closedAt: now });
    const p = await player();
    const res = await invite(f, p);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("invite-limit");
    expect(res.body.error).toMatch(new RegExp(`${C.invitesPerDay} invitations in 24 hours`));
    for (const r of c.invitations) if (r.id.startsWith("cinv-flood-")) r.at -= DAY;
    expect((await invite(f, p)).status).toBe(201);
  });
});

describe("membership events reach the conglomerate's room and the affected account only (ISP-198, AB#892)", () => {
  async function socket(token) {
    const s = connect(url, { transports: ["websocket"], forceNew: true, auth: { token } });
    sockets.push(s);
    await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
    return s;
  }
  const EVENTS = ["conglomerate:invited", "conglomerate:applied", "conglomerate:joined", "conglomerate:left", "conglomerate:invitation-closed", "conglomerate:application-closed"];
  function listen(s) {
    const got = [];
    for (const e of EVENTS) s.on(e, (payload) => got.push([e, payload]));
    return got;
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  it("a member hears joins and leaves, the invited account hears its invitation, and a non-member socket hears nothing", async () => {
    const f = await founded();
    const member = await joined(f);
    const [p, outsider] = [await player(), await player()];
    const [fs, ms, ps, os] = [await socket(f.token), await socket(member.token), await socket(p.token), await socket(outsider.token)];
    const [fh, mh, ph, oh] = [listen(fs), listen(ms), listen(ps), listen(os)];

    const inv = await invite(f, p);
    await settle();
    expect(ph.map(([e]) => e)).toEqual(["conglomerate:invited"]);
    expect(fh.map(([e]) => e)).toEqual(["conglomerate:invited"]);
    await answerInvite(p, f.cid, inv.body.invitation.id, "accept");
    await settle();
    expect(mh.map(([e]) => e)).toEqual(["conglomerate:invited", "conglomerate:joined"]);
    expect(ph.filter(([e]) => e === "conglomerate:joined")).toHaveLength(1); // once, though it is now in the room too
    expect(mh.at(-1)[1]).toMatchObject({ corp: p.corpId, conglomerate: { id: f.cid, memberCount: 3 } });

    await member.api.post(`${member.base}/conglomerates/${f.cid}/leave`);
    await settle();
    expect(fh.at(-1)[0]).toBe("conglomerate:left");
    expect(mh.at(-1)[0]).toBe("conglomerate:left"); // the leaver is told, once
    const before = mh.length;
    const q = await player();
    await invite(f, q);
    await settle();
    expect(mh).toHaveLength(before); // and hears nothing after it left
    expect(oh).toEqual([]);
    for (const [, payload] of [...fh, ...mh, ...ph]) {
      const text = JSON.stringify(payload);
      for (const who of [f, member, p, outsider]) expect(text).not.toContain(who.id);
    }
  });
});

describe("the Bureau's view of a corporation (ISP-200, AB#894)", () => {
  it("carries the server's charter verdict, and a member's permissions from can()", async () => {
    const p = await player();
    const fresh = await view(p);
    expect(fresh.charter).toMatchObject({ fee: C.charterFee, deposit: C.charterDeposit, minFounderAgeDays: C.minFounderAgeDays });
    expect(fresh.charter.refusal.code).toBe("founder-too-young");
    const f = await founded();
    expect((await view(f)).charter.refusal.code).toBe("already-in-conglomerate");
    const mine = (await view(f)).conglomerate;
    expect(mine.permissions).toEqual(C.permissions.filter((x) => x.founder).map((x) => x.id));
    expect(mine).toMatchObject({ maxDirectors: C.maxDirectors, founderAbsentDays: C.founderAbsentDays });
    const m = await joined(f);
    expect((await view(m)).conglomerate.permissions).toEqual(C.permissions.filter((x) => x.member).map((x) => x.id));
  });
});
