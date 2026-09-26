import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed, verifyEmailOnServer } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { DAY_MS, utcDayStart } from "../../server/finances.js";

// AB#713: GET /api/accounts/:accountId/finances/statements serves the owner's closed days, and they are kept with the
// rest of the corporation in the data directory.
const yesterday = () => utcDayStart(Date.now()) - DAY_MS;

async function corpWithYesterday() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  // A book left open yesterday: the next read closes it.
  mutateAccountState(account.id, (state) => {
    state.corp.finances.credits = 90_000;
    state.corp.finances.dayBook = { dayStart: yesterday(), opening: 100_000, income: { missions: 2_000 }, expenses: { hiring: 12_000 } };
  });
  return { app, id: account.id, api: authed(app, accessToken), token: accessToken };
}

describe("GET /finances/statements (AB#713)", () => {
  it("closes the missed day on read and returns it, newest first, with today's open book", async () => {
    const { id, api } = await corpWithYesterday();
    const res = await api.get(`/api/accounts/${id}/finances/statements`);
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(90);
    expect(res.body.statements).toHaveLength(1);
    const [s] = res.body.statements;
    expect(s.day).toBe(new Date(yesterday()).toISOString().slice(0, 10));
    expect(s.pnl).toMatchObject({ income: { missions: 2_000 }, expenses: { hiring: 12_000 }, net: -10_000 });
    expect(s.cashFlow).toEqual({ opening: 100_000, inflows: 2_000, outflows: 12_000, closing: 90_000, unrecorded: 0 });
    expect(res.body.today).toMatchObject({ dayStart: utcDayStart(Date.now()), opening: 90_000 });
  });

  it("only the owner reads them: no token is 401, another corporation's token is 403", async () => {
    const { app, id } = await corpWithYesterday();
    expect((await request(app).get(`/api/accounts/${id}/finances/statements`)).status).toBe(401);
    const other = await registerAccount(app);
    const res = await authed(app, other.accessToken).get(`/api/accounts/${id}/finances/statements`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("hiring");
  });

  it("?days= is clamped to 1..90, and anything that is not a number is refused", async () => {
    const { id, api } = await corpWithYesterday();
    const days = async (q) => (await api.get(`/api/accounts/${id}/finances/statements?days=${q}`));
    expect((await days("500")).body.days).toBe(90);
    expect((await days("0")).body.days).toBe(1);
    expect((await days("-3")).body.days).toBe(1);
    expect((await days("2.7")).body.days).toBe(2);
    expect((await days("1")).body.statements).toHaveLength(1);
    for (const bad of ["abc", "NaN", "Infinity", "", "1e999"]) {
      const res = await days(bad);
      expect(res.status, bad).toBe(400);
      expect(res.body.error).toMatch(/1 to 90/);
    }
  });

  it("the statements stay off the account payload, so they do not ride on every response", async () => {
    const { id, api } = await corpWithYesterday();
    await api.get(`/api/accounts/${id}/finances/statements`);
    const account = await api.get(`/api/accounts/${id}`);
    expect(account.status).toBe(200);
    expect(account.body.state).not.toHaveProperty("statements");
    expect(getAccountById(id).state).not.toHaveProperty("statements");
  });
});

// Survives a restart: the statements are written with the accounts to ISP_DATA_DIR, like data-dir.test.js checks.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const children = [];
afterAll(() => { for (const child of children) child.kill(); });

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: repo,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", ISP_DISABLE_TICKERS: "1", ISP_DEV: "1", NODE_ENV: "test", JWT_SECRET: "statements-test-secret-0123456789abcdef" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20000);
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

/** AB#2288: registration no longer answers with the account, so its id is read from the saved snapshot. */
const idIn = (snapshot, email) => {
  const saved = JSON.parse(fs.readFileSync(snapshot, "utf8"));
  return Object.values(saved.accounts || saved).find((a) => a?.email === email)?.id;
};
const waitFor = async (check) => { for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 100)); };

