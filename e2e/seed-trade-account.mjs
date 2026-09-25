// Companion to e2e/trade-history-cancelled.spec.js: one corporation docked at Earth Station Prime holding Silicates
// there, built with the server's own account-creation code in a separate process (see seed-logistics-account.mjs for
// why it cannot be an in-process import).
//
// Usage: node e2e/seed-trade-account.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "trade-e2e-fixture-secret-0123456789abcdef";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { account } = await store.createAccount({ email, password, ceoName: "Trade QA", corpName: `Trade QA Corp ${Date.now()}` });
store.mutateAccountState(account.id, (state) => {
  state.corp.currentStationId = "earth-station-prime";
  state.corp.inventory = { "earth-station-prime": { Silicates: 40 } };
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
