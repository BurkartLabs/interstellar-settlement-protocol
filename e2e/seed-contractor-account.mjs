// Companion to e2e/contract-agent-station.spec.js: a corporation docked at Earth Station Prime (Elara Voss's station)
// holding enough of every contract resource to fill any quota, built with the server's own account code in a
// separate process (see seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-contractor-account.mjs <dataDir> <email> <password>
import fs from "node:fs";

const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "contract-e2e-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const missions = JSON.parse(fs.readFileSync(new URL("../data/missions.json", import.meta.url), "utf8"));
const stock = Object.fromEntries([...new Set(missions.templates.map((t) => t.resource))].map((r) => [r, 100_000]));
const { account } = await store.createAccount({ email, password, ceoName: "Contract QA", corpName: `Contract QA Corp ${Date.now()}` });
store.mutateAccountState(account.id, (state) => {
  state.corp.currentStationId = "earth-station-prime";
  state.corp.inventory = { "earth-station-prime": stock };
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
