// Companion to scripts/look-tier4-screens.mjs (ISP-191, AB#885): a corporation at Earth Station Prime with a Refinery and
// a Synthesis Array built through construct(), the research for Antimatter (and Field Emitters) but not for the other
// Tier 4 chains, and one batch of Antimatter's inputs, so the Refinery Chains tab shows a Tier 4 chain it can start and
// several it cannot. Built with the server's own account code in a separate process (see seed-logistics-account.mjs).
//
// Usage: node e2e/seed-synthesis-account.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "synthesis-look-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { playerBuilding } = await import("../server/playerBuildings.js");
const { construct } = await import("../server/construction.js");
const { account } = await store.createAccount({ email, password, ceoName: "Synthesis QA", corpName: `Synthesis QA ${Date.now() % 100000}` });
verifyEmailToken(issueVerificationToken(account.id));
store.mutateAccountState(account.id, (state) => {
  const corp = state.corp;
  corp.currentStationId = "earth-station-prime";
  corp.level = 20;
  corp.buildingSlots = 8;
  corp.finances.credits = 2_000_000;
  corp.unlockedTech = ["tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast", "tt-energy-routing", "tt-material-compression",
    "tt-nano-lattice", "tt-containment-physics", "tt-exotic-energy-routing", "tt-fusion-fuel-cycle", "tt-integrated-manufacturing",
    "tt-high-energy-synthesis", "tt-frontier-cartography", "tt-exotic-containment", "tt-antimatter-confinement"];
  for (const id of ["refinery", "synthesis-array"]) {
    const built = construct(corp, playerBuilding(id), null);
    if (built.outcome !== "ok") throw new Error(`seeding ${id}: ${built.outcome}`);
  }
  corp.inventory = { "earth-station-prime": { "Exotic Matter": 5, "Fusion Pellets": 20 } };
});
store.markWalkthroughCompleted(account.id);

// A second corporation, `noarray-<email>`: a Refinery and the same research but no Synthesis Array, so its Tier 4 cards
// name the building they need.
const second = await store.createAccount({ email: `noarray-${email}`, password, ceoName: "No Array QA", corpName: `No Array QA ${Date.now() % 100000}` });
verifyEmailToken(issueVerificationToken(second.account.id));
store.mutateAccountState(second.account.id, (state) => {
  const corp = state.corp;
  corp.currentStationId = "earth-station-prime";
  corp.level = 20;
  corp.buildingSlots = 8;
  corp.finances.credits = 2_000_000;
  corp.unlockedTech = ["tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast", "tt-energy-routing", "tt-material-compression",
    "tt-nano-lattice", "tt-containment-physics", "tt-exotic-energy-routing", "tt-fusion-fuel-cycle", "tt-integrated-manufacturing"];
  const built = construct(corp, playerBuilding("refinery"), null);
  if (built.outcome !== "ok") throw new Error(`seeding a refinery: ${built.outcome}`);
});
store.markWalkthroughCompleted(second.account.id);
await store.saveAccountsNow();
