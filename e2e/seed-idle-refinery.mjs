// Companion to e2e/refinery-start.spec.js (ISP-131, AB#825): a corporation with an idle Refinery built through
// construct(), the Silicates and Nickel chains' research, and 1,800 Silicates and 240 Nickel at Earth Station Prime.
// Built with the server's own account code in a separate process (see seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-idle-refinery.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "refinery-start-e2e-fixture-secret-0123456";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { playerBuilding } = await import("../server/playerBuildings.js");
const { construct } = await import("../server/construction.js");
const { account } = await store.createAccount({ email, password, ceoName: "Refinery QA", corpName: `Refinery QA ${Date.now() % 100000}` });
verifyEmailToken(issueVerificationToken(account.id));
store.mutateAccountState(account.id, (state) => {
  const corp = state.corp;
  corp.currentStationId = "earth-station-prime";
  corp.level = 5;
  corp.buildingSlots = 6;
  corp.finances.credits = 800_000;
  corp.unlockedTech = ["tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast", "tt-energy-routing", "tt-material-compression", "tt-nano-lattice"];
  const refinery = construct(corp, playerBuilding("refinery"), null);
  if (refinery.outcome !== "ok") throw new Error(`seeding a refinery: ${refinery.outcome}`);
  corp.inventory = { "earth-station-prime": { Silicates: 1800, Nickel: 240 } };
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
