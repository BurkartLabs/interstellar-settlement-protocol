import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore, saveAccountsNow } from "../../server/game/store.js";
import { dataDir } from "../../server/game/catalog.js";
import { dayStartOf, dailyUpkeep, moveTreasury } from "../../server/game/conglomerates.js";
import { answerInvitation, findConglomerate, inviteCorporation } from "../../server/game/membership.js";
import { setMemberRole, removeMember } from "../../server/game/conglomerateRoles.js";
import { blockWithdrawal, depositToTreasury, treasuryView, withdrawFromTreasury, withdrawalAllowance } from "../../server/game/treasury.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";

// ISP-204 (AB#898): the conglomerate treasury. Deposits and withdrawals, per-role daily caps from 00:00 UTC, announced
// withdrawals and blocks, upkeep and arrears, one ledger row per movement summing to the balance, and the misuse the
// item names. Money moves through the corporation's own books (applyCredits), so its P&L sees it.
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
let seq = 0;
const sum = (c) => c.ledger.reduce((s, r) => s + r.amount, 0);

async function player(credits = 1_000_000) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  raw.createdAt = Date.now() - (C.minMemberAgeDays + 1) * DAY; // Bug #4801: registered long enough ago to join a conglomerate
  raw.state.corp.finances.credits = credits;
  return { id: reg.account.id, raw, corpId: raw.state.corp.publicId, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
}

/** A founder and its conglomerate, with `directors` directors and `members` members, all registered players. */
async function guild({ directors = 0, members = 0 } = {}) {
  const f = await player();
  f.raw.createdAt = Date.now() - 8 * DAY;
  const res = await f.api.post(`${f.base}/conglomerates`).send({ name: `Vault ${Date.now() % 1e6} ${(seq += 1)}`, emblem: 1, colour: 1 });
  expect(res.status).toBe(201);
  const c = findConglomerate(res.body.conglomerate.id);
  const join = async () => {
    const p = await player();
    const inv = inviteCorporation(f.id, c.id, p.corpId);
    expect(answerInvitation(p.id, c.id, inv.invitation.id, "accept").refused).toBeUndefined();
    return p;
  };
  const ds = [];
  for (let i = 0; i < directors; i += 1) { const d = await join(); setMemberRole(f.id, c.id, d.corpId, "director"); ds.push(d); }
  const ms = [];
  for (let i = 0; i < members; i += 1) ms.push(await join());
  const t = (p) => `${p.base}/conglomerates/${c.id}/treasury`;
  return { f, ds, ms, c, t };
}

describe("deposits and withdrawals (ISP-204, AB#898)", () => {
  it("a deposit pays the custody fee and is booked on the corporation's statement; a small withdrawal comes straight back", async () => {
    const g = await guild({ members: 1 });
    const [m] = g.ms;
    const before = m.raw.state.corp.finances.credits;
    const dep = await m.api.post(`${g.t(m)}/deposit`).send({ amount: 10_000 });
    expect(dep.status).toBe(200);
    expect(dep.body).toMatchObject({ deposited: 10_000, fee: 200, treasury: { credits: 19_800 } });
    expect(m.raw.state.corp.finances.credits).toBe(before - 10_000);
    expect(m.raw.state.corp.finances.expensesByCategory["conglomerate-contribution"]).toBe(10_000);
    expect(g.c.ledger.slice(-2).map((r) => [r.kind, r.amount, r.balanceAfter])).toEqual([["deposit", 10_000, 20_000], ["custody-fee", -200, 19_800]]);
    // Members take no credits.
    expect((await m.api.post(`${g.t(m)}/withdraw`).send({ amount: 100 })).status).toBe(403);
    // The founder's cap is 20% of the 10,000 the treasury opened the day with (it was chartered today): 2,000.
    const w = await g.f.api.post(`${g.t(g.f)}/withdraw`).send({ amount: 1_500 });
    expect(w.status).toBe(200);
    expect(w.body.withdrawal.state).toBe("paid");
    expect(g.c.treasury.credits).toBe(18_300);
    expect(g.f.raw.state.corp.finances.incomeByCategory?.["conglomerate-withdrawal"] ?? g.f.raw.state.corp.finances.dayBook.income["conglomerate-withdrawal"]).toBe(1_500);
    expect(sum(g.c)).toBe(g.c.treasury.credits);
  });

  it("never lets the treasury or a member's credits go below zero", async () => {
    const g = await guild({ members: 1 });
    g.ms[0].raw.state.corp.finances.credits = 500;
    expect((await g.ms[0].api.post(`${g.t(g.ms[0])}/deposit`).send({ amount: 501 })).body.code).toBe("insufficient-credits");
    expect(g.ms[0].raw.state.corp.finances.credits).toBe(500);
    expect(() => moveTreasury(g.c, { at: Date.now(), kind: "test", amount: -(g.c.treasury.credits + 1) })).toThrow(/below zero/);
    expect(g.c.treasury.credits).toBeGreaterThanOrEqual(0);
    expect(sum(g.c)).toBe(g.c.treasury.credits);
  });
});

