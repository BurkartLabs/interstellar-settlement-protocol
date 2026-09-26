// Companion to e2e/cycle-accumulation.spec.js (AB#746): a corporation with one extractor part-way into a real mining
// cycle. The cycle is built through the game's own routes (office, staff, a lease on Earth, an extractor, a 4-hour
// cycle), exactly as a player builds one; then, with the server stopped, the cycle's clock is moved back by the given
// offset with nothing mined or charged for it, and that time is settled here by the game's own mining code, so "an
// hour in" is what an hour of real mining produces, not a number typed here.
//
// AB#2289: settled here, with the breakdown roll pinned, rather than left to the spec's server. That server settled the
// whole offset in one roll, so about one run in six drew a breakdown and showed an hour of mining as 0 t. Breakdowns are
// the game working, and applyMiningOperations.test.js covers them; this fixture is "an hour of mining", and a
// breakdown is not part of it. The spec's server then settles only the seconds since.
//
// Usage: node e2e/seed-running-cycle.mjs <dataDir> <email> <password> <offsetMs>
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [, , dataDir, email, password, offsetArg] = process.argv;
const offsetMs = Number(offsetArg);
if (!dataDir || !email || !password || !(offsetMs >= 0)) throw new Error("usage: seed-running-cycle.mjs <dataDir> <email> <password> <offsetMs>");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = process.env.JWT_SECRET || "cycle-e2e-fixture-secret-0123456789abcdef";

function startServer() {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: ROOT,
    env: { ...process.env, ISP_DATA_DIR: dataDir, PORT: "0", NODE_ENV: "test", ISP_DEV: "1", ISP_DISABLE_TICKERS: "1", JWT_SECRET: SECRET },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out.slice(-500)}`)), 30_000);
    const read = (chunk) => {
      out += chunk;
      const port = out.match(/listening on port (\d+)/)?.[1];
      if (port) { clearTimeout(timer); resolve({ child, port: Number(port) }); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out.slice(-500)}`)); });
  });
}

async function api(port, method, url, body, token) {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (res.status >= 400) throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

const { child, port } = await startServer();
let id;
try {
  await api(port, "POST", "/api/auth/register", { email, password, ceoName: "Cycle QA", corpName: `Cycle QA Corp ${Date.now()}` });
  // AB#2288: registering gives no session: follow the verification link from the server's outbox, then log in.
  const outbox = await api(port, "GET", "/api/dev/outbox");
  const token = outbox.messages.filter((m) => m.to === email.toLowerCase()).at(-1)?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
  await api(port, "POST", "/api/auth/verify-email", { token });
  const reg = await api(port, "POST", "/api/auth/login", { email, password });
  id = reg.account.id;
  const a = (route, body) => api(port, "POST", `/api/accounts/${id}/${route}`, body, reg.accessToken);
  await a("walkthrough-complete");
  await a("gameplay/rent-office", { stationId: "earth-station-prime", durationDays: 28 });
  await a("gameplay/hire", { count: 5 });
  const leased = await a("gameplay/purchase-lease", { body: "earth" });
  const lease = leased.state.corp.miningLeases.at(-1);
  const built = await a(`gameplay/lease/${lease.id}/build-extractor`, {});
  const extractorId = built.state.corp.miningLeases.find((l) => l.id === lease.id).extractorIds.at(-1);
  await a(`gameplay/lease/${lease.id}/start-mining`, { amount: 120, hours: 4, extractorId });
  await new Promise((r) => setTimeout(r, 1500)); // the debounced snapshot write
} finally {
  await new Promise((r) => { child.once("exit", r); child.kill(); });
}

// Move the running cycle's clock back: it started `offsetMs` ago and has settled nothing since.
const snapFile = path.join(dataDir, "accounts-snapshot.json");
const saved = JSON.parse(fs.readFileSync(snapFile, "utf8"));
const store = saved.accounts ? saved : { accounts: saved };
const ex = store.accounts[id].state.corp.mining.silicateExtractors.find((e) => e.active);
if (!ex) throw new Error("no running extractor after start-mining");
for (const key of ["startedAt", "lastTickAt", "endsAt"]) ex[key] -= offsetMs;
fs.writeFileSync(snapFile, JSON.stringify(store));

// Settle the offset with the game's own code, as a server reading the account would, with no breakdown drawn (AB#2289).
process.env.ISP_DATA_DIR = dataDir;
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";
process.env.JWT_SECRET = SECRET;
const realRandom = Math.random;
Math.random = () => 0.999;
const game = await import("../server/gameState.js");
const settled = game.getAccountById(id).state.corp.mining.silicateExtractors.find((e) => e.id === ex.id);
Math.random = realRandom;
if (settled.downtimeActive) throw new Error("the seeded span drew a breakdown despite the pinned roll");
await game.saveAccountsNow();
console.log(JSON.stringify({ accountId: id, extractorId: ex.id, startedAt: ex.startedAt, endsAt: ex.endsAt, minedThisCycle: settled.minedThisCycle }));
