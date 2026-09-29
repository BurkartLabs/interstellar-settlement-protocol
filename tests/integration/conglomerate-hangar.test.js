import { afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore, saveAccountsNow } from "../../server/game/store.js";
import { dataDir } from "../../server/game/catalog.js";
import { dayStartOf } from "../../server/game/conglomerates.js";
import { answerInvitation, findConglomerate, inviteCorporation } from "../../server/game/membership.js";
import { dissolveConglomerate, setMemberRole } from "../../server/game/conglomerateRoles.js";
import { depositGoods, goodsAllowance, hangarView, moveHangar, withdrawGoods } from "../../server/game/hangar.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";

// ISP-205 (AB#899): the pooled goods hangar at the home station. Goods move between a member's own stock at that
// station and the hangar, conserved; withdrawals are capped per role, per item, per UTC day; each item's ledger rows
// sum to its stock; hostile stations, items and quantities move nothing; and the hangar survives a restart.
const HOME = C.homeStationId;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
let seq = 0;
const stockAt = (p, item) => Math.floor(Number(p.raw.state.corp.inventory?.[HOME]?.[item]) || 0);
const itemRows = (c, item) => c.hangar.ledger.filter((r) => r.item === item);

async function player(goods = { Silicates: 20_000, Nickel: 5_000 }) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  raw.createdAt = Date.now() - (C.minMemberAgeDays + 1) * DAY; // Bug #4801: registered long enough ago to join a conglomerate
  raw.state.corp.inventory = { ...(raw.state.corp.inventory || {}), [HOME]: { ...goods } };
  return { id: reg.account.id, raw, reg, corpId: raw.state.corp.publicId, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
}

async function guild({ directors = 0, members = 0 } = {}) {
  const f = await player();
  f.raw.createdAt = Date.now() - 8 * DAY;
  const res = await f.api.post(`${f.base}/conglomerates`).send({ name: `Depot ${Date.now() % 1e6} ${(seq += 1)}`, emblem: 1, colour: 1 });
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
  return { f, ds, ms, c, h: (p) => `${p.base}/conglomerates/${c.id}/hangar` };
}

describe("depositing and withdrawing goods (ISP-205, AB#899)", () => {
  it("moves goods between a member's stock at the home station and the hangar, conserving every unit", async () => {
    const g = await guild({ members: 1 });
    const [m] = g.ms;
    const total = () => stockAt(m, "Silicates") + stockAt(g.f, "Silicates") + (g.c.hangar?.items?.Silicates || 0);
    const before = total();
    const dep = await m.api.post(`${g.h(m)}/deposit`).send({ stationId: HOME, item: "Silicates", quantity: 10_000 });
    expect(dep.status).toBe(200);
    expect(dep.body.hangar.items.Silicates).toBe(10_000);
    expect(stockAt(m, "Silicates")).toBe(10_000);
    // By catalog id too: "nickel" is Nickel.
    expect((await m.api.post(`${g.h(m)}/deposit`).send({ stationId: HOME, item: "nickel", quantity: 5_000 })).body.hangar.items).toMatchObject({ Nickel: 5_000 });
    expect(stockAt(m, "Nickel")).toBe(0);
    expect(m.raw.state.corp.inventory[HOME]).not.toHaveProperty("Nickel"); // an emptied line is removed, not left at 0
    // The founder takes 20% of what the hangar opened with; the hangar opened today, so its first row: 10,000 -> 2,000.
    const w = await g.f.api.post(`${g.h(g.f)}/withdraw`).send({ stationId: HOME, item: "Silicates", quantity: 2_000 });
    expect(w.status).toBe(200);
    expect(total()).toBe(before);
    expect(itemRows(g.c, "Silicates").map((r) => [r.kind, r.amount, r.balanceAfter])).toEqual([["deposit", 10_000, 10_000], ["withdrawal", -2_000, 8_000]]);
  });

  it("works only for a member docked at the home station or holding goods there", async () => {
    const g = await guild({ members: 2 });
    const [away, holder] = g.ms;
    away.raw.state.corp.currentStationId = "mars-orbital-dock";
    away.raw.state.corp.inventory = { "mars-orbital-dock": { Silicates: 100 } };
    const refused = await away.api.post(`${g.h(away)}/deposit`).send({ stationId: HOME, item: "Silicates", quantity: 1 });
    expect(refused.body.code).toBe("not-at-station");
    holder.raw.state.corp.currentStationId = "mars-orbital-dock"; // elsewhere, but its goods are at the home station
    expect((await holder.api.post(`${g.h(holder)}/deposit`).send({ stationId: HOME, item: "Silicates", quantity: 1 })).status).toBe(200);
    expect((await g.f.api.post(`${g.h(g.f)}/deposit`).send({ stationId: "mars-orbital-dock", item: "Silicates", quantity: 1 })).body.code).toBe("wrong-station");
  });
});

