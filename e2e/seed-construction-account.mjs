// Companion to e2e/construction-panel.spec.js (ISP-95, AB#785): a corporation docked at Earth Station Prime, either
// fresh (nothing researched, no lease) or at level 5 with the catalogue's research, two extractor yards built on a
// full Earth lease through the server's own construct(), and a Mars lease with room. Built with the server's own
// account code in a separate process (see seed-logistics-account.mjs for why).
//
// `ferric` (ISP-96) is level5 plus a Sol belt expedition due back 25 seconds after seeding, carrying 40 Nickel,
// 20 Titanium and 12 Silicates and mining nothing more on the way: time to build the Ferric Mining Complex first.
//
// Usage: node e2e/seed-construction-account.mjs <dataDir> <email> <password> <fresh|level5|ferric>
const [, , dataDir, email, password, kind] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "construction-panel-e2e-fixture-secret-0123";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { PLAYER_BUILDING_CATALOGUE, playerBuilding } = await import("../server/playerBuildings.js");
const { construct } = await import("../server/construction.js");
const { account } = await store.createAccount({ email, password, ceoName: "Construction QA", corpName: `Construction QA ${Date.now() % 100000}` });
store.mutateAccountState(account.id, (state) => {
  const corp = state.corp;
  corp.currentStationId = "earth-station-prime";
  if (kind !== "level5" && kind !== "ferric") return;
  const lease = (id, body) => ({ id, body, leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [], issuedAt: Date.now() });
  corp.level = 5;
  corp.buildingSlots = 6;
  corp.finances.credits = 600_000;
  corp.unlockedTech = [...new Set([...(corp.unlockedTech || []), ...PLAYER_BUILDING_CATALOGUE.flatMap((b) => b.researchGates)])];
  corp.miningLeases = [lease("lease-earth-qa", "Earth"), lease("lease-mars-qa", "Mars")];
  for (let i = 0; i < 2; i += 1) {
    const built = construct(corp, playerBuilding("basic-extractor-yard"), "lease-earth-qa");
    if (built.outcome !== "ok") throw new Error(`seeding a yard: ${built.outcome}`);
  }
  if (kind === "ferric") {
    const due = Date.now() + 25_000;
    corp.asteroidMining = {
      ...(corp.asteroidMining || {}),
      probeCount: 0,
      activeExpeditions: [{ id: "exp-e2e-ferric", beltKey: "sol:belt", systemId: "sol", duration: "short", status: "active",
        deployedAt: due - 120_000, lastTickAt: due, completesAt: due, yields: { Nickel: 40, Titanium: 20, Silicates: 12 } }]
    };
  }
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
