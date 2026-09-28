import { afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore, saveAccountsNow } from "../../server/game/store.js";
import { dataDir } from "../../server/game/catalog.js";
import { RESERVED_CONGLOMERATE_NAMES, charterNameCheck, conglomerateList, foundConglomerate } from "../../server/game/conglomerates.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";

// ISP-197 (AB#891): founding a conglomerate at the Conglomerate Affairs Bureau (docs/design/CONGLOMERATES.md, "The
// charter"). Each refusal has its own code; the fee and the new conglomerate are one change; the directory shows no
// account id; and a corporation that has played a while keeps everything it had through the charter and a restart.
const DAY = 24 * 60 * 60 * 1000;
const COST = C.charterFee + C.charterDeposit;
let seq = 0;
const uniqueName = (stem = "Charter") => `${stem} ${Date.now() % 1e6} ${(seq += 1)}`;

/** A registered corporation old enough to found, at the Bureau, with credits for the charter. */
async function founder(overrides = {}) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  raw.createdAt = Date.now() - (C.minFounderAgeDays + 1) * DAY;
  raw.state.corp.currentStationId = C.charterStationId;
  raw.state.corp.finances.credits = 250_000;
  return { app, reg, raw, api: authed(app, reg.accessToken), url: `/api/accounts/${reg.account.id}/conglomerates`, ...overrides };
}

const charter = (f, body) => f.api.post(f.url).send({ emblem: 1, colour: 1, ...body });