describe("per-role daily caps (ISP-205, AB#899)", () => {
  async function stocked() {
    const g = await guild({ directors: 1, members: 1 });
    depositGoods(g.f.id, g.c.id, { stationId: HOME, item: "Silicates", quantity: 10_000 }, dayStartOf(Date.now()) - HOUR); // yesterday
    return g;
  }

  it(`are ${C.founderWithdrawPct}%, ${C.directorWithdrawPct}% and ${C.memberGoodsWithdrawPct}% of each item's stock at 00:00 UTC`, async () => {
    const g = await stocked();
    expect(goodsAllowance(g.c, "founder", g.f.corpId, "Silicates").cap).toBe(2_000);
    expect(goodsAllowance(g.c, "director", g.ds[0].corpId, "Silicates").cap).toBe(500);
    expect(goodsAllowance(g.c, "member", g.ms[0].corpId, "Silicates").cap).toBe(200);
    expect(goodsAllowance(g.c, "member", g.ms[0].corpId, "Nickel").cap).toBe(0); // an item the hangar never held
  });

  it("two withdrawals at once that together pass the cap: one moves, one is refused", async () => {
    const g = await stocked();
    const [m] = g.ms;
    const results = await Promise.all([150, 150].map((quantity) => m.api.post(`${g.h(m)}/withdraw`).send({ stationId: HOME, item: "Silicates", quantity })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409).body.error).toMatch(/200 Silicates today .* resets at 00:00 UTC/);
    expect(g.c.hangar.items.Silicates).toBe(9_850);
  });

  it("resets at 00:00 UTC", async () => {
    const g = await stocked();
    const late = dayStartOf(Date.now()) + DAY - 60_000;
    g.f.raw.lastLoginAt = late + 2 * DAY;
    const take = (quantity, now) => withdrawGoods(g.ms[0].id, g.c.id, { stationId: HOME, item: "Silicates", quantity }, now);
    expect(take(200, late).refused).toBeUndefined();
    expect(take(1, late).refused.code).toBe("over-daily-cap");
    expect(take(1, late + 2 * 60_000).refused).toBeUndefined(); // 00:01 the next day
  });
});

