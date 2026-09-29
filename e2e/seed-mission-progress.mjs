// Companion to e2e/mission-progress.spec.js (AB#2484): a corporation mining Silicates on Earth, part-way through a real
// cycle (e2e/seed-running-cycle.mjs builds it through the routes), holding an accepted Silicates quota whose target is
// 300 above what is in stock at the agent's station, and offered a Nickel requisition not yet accepted. Its spec's
// server mines on its own ticker, so what remains falls as a player would see it fall.
//
// Usage: node e2e/seed-mission-progress.mjs <dataDir> <email> <password>
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [, , dataDir, email, password] = process.argv;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cycle = spawnSync(process.execPath, ["e2e/seed-running-cycle.mjs", dataDir, email, password, String(60 * 60 * 1000)], { cwd: ROOT, encoding: "utf8", env: process.env });
if (cycle.status !== 0) throw new Error(`seed-running-cycle failed: ${cycle.stdout}\n${cycle.stderr}`);
const { accountId } = JSON.parse(cycle.stdout.trim().split("\n").at(-1));

process.env.ISP_DATA_DIR = dataDir;
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";
const game = await import("../server/gameState.js");
const { materializeOffer, MISSION_TEMPLATES } = await import("../server/game/corporation.js");
const template = (id) => MISSION_TEMPLATES.find((t) => t.id === id);
let target;
game.mutateAccountState(accountId, (state) => {
  const corp = state.corp;
  const inStock = Number(corp.inventory?.["earth-station-prime"]?.Silicates || 0);
  target = inStock + 300;
  corp.activeMissions = [{ ...materializeOffer(template("ms-log-001")), quota: { resource: "Silicates", amount: target }, acceptedAt: Date.now() - 60_000 }];
  corp.contractOfferings = { missions: [{ ...materializeOffer(template("ms-log-002")), quota: { resource: "Nickel", amount: 300 } }], nextRefreshAt: Date.now() + 2 * 60 * 60 * 1000 };
});
await game.saveAccountsNow();
console.log(JSON.stringify({ accountId, target }));