describe("founding a conglomerate (ISP-197, AB#891)", () => {
  it("makes the founder its only member, takes the fee and the deposit, and lists it in the directory without account ids", async () => {
    const f = await founder();
    const name = uniqueName();
    const res = await charter(f, { name, emblem: 3, colour: 7 });
    expect(res.status).toBe(201);
    expect(res.body.state.corp.finances.credits).toBe(250_000 - COST);
    expect(res.body.state.corp.conglomerateId).toBe(res.body.conglomerate.id);
    expect(res.body.conglomerate).toMatchObject({ name, emblem: 3, colour: 7, level: 1, memberCount: 1, maxMembers: 5, role: "founder", treasury: { credits: C.charterDeposit } });
    const stored = conglomerateList().find((c) => c.id === res.body.conglomerate.id);
    expect(stored.members).toEqual([{ corp: f.raw.state.corp.publicId, role: "founder", joinedAt: stored.foundedAt }]);

    const dir = await f.api.get("/api/conglomerates");
    expect(dir.status).toBe(200);
    expect(dir.body.conglomerates).toContainEqual({ id: stored.id, name, emblem: 3, colour: 7, level: 1, memberCount: 1, maxMembers: 5 });
    const text = JSON.stringify(dir.body);
    for (const account of Object.values(accountsStore.accounts)) {
      expect(text).not.toContain(account.id);
      expect(text).not.toContain(account.email);
    }
    expect((await request(f.app).get("/api/conglomerates")).status).toBe(401);
  });

  it("refuses each unmet requirement with its own code and copy that says what to fix", async () => {
    const taken = uniqueName("Taken");
    const first = await founder();
    expect((await charter(first, { name: taken })).status).toBe(201);

    const cases = [
      ["already-in-conglomerate", first, {}, /Leave it before/],
      ["founder-too-young", await founder(), (f) => { f.raw.createdAt = Date.now() - DAY; }, /7 days after it was registered/],
      ["join-cooldown", await founder(), (f) => { f.raw.state.corp.joinCooldownUntil = Date.now() + DAY; }, /cannot found or join one until/],
      ["not-at-bureau", await founder(), (f) => { f.raw.state.corp.currentStationId = "mars-orbital-exchange"; }, /Earth Station Prime/],
      ["insufficient-credits", await founder(), (f) => { f.raw.state.corp.finances.credits = COST - 1; }, /costs 110,000 credits .* holds 109,999/],
      ["name-length", await founder(), { name: "x".repeat(41) }, /3 to 40 characters/],
      ["name-characters", await founder(), { name: "<b>Bold</b> Ventures" }, /letters, digits, spaces/],
      ["name-reserved", await founder(), { name: "Interstellar Settlement Authority" }, /institution/],
      ["name-taken", await founder(), { name: taken.toUpperCase() }, /already has this name/],
      ["name-taken", await founder(), { name: first.reg.body.corpName.toLowerCase() }, /already has this name/]
    ];
    const codes = new Set();
    for (const [code, f, change, copy] of cases) {
      const before = f.raw.state.corp.finances.credits;
      if (typeof change === "function") change(f);
      const res = await charter(f, { name: uniqueName("Refused"), ...(typeof change === "object" ? change : {}) });
      expect(res.body.code, code).toBe(code);
      expect(res.status, code).toBeGreaterThanOrEqual(400);
      expect(res.body.error, code).toMatch(copy);
      if (code !== "insufficient-credits") expect(f.raw.state.corp.finances.credits, code).toBe(before);
      codes.add(res.body.code);
    }
    expect(codes.size).toBe(9);
  });

  it("refuses every name on the exported reserved list", () => {
    expect(RESERVED_CONGLOMERATE_NAMES).toEqual(expect.arrayContaining(["ISA", "GEX", "GEX Commodities Authority", "ITC"]));
    for (const reserved of RESERVED_CONGLOMERATE_NAMES) {
      const { refused } = charterNameCheck(reserved);
      expect(refused?.code, reserved).toBe(reserved.length < 3 || reserved.length > 40 ? "name-length" : "name-reserved");
      expect(charterNameCheck(reserved.toUpperCase()).refused, reserved).toBeTruthy();
    }
    expect(charterNameCheck("ISA Frontier Group").refused.code).toBe("name-reserved");
    expect(charterNameCheck("EA Holdings").refused.code).toBe("name-reserved");
    expect(charterNameCheck("Visa Frontier Group").name).toBe("Visa Frontier Group");
  });

  it("refuses hostile input: an oversized name, another account's id in the URL, and an emblem off the list", async () => {
    const f = await founder();
    const other = await founder();
    expect((await charter(f, { name: "A".repeat(5000) })).status).toBe(400);
    const cross = await f.api.post(other.url).send({ name: uniqueName(), emblem: 1, colour: 1 });
    expect(cross.status).toBe(403);
    expect((await charter(f, { name: uniqueName(), emblem: C.emblems + 1 })).status).toBe(400);
    expect((await charter(f, { name: uniqueName(), colour: 0 })).status).toBe(400);
    expect(other.raw.state.corp.conglomerateId ?? null).toBeNull();
    expect(f.raw.state.corp.conglomerateId ?? null).toBeNull();
  });

  it("gives a name to one of two founders racing for it", async () => {
    const a = await founder();
    const b = await founder();
    const name = uniqueName("Race");
    const [ra, rb] = await Promise.all([charter(a, { name }), charter(b, { name: name.toLowerCase() })]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    expect([ra.body.code, rb.body.code]).toContain("name-taken");
    expect(conglomerateList().filter((c) => c.name.toLowerCase() === name.toLowerCase())).toHaveLength(1);
  });

  it("takes the fee and creates the conglomerate together: a failure part-way leaves neither", async () => {
    const f = await founder();
    const { dayBook: _book, ...before } = JSON.parse(JSON.stringify(f.raw.state.corp.finances));
    const count = conglomerateList().length;
    const name = uniqueName("Undone");
    const result = foundConglomerate(f.reg.account.id, { name, emblem: 1, colour: 1 }, Date.now(), { afterCharge: () => { throw new Error("injected"); } });
    expect(result.refused).toMatchObject({ status: 500, code: "charter-unavailable" });
    const { dayBook, ...after } = f.raw.state.corp.finances; // the day's book opens on any read; it must book nothing
    expect(after).toEqual(before);
    expect(dayBook.expenses).toEqual({});
    expect(f.raw.state.corp.conglomerateId ?? null).toBeNull();
    expect(conglomerateList()).toHaveLength(count);
    // The name the failed charter would have held is still free.
    expect((await charter(f, { name })).status).toBe(201);
  });

  it("fails closed when the fee check cannot run", async () => {
    const f = await founder();
    f.raw.state.corp.finances.credits = "not a number";
    const res = await charter(f, { name: uniqueName() });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("charter-unavailable");
    const g = await founder();
    const finances = g.raw.state.corp.finances;
    Object.defineProperty(g.raw.state.corp, "finances", { get() { throw new Error("unreadable"); }, configurable: true });
    const thrown = await charter(g, { name: uniqueName() });
    Object.defineProperty(g.raw.state.corp, "finances", { value: finances, writable: true, configurable: true, enumerable: true });
    expect(thrown.status).toBe(503);
    expect(thrown.body.code).toBe("charter-unavailable");
    expect(g.raw.state.corp.conglomerateId ?? null).toBeNull();
  });
});

describe("a corporation that has played a while keeps its state through the charter and a restart (P-FRESH-STATE-ONLY)", () => {
  const children = [];
  afterAll(() => { for (const child of children) child.kill(); });

  it("founds with leases, stock and history, and a second server on the same save sees all of it", async () => {
    const f = await founder();
    const corp = f.raw.state.corp;
    corp.miningLeases.push({ id: "lease-charter-earth", body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [] });
    corp.inventory[C.charterStationId] = { ...(corp.inventory[C.charterStationId] || {}), "silicate-ore": 420 };
    corp.tradeHistory = [...(corp.tradeHistory || []), { id: "trade-charter", item: "silicate-ore", quantity: 80, price: 12, at: Date.now() - 3 * DAY }];
    const kept = JSON.parse(JSON.stringify({ leases: corp.miningLeases, inventory: corp.inventory, trades: corp.tradeHistory }));
    const name = uniqueName("Veteran");
    const res = await charter(f, { name });
    expect(res.status).toBe(201);
    await saveAccountsNow();

    const dir = fs.mkdtempSync(path.join(process.env.ISP_TEST_DATA_ROOT, "charter-restart-"));
    for (const file of ["accounts-snapshot.json", "state.json"]) fs.copyFileSync(path.join(dataDir, file), path.join(dir, file));
    const child = spawn(process.execPath, ["server/index.js"], {
      cwd: path.resolve(import.meta.dirname, "..", ".."),
      env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", ISP_DISABLE_TICKERS: "1", ISP_DEV: "", NODE_ENV: "test", JWT_SECRET: "charter-restart-secret-0123456789abcdef" },
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
    const login = await request(url).post("/api/auth/login").send({ email: f.reg.body.email, password: f.reg.body.password });
    expect(login.status).toBe(200);
    const again = login.body.account.state.corp;
    expect(again.conglomerateId).toBe(res.body.conglomerate.id);
    expect(again.finances.credits).toBe(250_000 - COST);
    // ISP-249 (AB#945): each lease kept, with the reference it was given on first read
    expect(again.miningLeases).toEqual(kept.leases.map((l) => ({ ...l, ref: expect.stringMatching(/^LSE-\d{4}-/) })));
    expect(again.inventory).toEqual(kept.inventory);
    expect(again.tradeHistory).toEqual(kept.trades.map((t) => ({ ...t, ref: expect.stringMatching(/^RCP-\d{4}-/) })));
    const listed = await request(url).get("/api/conglomerates").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(listed.body.conglomerates.find((c) => c.id === res.body.conglomerate.id)).toMatchObject({ name, memberCount: 1 });
  }, 40_000);
});
