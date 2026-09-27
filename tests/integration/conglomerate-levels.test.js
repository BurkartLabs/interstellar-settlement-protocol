import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import * as conglomerates from "../../server/game/conglomerates.js";
import * as membership from "../../server/game/membership.js";
import * as roles from "../../server/game/conglomerateRoles.js";
import * as levels from "../../server/game/conglomerateLevels.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";

// ISP-202 (AB#896): the level ladder, 5 to 100 members. Every level is reachable through the server's own paths
// (T-019), each requirement reads a stat some server code writes, a purchase is refused with the reason when a
// requirement, the role or the place is missing, one request buys one level, and nothing lowers a level.
//
// The treasury is set directly where a level needs funds: contributions are AB#898 (ISP-204), the story after this one,
// and until it lands the only credits a treasury holds are the charter's deposit.
const { dailyUpkeep, levelStatus, LEVEL_STAT_WRITERS } = conglomerates;
const { findConglomerate, inviteCorporation, answerInvitation, leaveConglomerate, onConglomerateEvent } = membership;
const { buyConglomerateLevel } = levels;
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

/** A corporation that exists only in the store: enough for invitations and membership, which read nothing else. */
function outsider() {
  seq += 1;
  const id = `acc-ladder-${Date.now()}-${seq}`;
  accountsStore.accounts[id] = { id, email: `${id}@example.test`, createdAt: Date.now(), notifications: [], state: { corp: { publicId: `corp-ladder-${Date.now()}-${seq}`, corporationName: `Ladder Member ${seq}` } } };
  return accountsStore.accounts[id];
}

/** A registered founder and the conglomerate it chartered. */
async function founded() {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  raw.createdAt = Date.now() - (C.minFounderAgeDays + 1) * DAY;
  raw.state.corp.finances.credits = 250_000;
  const api = authed(app, reg.accessToken);
  const res = await api.post(`/api/accounts/${reg.account.id}/conglomerates`).send({ name: `Ladder ${Date.now() % 1e6} ${(seq += 1)}`, emblem: 1, colour: 1 });
  expect(res.status).toBe(201);
  const c = findConglomerate(res.body.conglomerate.id);
  return { id: reg.account.id, raw, api, c, url: `/api/accounts/${reg.account.id}/conglomerates/${c.id}/level` };
}

/** Admit outsiders through invitations until the conglomerate has `count` members, a day at a time as invitesPerDay allows. */
function fillTo(f, count, clock) {
  while (f.c.members.length < count) {
    const joiner = outsider();
    let inv = inviteCorporation(f.id, f.c.id, joiner.state.corp.publicId, clock.now);
    if (inv.refused?.code === "invite-limit") { clock.now += DAY; f.raw.lastLoginAt = clock.now; inv = inviteCorporation(f.id, f.c.id, joiner.state.corp.publicId, clock.now); }
    expect(inv.refused, JSON.stringify(inv.refused)).toBeUndefined();
    expect(answerInvitation(joiner.id, f.c.id, inv.invitation.id, "accept", clock.now).refused).toBeUndefined();
  }
}

describe("every level is reachable, and the cap follows the catalog to 100 (T-019, AB#896)", () => {
  it("climbs from level 1 to the top through the server's own paths", async () => {
    const f = await founded();
    const clock = { now: Date.now() };
    const caps = [f.c.maxMembers];
    for (let target = 2; target <= C.levels.length; target += 1) {
      const status = levelStatus(f.c, clock.now);
      expect(status.next.level).toBe(target);
      fillTo(f, status.requirements.find((r) => r.id === "members").need, clock);
      clock.now = Math.max(clock.now, levelStatus(f.c, clock.now).requirements.find((r) => r.id === "days").need);
      f.raw.lastLoginAt = clock.now; // the founder keeps signing in, so succession never moves the role
      f.c.treasury.credits = levelStatus(f.c, clock.now).requirements.find((r) => r.id === "funds").need; // contributions: AB#898
      const bought = buyConglomerateLevel(f.id, f.c.id, target, clock.now);
      expect(bought.refused, `level ${target}: ${bought.refused?.error}`).toBeUndefined();
      expect(f.c.treasury.credits).toBe(dailyUpkeep(f.c.members.length) * C.levelReserveDays); // the reserve stays
      caps.push(f.c.maxMembers);
    }
    expect(caps).toEqual(C.levels.map((l) => l.maxMembers));
    expect(caps.at(-1)).toBe(100);
    expect(levelStatus(f.c, clock.now)).toEqual({ level: C.levels.length, top: true });
    expect(buyConglomerateLevel(f.id, f.c.id, C.levels.length + 1, clock.now).refused.code).toBe("top-level");
  }, 120_000);
});

