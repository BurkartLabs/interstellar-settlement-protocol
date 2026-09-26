import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState, saveAccountsNow, dataDir } from "../../server/gameState.js";

// ISP-100 (AB#792): every built building gets an id from the server, whatever route built it, and saves from before
// ids get them once on load. The restart below uses a second and third server process on a copy of this file's save,
// the data-dir.test.js pattern (Bug #578).
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const children = [];
afterAll(() => { for (const child of children) child.kill(); });

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: repo,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", ISP_DISABLE_TICKERS: "1", ISP_DEV: "", NODE_ENV: "test", JWT_SECRET: "building-ids-test-secret-0123456789abcdef" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 30000);
    const read = (chunk) => {
      out += chunk;
      const port = out.match(/listening on port (\d+)/)?.[1];
      if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}

/** A corporation with one lease holding two extractor yards, built through the real route. */
async function twoYards() {
  const { app } = await getApp();
  const registered = await registerAccount(app);
  const { account, accessToken } = registered;
  const play = (p, body = {}) => authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/${p}`).send(body);
  expect((await play("rent-office", { stationId: "earth-station-prime", durationDays: 7 })).status).toBe(200);
  expect((await play("hire", { count: 5 })).status).toBe(200);
  expect((await play("purchase-lease", { body: "earth" })).status).toBe(200);
  mutateAccountState(account.id, (s) => { s.corp.miningLeases[0].buildingSlots = 2; s.corp.buildingSlots = 5; });
  const leaseId = getAccountById(account.id).state.corp.miningLeases[0].id;
  expect((await play(`lease/${leaseId}/build-extractor`)).status).toBe(200);
  expect((await play(`lease/${leaseId}/build-extractor`)).status).toBe(200);
  return { ...registered, leaseId };
}

describe("building ids (AB#792)", () => {
  it("a new corporation's Headquarters has one", async () => {
    const { app } = await getApp();
    const { account } = await registerAccount(app);
    const [hq] = getAccountById(account.id).state.corp.buildings;
    expect(hq.name).toBe("Headquarters");
    expect(hq.id).toMatch(/^bld-/);
  });

  it("two yards built on one lease get two distinct ids, each linked from its own extractor", async () => {
    const { account, leaseId } = await twoYards();
    const corp = getAccountById(account.id).state.corp;
    const yards = corp.buildings.filter((b) => b.name === "Basic Extractor Yard");
    expect(yards).toHaveLength(2);
    expect(yards[0].id).toMatch(/^bld-/);
    expect(yards[1].id).toMatch(/^bld-/);
    expect(yards[0].id).not.toBe(yards[1].id);
    expect(corp.mining.silicateExtractors.map((e) => e.buildingId)).toEqual(yards.map((y) => y.id));
    expect(corp.mining.silicateExtractors.map((e) => e.leaseId)).toEqual([leaseId, leaseId]);
  });

  it("a save from before ids gets them once on load, keeps them on the next load, and the links survive", async () => {
    const { account, body } = await twoYards();
    await saveAccountsNow();
    const dir = fs.mkdtempSync(path.join(process.env.ISP_TEST_DATA_ROOT, "building-ids-"));
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "accounts-snapshot.json"), "utf8"));
    // Make it an old save: no ids anywhere, for every corporation in it.
    for (const a of Object.values(saved.accounts)) {
      for (const b of a.state?.corp?.buildings || []) delete b.id;
      for (const e of a.state?.corp?.mining?.silicateExtractors || []) delete e.buildingId;
    }
    const snapshot = path.join(dir, "accounts-snapshot.json");
    fs.writeFileSync(snapshot, JSON.stringify(saved));
    const corpIn = () => JSON.parse(fs.readFileSync(snapshot, "utf8")).accounts[account.id].state.corp;

    const first = await startServer(dir);
    // The load schedules a save (debounced 500 ms); wait for it to land rather than assuming it did.
    for (let i = 0; i < 60 && !corpIn().buildings.every((b) => b.id); i++) await new Promise((r) => setTimeout(r, 100));
    const migrated = corpIn();
    expect(migrated.buildings.every((b) => /^bld-/.test(b.id))).toBe(true);
    const yards = migrated.buildings.filter((b) => b.name === "Basic Extractor Yard");
    expect(migrated.mining.silicateExtractors.map((e) => e.buildingId)).toEqual(yards.map((y) => y.id));
    first.child.kill();

    const second = await startServer(dir);
    const login = await request(second.url).post("/api/auth/login").send({ email: body.email, password: body.password });
    expect(login.status).toBe(200);
    const read = await request(second.url).get(`/api/accounts/${account.id}`).set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(read.status).toBe(200);
    expect(read.body.state.corp.buildings.map((b) => b.id)).toEqual(migrated.buildings.map((b) => b.id));
    expect(corpIn().buildings.map((b) => b.id)).toEqual(migrated.buildings.map((b) => b.id));
  }, 90000);
});