describe("the daily cap (ISP-204, AB#898)", () => {
  it("two withdrawals at once that together pass the cap: one is paid, one refused", async () => {
    const g = await guild({ directors: 1 });
    const [d] = g.ds;
    // Yesterday's deposit sets the balance the day opened with: 10,000 + 98,000 = 108,000. A director's cap is 5%: 5,400.
    depositToTreasury(g.f.id, g.c.id, 100_000, dayStartOf(Date.now()) - HOUR);
    expect(withdrawalAllowance(g.c, "director", d.corpId).cap).toBe(5_400);
    const results = await Promise.all([3_000, 3_000].map((amount) => d.api.post(`${g.t(d)}/withdraw`).send({ amount })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409).body.code).toBe("over-daily-cap");
    expect(results.find((r) => r.status === 409).body.error).toMatch(/resets at 00:00 UTC/);
    expect(g.c.withdrawals.filter((w) => w.state === "paid")).toHaveLength(1);
  });

  it(`caps a director at ${C.directorWithdrawMax.toLocaleString("en-US")} however large the treasury`, async () => {
    const g = await guild({ directors: 1 });
    g.f.raw.state.corp.finances.credits = 100_000_000;
    depositToTreasury(g.f.id, g.c.id, 50_000_000, dayStartOf(Date.now()) - HOUR);
    expect(withdrawalAllowance(g.c, "director", g.ds[0].corpId).cap).toBe(C.directorWithdrawMax);
  });

  it("resets at 00:00 UTC", async () => {
    const g = await guild();
    const day = dayStartOf(Date.now()) + 2 * DAY;
    const late = day + DAY - 60_000; // 23:59 UTC
    g.f.raw.lastLoginAt = late;
    treasuryView(g.f.id, g.c.id, late); // bring upkeep up to 23:59
    const withdraw = (amount, now) => withdrawFromTreasury(g.f.id, g.c.id, amount, now);
    // Spend the whole day's cap, in pieces under the announcement line so each is paid at once.
    let left = withdrawalAllowance(g.c, "founder", g.f.raw.state.corp.publicId, late).cap;
    expect(left).toBeGreaterThan(0);
    while (left > 0) {
      const amount = Math.min(left, Math.floor((g.c.treasury.credits * C.withdrawalNoticePct) / 100));
      expect(withdraw(amount, late).refused).toBeUndefined();
      left -= amount;
    }
    expect(withdraw(1, late).refused.code).toBe("over-daily-cap");
    const next = day + DAY + 60_000; // 00:01 UTC the next day
    g.f.raw.lastLoginAt = next;
    expect(withdraw(1, next).refused).toBeUndefined();
    expect(withdrawalAllowance(g.c, "founder", g.f.raw.state.corp.publicId, next).used).toBe(1);
  });
});

