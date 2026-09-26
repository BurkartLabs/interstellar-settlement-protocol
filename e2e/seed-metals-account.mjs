// Companion to e2e/nickel-iron-track.spec.js (ISP-137, AB#831): a corporation docked at Mars Orbital Dock with a Mars
// lease, an idle Refinery built through construct(), Ferrous Metallurgy researched, and 300 Iron Ore, 100 Nickel and
// 160 Nickel-Iron Alloy at the Dock. Built with the server's own account code in a separate process (see
// seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-metals-account.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "nickel-iron-e2e-fixture-secret-0123456789";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { playerBuilding } = await import("../server/playerBuildings.js");
const { construct } = await import("../server/construction.js");
const { account } = await store.createAccount({ email, password, ceoName: "Metals QA", corpName: `Metals QA ${Date.now() % 100000}` });
verifyEmailToken(issueVerificationToken(account.id));
store.mutateAccountState(account.id, (state) => {
  const corp = state.corp;
  corp.currentStationId = "mars-orbital-dock";
  corp.level = 5;
  corp.buildingSlots = 6;
  corp.finances.credits = 800_000;
  corp.unlockedTech = ["tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast", "tt-energy-routing", "tt-material-compression", "tt-nano-lattice", "tt-ferrous-metallurgy"];
  corp.offices = [{ stationId: "mars-orbital-dock", name: "Mars Orbital Dock", rentedAt: Date.now(), rentedUntil: Date.now() + 28 * 86_400_000, durationDays: 28 }];
  corp.miningLeases = [{ id: "lease-mars-qa", body: "Mars", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [], issuedAt: Date.now() }];
  const refinery = construct(corp, playerBuilding("refinery"), null);
  if (refinery.outcome !== "ok") throw new Error(`seeding a refinery: ${refinery.outcome}`);
  corp.inventory = { "mars-orbital-dock": { "Iron Ore": 300, Nickel: 100, "Nickel-Iron Alloy": 160 } };
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