describe("the hangar's ledger (ISP-205, AB#899)", () => {
  it("each item's rows sum to its stock, and goods are conserved, over 200 random operations", async () => {
    const g = await guild({ directors: 1, members: 1 });
    const actors = [g.f, g.ds[0], g.ms[0]];
    const items = ["Silicates", "Nickel"];
    const total = (item) => actors.reduce((s, p) => s + stockAt(p, item), 0) + (g.c.hangar?.items?.[item] || 0);
    const start = Object.fromEntries(items.map((i) => [i, total(i)]));
    let seed = 899;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let now = Date.now();
    for (let i = 0; i < 200; i += 1) {
      now += Math.floor(rand() * 6 * HOUR);
      g.f.raw.lastLoginAt = now;
      const who = actors[Math.floor(rand() * actors.length)];
      const item = items[Math.floor(rand() * items.length)];
      const quantity = [1, 7, 60, 400, 3_000][Math.floor(rand() * 5)];
      const before = g.c.hangar?.ledger?.length || 0;
      const r = rand() < 0.5
        ? depositGoods(who.id, g.c.id, { stationId: HOME, item, quantity }, now)
        : withdrawGoods(who.id, g.c.id, { stationId: HOME, item, quantity }, now);
      expect((g.c.hangar?.ledger?.length || 0) - before, `op ${i}`).toBe(r.refused ? 0 : 1);
      for (const it of items) {
        expect(itemRows(g.c, it).reduce((s, row) => s + row.amount, 0), `op ${i} ${it}`).toBe(g.c.hangar?.items?.[it] || 0);
        expect(total(it), `op ${i} ${it} conserved`).toBe(start[it]);
      }
    }
    expect(new Set(g.c.hangar.ledger.map((r) => r.kind))).toEqual(new Set(["deposit", "withdrawal"]));
  });

  it("cannot be edited: rows are frozen, stock never goes below zero, and the only hangar writes are deposit and withdraw", async () => {
    const g = await guild();
    depositGoods(g.f.id, g.c.id, { stationId: HOME, item: "Silicates", quantity: 10 });
    expect(Object.isFrozen(g.c.hangar.ledger[0])).toBe(true);
    expect(() => moveHangar(g.c, { at: Date.now(), kind: "test", item: "Silicates", quantity: -11 })).toThrow(/below zero/);
    const { app } = await getApp();
    const posts = app._router.stack.filter((l) => l.route && /\/hangar/.test(l.route.path)).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path.split("/hangar")[1] || "/"}`);
    expect(posts.sort()).toEqual(["get /", "post /deposit", "post /withdraw"]);
  });

  it("shows the founder and directors every row, a member its own, and an outsider nothing", async () => {
    const g = await guild({ directors: 1, members: 1 });
    await g.ms[0].api.post(`${g.h(g.ms[0])}/deposit`).send({ stationId: HOME, item: "Silicates", quantity: 5 });
    await g.f.api.post(`${g.h(g.f)}/deposit`).send({ stationId: HOME, item: "Silicates", quantity: 7 });
    expect((await g.ds[0].api.get(g.h(g.ds[0]))).body.ledger).toMatchObject({ scope: "all", total: 2 });
    const own = (await g.ms[0].api.get(g.h(g.ms[0]))).body;
    expect(own.ledger).toMatchObject({ scope: "own", total: 1 });
    expect(own.items).toEqual({ Silicates: 12 });
    const outsider = await player();
    expect((await outsider.api.get(`${outsider.base}/conglomerates/${g.c.id}/hangar`)).status).toBe(404);
  });
});

describe("hostile input moves nothing (ISP-205, AB#899)", () => {
  it("refuses unknown items and stations, and non-integer, negative or oversized quantities", async () => {
    const g = await guild({ members: 1 });
    const [m] = g.ms;
    const before = { stock: JSON.stringify(m.raw.state.corp.inventory), rows: g.c.hangar?.ledger?.length || 0 };
    const cases = [
      [{ stationId: HOME, item: "Unobtainium", quantity: 1 }, "unknown-item"],
      [{ stationId: HOME, item: "__proto__", quantity: 1 }, "unknown-item"],
      [{ stationId: "atlantis-station", item: "Silicates", quantity: 1 }, null],
      [{ stationId: HOME, item: "Silicates", quantity: -5 }, null],
      [{ stationId: HOME, item: "Silicates", quantity: 2.5 }, null],
      [{ stationId: HOME, item: "Silicates", quantity: "abc" }, null],
      [{ stationId: HOME, item: "Silicates", quantity: null }, null],
      [{ stationId: HOME, item: "Silicates", quantity: 1e10 }, null],
      [{ stationId: HOME, item: ["Silicates"], quantity: 1 }, null]
    ];
    for (const [body, code] of cases) {
      for (const op of ["deposit", "withdraw"]) {
        const res = await m.api.post(`${g.h(m)}/${op}`).send(body);
        expect(res.status, `${op} ${JSON.stringify(body)}`).toBe(400);
        if (code) expect(res.body.code).toBe(code);
      }
    }
    expect([JSON.stringify(m.raw.state.corp.inventory), g.c.hangar?.ledger?.length || 0]).toEqual([before.stock, before.rows]);
  });

  it("fails closed when the cap cannot be read", async () => {
    const g = await guild();
    depositGoods(g.f.id, g.c.id, { stationId: HOME, item: "Silicates", quantity: 100 });
    const rows = g.c.hangar.ledger.length;
    const r = withdrawGoods(g.f.id, g.c.id, { stationId: HOME, item: "Silicates", quantity: 1 }, Date.now(), { ...C, founderWithdrawPct: Number.NaN });
    expect(r.refused).toMatchObject({ status: 503, code: "hangar-unavailable" });
    expect(g.c.hangar.ledger.length).toBe(rows);
  });
});

describe("dissolution shares the hangar out (ISP-205, AB#899)", () => {
  it("splits each item equally among the members, the remainder to the founder, into their stock at the station", async () => {
    const g = await guild({ members: 2 });
    depositGoods(g.f.id, g.c.id, { stationId: HOME, item: "Nickel", quantity: 1_000 });
    const before = [g.f, ...g.ms].map((p) => stockAt(p, "Nickel"));
    const r = dissolveConglomerate(g.f.id, g.c.id);
    expect(r.refused).toBeUndefined();
    expect([g.f, ...g.ms].map((p, i) => stockAt(p, "Nickel") - before[i])).toEqual([334, 333, 333]);
    expect(g.c.hangar.items).toEqual({});
  });
});

describe("the hangar survives a restart (used save, P-FRESH-STATE-ONLY)", () => {
  const children = [];
  afterAll(() => { for (const child of children) child.kill(); });

  it("a second server on the same save shows the same holdings and ledger", async () => {
    const g = await guild({ members: 1 });
    await g.ms[0].api.post(`${g.h(g.ms[0])}/deposit`).send({ stationId: HOME, item: "Silicates", quantity: 1_234 });
    await g.f.api.post(`${g.h(g.f)}/deposit`).send({ stationId: HOME, item: "Nickel", quantity: 56 });
    await saveAccountsNow();
    const dir = fs.mkdtempSync(path.join(process.env.ISP_TEST_DATA_ROOT, "hangar-restart-"));
    for (const file of ["accounts-snapshot.json", "state.json"]) fs.copyFileSync(path.join(dataDir, file), path.join(dir, file));
    const child = spawn(process.execPath, ["server/index.js"], {
      cwd: path.resolve(import.meta.dirname, "..", ".."),
      env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", ISP_DISABLE_TICKERS: "1", ISP_DEV: "", NODE_ENV: "test", JWT_SECRET: "hangar-restart-secret-0123456789abcdef" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    children.push(child);
    const url = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
      const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
    });
    const login = await request(url).post("/api/auth/login").send({ email: g.f.reg.body.email, password: g.f.reg.body.password });
    expect(login.status).toBe(200);
    const again = await request(url).get(`/api/accounts/${g.f.id}/conglomerates/${g.c.id}/hangar`).set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(again.status).toBe(200);
    expect(again.body.items).toEqual({ Silicates: 1_234, Nickel: 56 });
    expect(again.body.ledger.rows.map((r) => [r.kind, r.item, r.amount])).toEqual([["deposit", "Nickel", 56], ["deposit", "Silicates", 1_234]]);
  }, 40_000);
});
