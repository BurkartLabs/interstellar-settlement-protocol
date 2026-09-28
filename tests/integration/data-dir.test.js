import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, verifyEmailOnServer } from "../helpers/api.js";
import { saveAccountsNow, dataDir } from "../../server/gameState.js";

// Bug #578: the server is one long-lived process that keeps what it writes in ISP_DATA_DIR (Decision #591: a mounted
// Azure Files share). Bug #1153: a graceful stop writes it all before exiting.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const children = [];
afterAll(() => { for (const child of children) child.kill(); });

/** Start `node server/index.js` on `dir` and resolve with its URL once it listens. */
function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: repo,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", ISP_DISABLE_TICKERS: "1", ISP_DEV: "1", NODE_ENV: "test", JWT_SECRET: "data-dir-test-secret-0123456789abcdef" },
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

describe("the data directory (Bug #578)", () => {
  it("is ISP_DATA_DIR, and the server writes nothing to data/ in the code", () => {
    expect(dataDir).toBe(path.resolve(process.env.ISP_DATA_DIR));
    expect(dataDir).not.toBe(path.join(repo, "data"));
    expect(fs.existsSync(path.join(dataDir, "state.json"))).toBe(true);
  });

  it("saveAccountsNow writes the accounts and the world at once, not on a timer (Bug #1153)", async () => {
    const { app } = await getApp();
    const { body } = await registerAccount(app);
    const snapshot = path.join(dataDir, "accounts-snapshot.json");
    fs.rmSync(snapshot, { force: true });
    fs.rmSync(path.join(dataDir, "state.json"), { force: true });
    await saveAccountsNow();
    expect(fs.readFileSync(snapshot, "utf8")).toContain(body.email);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "state.json"), "utf8"))).toHaveProperty("market");
  });

  it("a second server process on the same directory logs the account in: it survives a restart", async () => {
    const dir = fs.mkdtempSync(path.join(process.env.ISP_TEST_DATA_ROOT, "restart-"));
    const first = await startServer(dir);
    const account = { email: `restart-${Date.now()}@example.com`, password: "supersecret123", ceoName: "Restart CEO", corpName: `Restart Corp ${Date.now() % 100000}` };
    expect((await request(first.url).post("/api/auth/register").send(account)).status).toBe(201);
    await verifyEmailOnServer(first.url, account.email); // AB#2288: a new account logs in once verified
    // The debounced snapshot write takes 500 ms; wait for it rather than relying on a signal Windows cannot deliver.
    const snapshot = path.join(dir, "accounts-snapshot.json");
    for (let i = 0; i < 40 && !(fs.existsSync(snapshot) && fs.readFileSync(snapshot, "utf8").includes('"emailVerifiedAt"')); i++) await new Promise((r) => setTimeout(r, 100));
    first.child.kill();
    const second = await startServer(dir);
    const login = await request(second.url).post("/api/auth/login").send({ email: account.email, password: account.password });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();
    expect(fs.readdirSync(dir).sort()).toEqual(["accounts-snapshot.json", "references-salt", "state.json"]); // ISP-249 (AB#945): the references' secret
  }, 60000);
});

describe("no serverless mode is left (Bug #578)", () => {
  it("server/, public/ and package.json name no Vercel, serverless switch or Supabase", () => {
    const files = [path.join(repo, "package.json")];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(js|html|css|json)$/.test(entry.name)) files.push(full);
      }
    };
    walk(path.join(repo, "server"));
    walk(path.join(repo, "public"));
    const hits = files.filter((f) => /vercel|IS_SERVERLESS|supabase/i.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(repo, f));
    expect(hits).toEqual([]);
    expect(fs.existsSync(path.join(repo, "vercel.json"))).toBe(false);
  });
});