describe("statements survive a restart (AB#713)", () => {
  it("a day closed by one server process is read back unchanged by the next", async () => {
    const dir = fs.mkdtempSync(path.join(process.env.ISP_TEST_DATA_ROOT, "statements-"));
    const snapshot = path.join(dir, "accounts-snapshot.json");
    const who = { email: `statements-${Date.now()}@example.com`, password: "supersecret123", ceoName: "Ledger CEO", corpName: `Ledger Corp ${Date.now() % 100000}` };

    const first = await startServer(dir);
    const reg = await request(first.url).post("/api/auth/register").send(who);
    expect(reg.status).toBe(201);
    await verifyEmailOnServer(first.url, who.email); // AB#2288: a new account logs in once verified
    await waitFor(() => fs.existsSync(snapshot) && fs.readFileSync(snapshot, "utf8").includes('"emailVerifiedAt"'));
    const id = idIn(snapshot, who.email);
    first.child.kill();

    // While it was stopped a day went by with a book open: the fake clock is a book dated yesterday.
    const saved = JSON.parse(fs.readFileSync(snapshot, "utf8"));
    const account = Object.values(saved.accounts || saved).find((a) => a?.id === id);
    account.state.corp.finances.credits = 70_000;
    account.state.corp.finances.dayBook = { dayStart: yesterday(), opening: 75_000, income: {}, expenses: { research: 5_000 } };
    fs.writeFileSync(snapshot, JSON.stringify(saved));

    const login = async (url) => (await request(url).post("/api/auth/login").send({ email: who.email, password: who.password })).body.accessToken;
    const second = await startServer(dir);
    const read = async (url, token) => request(url).get(`/api/accounts/${id}/finances/statements`).set("Authorization", `Bearer ${token}`);
    const closed = await read(second.url, await login(second.url));
    expect(closed.status).toBe(200);
    expect(closed.body.statements.map((s) => s.cashFlow)).toEqual([{ opening: 75_000, inflows: 0, outflows: 5_000, closing: 70_000, unrecorded: 0 }]);
    // Bug #1480: the day is filed in the corporation's own statements file, never in the accounts snapshot.
    const file = path.join(dir, "statements", `${encodeURIComponent(id)}.json`);
    await waitFor(() => fs.existsSync(file));
    expect(JSON.parse(fs.readFileSync(file, "utf8")).map((s) => s.cashFlow.closing)).toEqual([70_000]);
    await waitFor(() => fs.readFileSync(snapshot, "utf8").includes('"dayStart"'));
    expect(fs.readFileSync(snapshot, "utf8")).not.toContain('"statements"');
    second.child.kill();

    const third = await startServer(dir);
    const again = await read(third.url, await login(third.url));
    expect(again.body.statements).toEqual(closed.body.statements);
  }, 90000);

  it("statements an older save kept in the snapshot move to their own file on load (Bug #1480)", async () => {
    const dir = fs.mkdtempSync(path.join(process.env.ISP_TEST_DATA_ROOT, "statements-migrate-"));
    const snapshot = path.join(dir, "accounts-snapshot.json");
    const who = { email: `migrate-${Date.now()}@example.com`, password: "supersecret123", ceoName: "Old Save", corpName: `Old Save ${Date.now() % 100000}` };
    const first = await startServer(dir);
    expect((await request(first.url).post("/api/auth/register").send(who)).status).toBe(201);
    await verifyEmailOnServer(first.url, who.email); // AB#2288
    await waitFor(() => fs.existsSync(snapshot) && fs.readFileSync(snapshot, "utf8").includes('"emailVerifiedAt"'));
    const id = idIn(snapshot, who.email);
    first.child.kill();

    // The first version of AB#713 kept statements inside the account.
    const saved = JSON.parse(fs.readFileSync(snapshot, "utf8"));
    const account = Object.values(saved.accounts || saved).find((a) => a?.id === id);
    const old = [{ day: "2026-09-01", dayStart: Date.UTC(2026, 8, 1), pnl: { income: {}, expenses: {}, totalIncome: 0, totalExpenses: 0, net: 0 },
      cashFlow: { opening: 1, inflows: 0, outflows: 0, closing: 1, unrecorded: 0 }, balanceSheet: { credits: 1, facilities: 0, inventory: 0, liabilities: 0, totalAssets: 1, netWorth: 1 } }];
    account.state.statements = old;
    fs.writeFileSync(snapshot, JSON.stringify(saved));

    const second = await startServer(dir);
    const token = (await request(second.url).post("/api/auth/login").send({ email: who.email, password: who.password })).body.accessToken;
    const res = await request(second.url).get(`/api/accounts/${id}/finances/statements`).set("Authorization", `Bearer ${token}`);
    expect(res.body.statements).toEqual(old);
    await waitFor(() => !fs.readFileSync(snapshot, "utf8").includes('"statements"'));
    expect(fs.readFileSync(snapshot, "utf8")).not.toContain('"statements"');
    expect(JSON.parse(fs.readFileSync(path.join(dir, "statements", `${encodeURIComponent(id)}.json`), "utf8"))).toEqual(old);
    second.child.kill();
  }, 90000);
});
