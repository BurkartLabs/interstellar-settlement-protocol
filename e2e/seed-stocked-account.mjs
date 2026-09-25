// Companion to e2e/listing-refusal-in-row.spec.js: a corporation docked at Earth Station Prime holding six goods
// there, so Create Listing draws six rows and its last row is far from its first. Built with the server's own account
// code in a separate process (see seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-stocked-account.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "listing-refusal-e2e-fixture-secret-012345";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { account } = await store.createAccount({ email, password, ceoName: "Stock QA", corpName: `Stock QA Corp ${Date.now()}` });
store.mutateAccountState(account.id, (state) => {
  state.corp.currentStationId = "earth-station-prime";
  state.corp.inventory = {
    "earth-station-prime": { Silicates: 40, "Helium-3": 12, Nickel: 30, Titanium: 25, Carbon: 60, "Rare Earths": 8 }
  };
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