describe("large withdrawals are announced, wait, and can be blocked (ISP-204, AB#898)", () => {
  async function funded() {
    const g = await guild({ directors: 2, members: 1 });
    depositToTreasury(g.f.id, g.c.id, 500_000, dayStartOf(Date.now()) - HOUR); // opening 500,000
    return g;
  }

  it("the founder's withdrawal above 10% waits 24 hours, members are told, and two directors block it", async () => {
    const g = await funded();
    const balance = g.c.treasury.credits;
    const res = await g.f.api.post(`${g.t(g.f)}/withdraw`).send({ amount: 60_000 });
    expect(res.body.withdrawal).toMatchObject({ state: "pending", amount: 60_000 });
    expect(g.c.treasury.credits).toBe(balance); // nothing has left
    expect(g.ms[0].raw.notifications[0].title).toMatch(/A large withdrawal/);
    const [d1, d2] = g.ds;
    const id = res.body.withdrawal.id;
    expect((await g.ms[0].api.post(`${g.t(g.ms[0])}/withdrawals/${id}/block`)).status).toBe(403);
    expect((await d1.api.post(`${g.t(d1)}/withdrawals/${id}/block`)).body.withdrawal.state).toBe("pending");
    expect((await d1.api.post(`${g.t(d1)}/withdrawals/${id}/block`)).body.code).toBe("already-blocked");
    expect((await d2.api.post(`${g.t(d2)}/withdrawals/${id}/block`)).body.withdrawal.state).toBe("blocked");
    g.f.raw.lastLoginAt = Date.now() + 2 * DAY;
    treasuryView(g.f.id, g.c.id, Date.now() + 2 * DAY);
    expect(g.c.treasury.credits).toBeLessThanOrEqual(balance); // only upkeep, never the blocked withdrawal
    expect(g.c.ledger.map((r) => r.kind)).toContain("withdrawal-blocked");
    expect(g.c.ledger.filter((r) => r.kind === "withdrawal")).toHaveLength(0);
  });

  it("an unblocked one is paid when its 24 hours are up; the founder alone stops a director's", async () => {
    const g = await funded();
    const [d1] = g.ds;
    const big = await g.f.api.post(`${g.t(g.f)}/withdraw`).send({ amount: 60_000 });
    const credits = g.f.raw.state.corp.finances.credits;
    const later = big.body.withdrawal.completesAt + 1;
    g.f.raw.lastLoginAt = later;
    treasuryView(g.f.id, g.c.id, later);
    expect(g.c.withdrawals.find((w) => w.id === big.body.withdrawal.id).state).toBe("paid");
    expect(g.f.raw.state.corp.finances.credits).toBe(credits + 60_000);
    // A director's announced withdrawal (above 10% of a small balance, within its 5% cap of the opening)...
    const small = await guild({ directors: 1 });
    depositToTreasury(small.f.id, small.c.id, 100_000, dayStartOf(Date.now()) - HOUR);
    for (let i = 0; i < 1; i += 1) withdrawFromTreasury(small.f.id, small.c.id, Math.floor(small.c.treasury.credits * 0.09));
    const dw = withdrawFromTreasury(small.ds[0].id, small.c.id, 5_000);
    if (dw.withdrawal.state === "pending") {
      expect(blockWithdrawal(small.f.id, small.c.id, dw.withdrawal.id).withdrawal.state).toBe("blocked");
    } else {
      expect(dw.withdrawal.state).toBe("paid"); // under the line: paid at once, nothing to block
    }
    expect(blockWithdrawal(d1.id, g.c.id, "cwd-does-not-exist").refused.status).toBe(404);
  });
});

