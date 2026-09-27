import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { SYSTEMS_BY_ID } from "../../server/game/catalog.js";
import { moveTreasury } from "../../server/game/conglomerates.js";
import { answerInvitation, findConglomerate, inviteCorporation } from "../../server/game/membership.js";
import { setMemberRole } from "../../server/game/conglomerateRoles.js";
import { billOfMaterials, settleStationProject } from "../../server/game/stationProjects.js";
import { settleAllStationGovernance, settleStationGovernance } from "../../server/game/stationGovernance.js";
import { TOTAL_BPS, contributedValues, stakesFrom } from "../../server/game/stakes.js";
import { stationAtBody } from "../../server/game/stations.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";

// ISP-211 (AB#906): stakes in a conglomerate's station and governing it by them (docs/design/CONGLOMERATES.md Part 2).
// Stakes come from each corporation's own contributions and always make 100%; a departing corporation is bought out
// at the design's rate and its stake returns to the pool; a station setting changes only by more than half of all
// stake; and every misuse the item names is refused with nothing changed.
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const BOM = billOfMaterials();
let seq = 0;
const claimed = new Set();

async function player(credits = 3_000_000) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  raw.state.corp.finances.credits = credits;
  raw.state.corp.currentStationId = C.charterStationId;
  return { app, id: reg.account.id, raw, corp: () => raw.state.corp, corpId: raw.state.corp.publicId, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
}
function freshSite() {
  const s = [...SYSTEMS_BY_ID.values()].find((x) => x.id !== "sol" && (x.bodies || []).filter((b) => !stationAtBody(b.name) && !claimed.has(b.name)).length >= 2);
  const bodies = s.bodies.map((b) => b.name).filter((n) => !stationAtBody(n) && !claimed.has(n));
  claimed.add(bodies[1]);
  return { systemId: s.id, lease: bodies[0], body: bodies[1] };
}
/** A level-4 conglomerate: founder, one director, `members` members. */
async function guild(members = 1) {
  const f = await player();
  f.raw.createdAt = Date.now() - 8 * DAY;
  const res = await f.api.post(`${f.base}/conglomerates`).send({ name: `Stakes ${Date.now() % 1e6} ${(seq += 1)}`, emblem: 1, colour: 1 });
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
  const ms = [];
  for (let i = 0; i < members; i += 1) ms.push(await join());
  c.level = C.stationMinLevel;
  const site = freshSite();
  d.corp().miningLeases = [{ id: `lease-${seq}`, body: site.lease, issuedAt: Date.now() }];
  const url = (p, rest = "") => `${p.base}/conglomerates/${c.id}${rest}`;
  return { f, d, ms, c, site, url };
}
/** Fund the project from `shares` ([player, credits]; the goods come from the first), plus `pooled` treasury credits, and build it. */
async function build(g, shares, pooled = 0) {
  expect((await g.f.api.post(g.url(g.f, "/station-project")).send({ systemId: g.site.systemId, body: g.site.body, suffix: 1 })).status).toBe(201);
  const give = async (p, body) => {
    const res = await p.api.post(g.url(p, "/station-project/contribute")).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  if (pooled) {
    moveTreasury(g.c, { at: Date.now(), kind: "deposit", corp: g.f.corpId, amount: pooled, by: g.f.corpId });
    await give(g.f, { source: "treasury", credits: pooled });
  }
  for (const [p, credits] of shares) if (credits) await give(p, { source: "own", credits });
  const [first] = shares[0];
  for (const [item, n] of Object.entries(BOM.goods)) {
    const inv = ((first.corp().inventory ||= {})[C.homeStationId] ||= {});
    inv[item] = (inv[item] || 0) + n;
    await give(first, { source: "own", item, quantity: n });
  }
  const p = g.c.stationProject;
  settleStationProject(g.c, p.completesAt);
  expect(g.c.station?.id).toBe(p.stationId);
  return p;
}
const sumBps = (stakes) => Object.values(stakes).reduce((s, x) => s + x.bps, 0);
const propose = (g, p, body) => p.api.post(g.url(p, "/station/proposals")).send(body);
const vote = (g, p, id, v, extra = {}) => p.api.post(g.url(p, `/station/proposals/${id}/vote`)).send({ vote: v, ...extra });

describe("stakes (ISP-211, AB#906)", () => {
  it("always sum to 100%, whatever the contributions", () => {
    for (let t = 0; t < 500; t += 1) {
      const n = 1 + (t % 9);
      const values = Object.fromEntries(Array.from({ length: n }, (_, i) => [`corp-${i}`, 1 + Math.floor(Math.random() ** 3 * 5_000_000)]));
      const stakes = stakesFrom(values);
      expect(sumBps(stakes)).toBe(TOTAL_BPS);
      for (const [corp, s] of Object.entries(stakes)) expect(Math.abs(s.bps - (values[corp] * TOTAL_BPS) / Object.values(values).reduce((a, b) => a + b, 0))).toBeLessThan(1);
    }
    expect(stakesFrom({})).toEqual({});
  });

  it("are recorded on the station from each corporation's own contributions, and pooled money is nobody's", async () => {
    const g = await guild(1);
    const [m] = g.ms;
    const p = await build(g, [[m, 700_000], [g.d, 500_000]], 800_000); // m also gives every good
    const goods = Object.entries(BOM.goods).reduce((s, [item, n]) => s + p.contributions.find((r) => r.item === item).value, 0);
    expect(g.c.station.stakes).toEqual(stakesFrom({ [m.corpId]: 700_000 + goods, [g.d.corpId]: 500_000 }));
    expect(sumBps(g.c.station.stakes)).toBe(TOTAL_BPS);
    expect(g.c.station.stakes[g.f.corpId]).toBeUndefined(); // the founder moved only the pool
    expect(contributedValues(p.contributions)).toEqual({ [m.corpId]: 700_000 + goods, [g.d.corpId]: 500_000 });
    // members see them, by name; an outsider does not reach them at all
    const view = (await g.d.api.get(g.url(g.d, "/station"))).body;
    expect(view.stakes.map((s) => s.corp)).toEqual([m.corpId, g.d.corpId]);
    expect(view.stakes.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 9);
    expect(view.settings).toEqual({ access: "open", listed: [] });
    const outsider = await player();
    expect((await outsider.api.get(`${outsider.base}/conglomerates/${g.c.id}/station`)).status).toBe(404);
  });
});

describe("governing the station (ISP-211, AB#906)", () => {
  it("changes a setting only when more than half of all stake votes yes, and the setting then decides who may dock", async () => {
    const g = await guild(2);
    const [m1, m2] = g.ms;
    await build(g, [[m1, 800_000], [g.d, 700_000], [m2, 500_000]]); // m1 holds the goods too: m1 > d > m2
    const stakes = g.c.station.stakes;
    expect(stakes[m1.corpId].bps).toBeGreaterThan(stakes[g.d.corpId].bps);
    // a member cannot propose; the director can, and its own stake is for it
    expect((await propose(g, m1, { setting: "access", value: "members" })).status).toBe(403);
    const res = await propose(g, g.d, { setting: "access", value: "members" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.proposal.id;
    expect(res.body.proposal).toMatchObject({ state: "open", votes: [{ corp: g.d.corpId, vote: "yes" }] });
    expect((await propose(g, g.f, { setting: "access", value: "members-and-listed" })).body.code).toBe("proposal-open");
    // the founder has no stake: it cannot vote
    expect((await vote(g, g.f, id, "yes")).body.code).toBe("no-stake");
    // twice is refused; a vote "for" another corporation is the caller's own
    expect((await vote(g, g.d, id, "no")).body.code).toBe("already-voted");
    const m2vote = await vote(g, m2, id, "no", { corpId: m1.corpId, corp: m1.corpId });
    expect(m2vote.body.proposal.votes).toEqual(expect.arrayContaining([{ corp: m2.corpId, corpName: m2.corp().corporationName, vote: "no" }]));
    expect(m2vote.body.proposal.votes.some((v) => v.corp === m1.corpId)).toBe(false);
    expect(g.c.station.settings.access).toBe("open");
    // m1's yes takes it past half
    const passed = await vote(g, m1, id, "yes");
    expect(passed.body.proposal.state).toBe("passed");
    expect(g.c.station.settings.access).toBe("members");
    // now an outsider in the system is refused at the dock, and a member is not
    const outsider = await player();
    for (const p of [outsider, m2]) Object.assign(p.corp(), { currentSystemId: g.site.systemId, currentStationId: null, travel: null });
    const refused = await outsider.api.post(`${outsider.base}/gameplay/travel`).send({ toStationId: g.c.station.id });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/admits members only/);
    expect(outsider.corp().travel ?? null).toBeNull();
    expect((await m2.api.post(`${m2.base}/gameplay/travel`).send({ toStationId: g.c.station.id })).status).toBe(200);
    // listing another conglomerate lets its members in once members-and-listed passes
    const other = await guild(0);
    Object.assign(other.f.corp(), { currentSystemId: g.site.systemId, currentStationId: null, travel: null });
    const list = (await propose(g, g.d, { setting: "list", conglomerateId: other.c.id })).body.proposal;
    await vote(g, m1, list.id, "yes");
    const mode = (await propose(g, g.d, { setting: "access", value: "members-and-listed" })).body.proposal;
    await vote(g, m1, mode.id, "yes");
    expect(g.c.station.settings).toEqual({ access: "members-and-listed", listed: [other.c.id] });
    expect((await other.f.api.post(`${other.f.base}/gameplay/travel`).send({ toStationId: g.c.station.id })).status).toBe(200);
    expect((await outsider.api.post(`${outsider.base}/gameplay/travel`).send({ toStationId: g.c.station.id })).status).toBe(400);
  });

  it("rejects when half or more votes no, lets a vote run out without a change, and refuses another conglomerate's station", async () => {
    const g = await guild(1);
    const [m] = g.ms;
    await build(g, [[m, 1_000_000], [g.d, 1_000_000]]); // m more (the goods), d less than half
    const p1 = (await propose(g, g.d, { setting: "access", value: "members" })).body.proposal;
    expect((await vote(g, m, p1.id, "no")).body.proposal.state).toBe("rejected");
    expect(g.c.station.settings.access).toBe("open");
    const p2 = (await propose(g, g.d, { setting: "access", value: "members" })).body.proposal;
    settleAllStationGovernance(p2.closesAt - 1);
    expect(g.c.station.proposals.find((p) => p.id === p2.id).state).toBe("open");
    settleAllStationGovernance(p2.closesAt);
    expect(g.c.station.proposals.find((p) => p.id === p2.id).state).toBe("expired");
    expect(g.c.station.settings.access).toBe("open");
    expect((await vote(g, m, p2.id, "yes")).body.code).toBe("vote-closed");
    // another conglomerate's members cannot see, propose on, or vote on this station
    const other = await guild(0);
    const p3 = (await propose(g, g.d, { setting: "access", value: "members" })).body.proposal;
    expect((await other.d.api.post(`${other.d.base}/conglomerates/${g.c.id}/station/proposals/${p3.id}/vote`).send({ vote: "yes" })).status).toBe(404);
    expect((await other.f.api.post(`${other.f.base}/conglomerates/${g.c.id}/station/proposals`).send({ setting: "access", value: "open" })).status).toBe(404);
    expect((await vote(g, m, "csv-nope", "yes")).status).toBe(404);
    expect(g.c.station.settings.access).toBe("open");
  });

  it("fails closed: stakes that do not make 100% decide nothing and record no vote", async () => {
    const g = await guild(1);
    const [m] = g.ms;
    await build(g, [[m, 1_000_000], [g.d, 1_000_000]]);
    const p = (await propose(g, g.d, { setting: "access", value: "members" })).body.proposal;
    g.c.station.stakes[m.corpId].bps -= 1; // corrupted
    expect((await vote(g, m, p.id, "yes")).body.code).toBe("vote-unavailable");
    settleStationGovernance(g.c, p.closesAt + 1);
    expect(g.c.station.proposals.find((x) => x.id === p.id).state).toBe("open");
    expect(g.c.station.settings.access).toBe("open");
  });

  it("a station nobody paid into is decided by the founder, who moved the pool", async () => {
    const g = await guild(0);
    await build(g, [[g.f, 0]], BOM.credits); // credits from the pool; the founder's goods are its own
    g.c.station.stakes = {}; // as if every good had come from the hangar
    const res = await propose(g, g.f, { setting: "access", value: "members" });
    expect(res.body.proposal.state).toBe("passed");
    expect(g.c.station.settings.access).toBe("members");
  });
});

describe("a departing corporation's stake (ISP-211, AB#906)", () => {
  it("leaving: 50% of its contributed value from the treasury in 30 daily instalments; the others' stakes grow; value is conserved", async () => {
    const g = await guild(2);
    const [m1, m2] = g.ms;
    await build(g, [[m1, 800_000], [g.d, 600_000], [m2, 600_000]]);
    const value = g.c.station.stakes[m2.corpId].value;
    moveTreasury(g.c, { at: Date.now(), kind: "deposit", corp: g.f.corpId, amount: 1_000_000, by: g.f.corpId });
    const left = await m2.api.post(g.url(m2, "/leave")).send({});
    expect(left.status).toBe(200);
    expect(left.body.buyout).toEqual({ total: Math.floor(value / 2), days: C.stakeBuyoutDays });
    expect(g.c.station.stakes[m2.corpId]).toBeUndefined();
    expect(sumBps(g.c.station.stakes)).toBe(TOTAL_BPS);
    expect(g.c.station.stakes).toEqual(stakesFrom({ [m1.corpId]: g.c.station.stakes[m1.corpId].value, [g.d.corpId]: 600_000 }));
    const b = g.c.buyouts.at(-1);
    const start = b.startsAt;
    const pool = () => g.c.treasury.credits + m2.corp().finances.credits;
    const before = pool();
    settleStationGovernance(g.c, start + DAY - 1);
    expect(b.paid).toBe(0);
    settleStationGovernance(g.c, start + DAY);
    expect(b.paid).toBe(Math.floor(b.total / C.stakeBuyoutDays));
    settleStationGovernance(g.c, start + 10 * DAY);
    expect(b.paid).toBe(Math.floor((b.total * 10) / C.stakeBuyoutDays));
    expect(pool()).toBe(before);
    settleStationGovernance(g.c, start + 40 * DAY);
    expect(b).toMatchObject({ paid: b.total, state: "paid" });
    expect(pool()).toBe(before);
    expect(m2.corp().finances.incomeByCategory?.["conglomerate-stake-buyout"] ?? m2.corp().finances.dayBook?.income?.["conglomerate-stake-buyout"]).toBeGreaterThan(0);
    expect(g.c.ledger.reduce((s, r) => s + r.amount, 0)).toBe(g.c.treasury.credits);
  });

  it("removal pays 100%; a short treasury pays what it can and owes the rest; dissolution pays it all first", async () => {
    const g = await guild(1);
    const [m] = g.ms;
    await build(g, [[m, 1_200_000], [g.d, 800_000]]);
    const value = g.c.station.stakes[g.d.corpId].value;
    expect((await g.f.api.post(g.url(g.f, `/members/${g.d.corpId}/remove`)).send({})).status).toBe(200);
    const b = g.c.buyouts.at(-1);
    expect(b).toMatchObject({ how: "removed", total: value, pct: 100 });
    expect(Object.keys(g.c.station.stakes)).toEqual([m.corpId]);
    expect(g.c.station.stakes[m.corpId].bps).toBe(TOTAL_BPS);
    const t0 = g.c.treasury.credits; // too little for a day's instalment
    settleStationGovernance(g.c, b.startsAt + 5 * DAY);
    expect(b.paid).toBe(Math.min(t0, Math.floor((b.total * 5) / b.days)));
    moveTreasury(g.c, { at: Date.now(), kind: "deposit", corp: g.f.corpId, amount: 2_000_000, by: g.f.corpId });
    settleStationGovernance(g.c, b.startsAt + 5 * DAY);
    expect(b.paid).toBe(Math.floor((b.total * 5) / b.days));
    const dPaid = b.paid;
    const dCredits = g.d.corp().finances.credits;
    expect((await g.f.api.post(g.url(g.f, "/dissolve")).send({})).status).toBe(200);
    expect(b).toMatchObject({ paid: b.total, state: "paid" });
    expect(g.d.corp().finances.credits).toBe(dCredits + b.total - dPaid);
  });

  it("a corporation that leaves during funding is bought out at 50%, and its contributions stay in the project as the pool's", async () => {
    const g = await guild(1);
    const [m] = g.ms;
    expect((await g.f.api.post(g.url(g.f, "/station-project")).send({ systemId: g.site.systemId, body: g.site.body, suffix: 1 })).status).toBe(201);
    expect((await m.api.post(g.url(m, "/station-project/contribute")).send({ source: "own", credits: 300_000 })).status).toBe(200);
    expect((await m.api.post(g.url(m, "/leave")).send({})).body.buyout).toEqual({ total: 150_000, days: C.stakeBuyoutDays });
    const row = g.c.stationProject.contributions[0];
    expect(row).toMatchObject({ corp: null, formerCorp: m.corpId, credits: 300_000 });
    expect(g.c.stationProject.credits).toBe(300_000);
  });
});
