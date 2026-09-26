// Companion to e2e/cross-track-chains.spec.js (ISP-140, AB#834): a corporation at Earth Station Prime with an idle
// Refinery built through construct(), Integrated Manufacturing researched (and none of the tracks' own research), and
// one batch of the Fusion Reactor Core chain's inputs. Built with the server's own account code in a separate process
// (see seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-assembler-account.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "cross-track-e2e-fixture-secret-0123456789";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { playerBuilding } = await import("../server/playerBuildings.js");
const { construct } = await import("../server/construction.js");
const { account } = await store.createAccount({ email, password, ceoName: "Assembly QA", corpName: `Assembly QA ${Date.now() % 100000}` });
verifyEmailToken(issueVerificationToken(account.id));
store.mutateAccountState(account.id, (state) => {
  const corp = state.corp;
  corp.currentStationId = "earth-station-prime";
  corp.level = 5;
  corp.buildingSlots = 6;
  corp.finances.credits = 800_000;
  corp.unlockedTech = ["tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast", "tt-energy-routing", "tt-material-compression",
    "tt-nano-lattice", "tt-containment-physics", "tt-exotic-energy-routing", "tt-integrated-manufacturing"];
  const refinery = construct(corp, playerBuilding("refinery"), null);
  if (refinery.outcome !== "ok") throw new Error(`seeding a refinery: ${refinery.outcome}`);
  corp.inventory = { "earth-station-prime": { "Fusion Pellets": 20, "Rare-Earth Magnets": 10, "Cryogenic Coolant": 20 } };
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