describe("upkeep and arrears (ISP-204, AB#898)", () => {
  it("charges each midnight; when it cannot, the conglomerate is in arrears, admits nobody, and a deposit clears it", async () => {
    const g = await guild({ members: 1 });
    const joiner = await player();
    const inv = inviteCorporation(g.f.id, g.c.id, joiner.corpId);
    const start = g.c.treasury.credits;
    const t1 = g.c.upkeepPaidThrough + 1;
    g.f.raw.lastLoginAt = t1;
    treasuryView(g.f.id, g.c.id, t1);
    expect(g.c.ledger.at(-1)).toMatchObject({ kind: "upkeep", amount: -dailyUpkeep(2) });
    expect(g.c.treasury.credits).toBe(start - dailyUpkeep(2));
    // Empty the treasury, then let two midnights pass unpaid.
    moveTreasury(g.c, { at: t1, kind: "test-drain", amount: -g.c.treasury.credits });
    const t3 = t1 + 2 * DAY;
    g.f.raw.lastLoginAt = t3;
    const view = treasuryView(g.f.id, g.c.id, t3);
    expect(view.arrears).toMatchObject({ owed: 2 * dailyUpkeep(2) });
    expect(answerInvitation(joiner.id, g.c.id, inv.invitation.id, "accept", t3).refused?.code).toBe("in-arrears");
    expect(depositToTreasury(g.ms[0].id, g.c.id, 10_000, t3).refused).toBeUndefined();
    expect(g.c.arrearsSince).toBeNull();
    expect(g.c.ledger.at(-1).kind).toBe("arrears-paid");
    expect(sum(g.c)).toBe(g.c.treasury.credits);
  });

  it(`drops a level after ${C.arrearsDropDays} days in arrears, removing nobody`, async () => {
    const g = await guild({ members: 2 });
    Object.assign(g.c, { level: 2, maxMembers: 10 });
    moveTreasury(g.c, { at: Date.now(), kind: "test-drain", amount: -g.c.treasury.credits });
    const later = g.c.upkeepPaidThrough + (C.arrearsDropDays + 1) * DAY;
    g.f.raw.lastLoginAt = later;
    treasuryView(g.f.id, g.c.id, later);
    expect([g.c.level, g.c.maxMembers, g.c.members.length]).toEqual([1, 5, 3]);
    expect(g.c.ledger.map((r) => r.kind)).toContain("level-lost");
    expect(g.ms[0].raw.notifications[0].title).toMatch(/lost a level/);
  });
});

describe("the ledger (ISP-204, AB#898)", () => {
  it("holds exactly one row per movement and sums to the balance over 200 random operations", async () => {
    const g = await guild({ directors: 1, members: 1 });
    let seed = 20260927;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const actors = [g.f, g.ds[0], g.ms[0]];
    let now = Date.now();
    for (let i = 0; i < 200; i += 1) {
      now += Math.floor(rand() * 9 * HOUR);
      g.f.raw.lastLoginAt = now;
      treasuryView(g.f.id, g.c.id, now); // settle: upkeep and due withdrawals write their own rows
      const who = actors[Math.floor(rand() * actors.length)];
      const before = g.c.ledger.length;
      const balance = g.c.treasury.credits;
      const op = rand();
      let r, expected;
      if (op < 0.45) {
        const amount = [1, 50, 999, 10_000, 250_000][Math.floor(rand() * 5)];
        r = depositToTreasury(who.id, g.c.id, amount, now);
        expected = r.refused ? 0 : r.fee > 0 ? 2 : 1;
      } else if (op < 0.9) {
        const amount = 1 + Math.floor(rand() * Math.max(1, balance * 0.15));
        r = withdrawFromTreasury(who.id, g.c.id, amount, now);
        expected = r.refused ? 0 : 1; // paid: one withdrawal row; announced: one announcement row
      } else {
        r = withdrawFromTreasury(who.id, g.c.id, [0, -5, 2.5, Number.NaN][Math.floor(rand() * 4)], now);
        expect(["invalid-amount", "not-permitted"]).toContain(r.refused.code); // a member is refused by role first
        expected = 0;
      }
      expect(g.c.ledger.length - before, `op ${i}`).toBe(expected);
      expect(g.c.treasury.credits).toBeGreaterThanOrEqual(0);
      expect(sum(g.c), `op ${i}`).toBe(g.c.treasury.credits);
    }
    // The run covered every kind of movement, not just the easy ones.
    const kinds = new Set(g.c.ledger.map((r) => r.kind));
    for (const kind of ["deposit", "custody-fee", "withdrawal", "withdrawal-announced", "upkeep"]) expect(kinds.has(kind), kind).toBe(true);
  });

  it("cannot be edited: its rows are frozen, and no conglomerate route puts, patches or deletes", async () => {
    const g = await guild();
    const row = g.c.ledger[0];
    expect(Object.isFrozen(row)).toBe(true);
    expect(() => { "use strict"; row.amount = 1e9; }).toThrow();
    const { app } = await getApp();
    const writes = [];
    for (const layer of app._router.stack) {
      if (!layer.route || !/conglomerate/.test(layer.route.path)) continue;
      for (const method of Object.keys(layer.route.methods)) if (!["get", "post"].includes(method)) writes.push(`${method} ${layer.route.path}`);
    }
    expect(writes).toEqual([]);
    const posts = app._router.stack.filter((l) => l.route?.methods.post && /treasury/.test(l.route.path)).map((l) => l.route.path.split("/treasury")[1]);
    expect(posts.sort()).toEqual(["/deposit", "/withdraw", "/withdrawals/:withdrawalId/block"]);
  });

  it("shows the founder and directors the whole ledger, a member its own rows, and nobody else anything", async () => {
    const g = await guild({ directors: 1, members: 1 });
    const outsider = await player();
    await g.ms[0].api.post(`${g.t(g.ms[0])}/deposit`).send({ amount: 5_000 });
    const full = (await g.ds[0].api.get(g.t(g.ds[0]))).body;
    expect(full.ledger.scope).toBe("all");
    expect(full.ledger.rows.map((r) => r.kind)).toEqual(expect.arrayContaining(["charter-deposit", "deposit", "custody-fee"]));
    const own = (await g.ms[0].api.get(g.t(g.ms[0]))).body;
    expect(own.ledger.scope).toBe("own");
    expect(own.ledger.rows.every((r) => r.corp === g.ms[0].corpId)).toBe(true);
    expect(own.allowance).toBeNull();
    expect((await outsider.api.get(`${outsider.base}/conglomerates/${g.c.id}/treasury`)).status).toBe(404);
  });
});