describe("each requirement reads a stat the server writes (AB#896)", () => {
  it("names, for every stat a requirement reads, functions that exist and write it", () => {
    const f = { members: [{ corp: "x", role: "founder", joinedAt: 0 }], treasury: { credits: 0 }, level: 1, foundedAt: 0, levelSince: 0 };
    const stats = new Set(levelStatus(f, DAY).requirements.map((r) => r.stat));
    expect([...stats].sort()).toEqual(Object.keys(LEVEL_STAT_WRITERS).sort());
    const writes = { "treasury.credits": /treasury/, members: /members|admit\(/, levelSince: /levelSince/ };
    const modules = { ...conglomerates, ...membership, ...roles, ...levels };
    for (const stat of stats) {
      expect(LEVEL_STAT_WRITERS[stat].length, stat).toBeGreaterThan(0);
      for (const name of LEVEL_STAT_WRITERS[stat]) {
        expect(typeof modules[name], `${name} (writes ${stat})`).toBe("function");
        expect(String(modules[name]), `${name} writes ${stat}`).toMatch(writes[stat]);
      }
    }
  });
});

describe("buying a level is refused with the reason when anything is missing (AB#896)", () => {
  it("refuses a member, and a founder short of members, days, funds or place, each saying what", async () => {
    const f = await founded();
    const clock = { now: Date.now() };
    const m = outsider();
    const inv = inviteCorporation(f.id, f.c.id, m.state.corp.publicId, clock.now);
    answerInvitation(m.id, f.c.id, inv.invitation.id, "accept", clock.now);
    expect(buyConglomerateLevel(m.id, f.c.id, 2, clock.now).refused).toMatchObject({ status: 403, code: "not-permitted" });

    const unmet = (await f.api.post(f.url).send({ level: 2 })).body;
    expect(unmet.code).toBe("requirements-unmet");
    expect(unmet.error).toMatch(/The treasury pays 50,000 credits and keeps 2,100 \(7 days of upkeep for 2\)/);
    expect(unmet.error).toMatch(/At least 4 members \(80% of 5\)/);
    expect(unmet.error).toMatch(/3 days at level 1/);

    f.raw.state.corp.currentStationId = "somewhere-else";
    expect((await f.api.post(f.url).send({ level: 2 })).body.code).toBe("not-at-bureau");
    f.raw.state.corp.currentStationId = C.charterStationId;
    expect((await f.api.post(f.url).send({ level: 3 })).body.code).toBe("one-level-at-a-time");
    expect((await f.api.post(f.url).send({ level: 1 })).status).toBe(400); // below the ladder: the input check refuses it
    expect((await f.api.post(f.url).send({})).status).toBe(400);
    expect(f.c.level).toBe(1);
  });

  it("ignores progress a client sends: only the server's own counts are read", async () => {
    const f = await founded();
    const res = await f.api.post(f.url).send({ level: 2, members: 100, treasury: { credits: 1e9 }, levelSince: 0 });
    expect(res.body.code).toBe("requirements-unmet");
    expect(f.c.level).toBe(1);
  });

  it("fails closed on a level the catalog does not describe", async () => {
    const f = await founded();
    f.c.level = 42;
    const res = await f.api.post(f.url).send({ level: 43 });
    expect(res.status).toBe(400); // past the catalog's last level, refused by the input check
    expect(buyConglomerateLevel(f.id, f.c.id, 43).refused).toMatchObject({ status: 503, code: "level-unavailable" });
  });
});

describe("one request buys one level, together with its payment, and members hear it (AB#896)", () => {
  async function ready() {
    const f = await founded();
    const clock = { now: Date.now() };
    fillTo(f, 4, clock);
    f.c.levelSince -= 3 * DAY;
    f.raw.lastLoginAt = Date.now();
    f.c.treasury.credits = 50_000 + dailyUpkeep(4) * C.levelReserveDays + 1_000;
    return f;
  }

  it("two requests for level 2 at once buy it once", async () => {
    const f = await ready();
    const before = f.c.treasury.credits;
    const results = await Promise.all([f.api.post(f.url).send({ level: 2 }), f.api.post(f.url).send({ level: 2 })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409).body.code).toBe("already-at-level");
    expect(f.c.level).toBe(2);
    expect(f.c.maxMembers).toBe(10);
    expect(f.c.treasury.credits).toBe(before - 50_000);
  });

  it("tells every member, on the conglomerate's room and in a notification", async () => {
    const f = await ready();
    const heard = [];
    const stop = onConglomerateEvent((e) => { if (e.conglomerateId === f.c.id) heard.push(e); });
    expect((await f.api.post(f.url).send({ level: 2 })).status).toBe(200);
    stop();
    expect(heard.map((e) => e.event)).toEqual(["conglomerate:levelled"]);
    expect(heard[0].payload).toMatchObject({ level: 2, maxMembers: 10, conglomerate: { level: 2, maxMembers: 10 } });
    for (const m of f.c.members) {
      const account = membership.accountByCorp(m.corp);
      expect(account.notifications[0].title, m.corp).toMatch(/reached level 2/);
    }
  });

  it("never lowers the level when members leave", async () => {
    const f = await ready();
    await f.api.post(f.url).send({ level: 2 });
    for (const m of f.c.members.filter((x) => x.role !== "founder")) {
      expect(leaveConglomerate(membership.accountByCorp(m.corp).id, f.c.id).refused).toBeUndefined();
    }
    expect(f.c.members).toHaveLength(1);
    expect([f.c.level, f.c.maxMembers]).toEqual([2, 10]);
  });

  it("shows members the next level and each requirement in their view", async () => {
    const f = await founded();
    const view = (await f.api.get(`/api/accounts/${f.id}/conglomerate`)).body.conglomerate.levels;
    expect(view.next).toEqual({ level: 2, maxMembers: 10, cost: 50_000 });
    expect(view.requirements.map((r) => [r.id, r.met])).toEqual([["funds", false], ["members", false], ["days", false]]);
  });
});