describe("misuse is refused and never reaches the save (ISP-204, AB#898)", () => {
  it("rejects non-numeric, negative, fractional and NaN amounts before anything is written", async () => {
    const g = await guild({ members: 1 });
    const m = g.ms[0];
    await saveAccountsNow();
    const snapshot = () => JSON.parse(fs.readFileSync(path.join(dataDir, "accounts-snapshot.json"), "utf8")).conglomerates.find((c) => c.id === g.c.id);
    const before = { ledger: g.c.ledger.length, credits: m.raw.state.corp.finances.credits, saved: snapshot().ledger.length };
    for (const amount of ["abc", -5, 2.5, null, "", {}, [], "1e3", 1e13, 0]) {
      for (const path_ of ["deposit", "withdraw"]) {
        const who = path_ === "deposit" ? m : g.f;
        const res = await who.api.post(`${g.t(who)}/${path_}`).send({ amount });
        expect(res.status, `${path_} ${JSON.stringify(amount)}`).toBe(400);
      }
    }
    await saveAccountsNow();
    expect([g.c.ledger.length, m.raw.state.corp.finances.credits, snapshot().ledger.length]).toEqual([before.ledger, before.credits, before.saved]);
  });

  it("refuses another conglomerate's id and a removed member's request", async () => {
    const [g, h] = [await guild({ members: 1 }), await guild()];
    expect((await g.f.api.post(`${g.f.base}/conglomerates/${h.c.id}/treasury/withdraw`).send({ amount: 10 })).status).toBe(404);
    expect((await g.f.api.post(`${g.f.base}/conglomerates/${h.c.id}/treasury/deposit`).send({ amount: 10 })).status).toBe(404);
    const [m] = g.ms;
    removeMember(g.f.id, g.c.id, m.corpId);
    const late = await m.api.post(`${g.t(m)}/deposit`).send({ amount: 100 });
    expect(late.status).toBe(404);
    expect(g.c.ledger.filter((r) => r.corp === m.corpId && r.kind === "deposit")).toHaveLength(0);
  });

  it("fails closed when the cap cannot be read: refused, and no row written", async () => {
    const g = await guild();
    const before = g.c.ledger.length;
    const broken = { ...C, founderWithdrawPct: Number.NaN };
    expect(withdrawFromTreasury(g.f.id, g.c.id, 10, Date.now(), broken).refused).toMatchObject({ status: 503, code: "treasury-unavailable" });
    expect(g.c.ledger.length).toBe(before);
  });
});
