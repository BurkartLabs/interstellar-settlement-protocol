// Companion to e2e/industry-screens.spec.js (ISP-79, AB#768): a corporation at level 5 with something in every state
// the Industry screens draw. Research done, running, queued, open and locked; a CEO program done and one running; a
// Refinery built through construct() and mid-run; an office and an expired one; an Earth lease with two yards; goods
// at three stations; a shipment in transit and one held; two transfers in the history. Built with the server's own
// account code in a separate process (see seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-industry-account.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "industry-screens-e2e-fixture-secret-012345";
process.env.NODE_ENV = "test";

const HOUR = 3_600_000;
const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { playerBuilding } = await import("../server/playerBuildings.js");
const { construct } = await import("../server/construction.js");
const { account } = await store.createAccount({ email, password, ceoName: "Industry QA", corpName: `Industry QA ${Date.now() % 100000}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
store.mutateAccountState(account.id, (state) => {
  const corp = state.corp;
  const now = Date.now();
  corp.currentStationId = "earth-station-prime";
  corp.level = 5;
  corp.buildingSlots = 6;
  corp.finances.credits = 800_000;
  corp.unlockedTech = ["tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast", "tt-energy-routing", "tt-material-compression", "tt-nano-lattice"];
  const running = { id: "rnd-qa-1", techId: "tt-fleet-coordination", name: "Fleet Coordination Matrix", effect: "+1 fleet capacity", durationHours: 16, startedAt: now - 4 * HOUR, costCredits: 42_000 };
  state.queues.corporateRnD = [
    running,
    { id: "rnd-qa-2", techId: "tt-containment-physics", name: "Containment Physics", effect: "Unlocks cryogenic storage", durationHours: 10, startedAt: running.startedAt + 16 * HOUR, costCredits: 30_000 }
  ];
  corp.completedInsights = ["ceo-negotiation-fundamentals"];
  state.queues.ceoInsight = [{ id: "ceo-qa-1", programId: "ceo-isa-regulatory-navigation", name: "ISA Regulatory Navigation", effect: "Cheaper office renewals", durationHours: 6, startedAt: now - 2 * HOUR, costCredits: 18_000 }];
  corp.offices = [
    { stationId: "earth-station-prime", name: "Earth Station Prime", rentedAt: now - HOUR, rentedUntil: now + 28 * 24 * HOUR, durationDays: 28 },
    { stationId: "mars-orbital-dock", name: "Mars Orbital Dock", rentedAt: now - 40 * 24 * HOUR, rentedUntil: now - 12 * 24 * HOUR, durationDays: 28 }
  ];
  corp.miningLeases = [{ id: "lease-earth-qa", body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [], issuedAt: now }];
  for (let i = 0; i < 2; i += 1) {
    const built = construct(corp, playerBuilding("basic-extractor-yard"), "lease-earth-qa");
    if (built.outcome !== "ok") throw new Error(`seeding a yard: ${built.outcome}`);
  }
  const refinery = construct(corp, playerBuilding("refinery"), null);
  if (refinery.outcome !== "ok") throw new Error(`seeding a refinery: ${refinery.outcome}`);
  Object.assign(corp.refineries[0], { active: true, chainId: "silicates-chain", stationId: "earth-station-prime", startedAt: now - HOUR, lastTickAt: now - HOUR, endsAt: now + 3 * HOUR, cycleScale: 1 });
  corp.inventory = {
    "earth-station-prime": { Silicates: 1800, Nickel: 240 },
    "mars-orbital-dock": { Silicates: 600, Titanium: 120 },
    "luna-gateway": { "Water Ice": 90 }
  };
  corp.shipments = [
    { id: "shp-qa-1", fromStationId: "mars-orbital-dock", toStationId: "earth-station-prime", lines: [{ item: "Titanium", quantity: 40 }], fee: 520, dispatchedAt: now - 5 * 60_000, arrivesAt: now + 40 * 60_000, status: "in-transit" },
    { id: "shp-qa-2", fromStationId: "luna-gateway", toStationId: "earth-station-prime", lines: [{ item: "Water Ice", quantity: 30 }], fee: 90, dispatchedAt: now - 3 * HOUR, arrivesAt: now - HOUR, status: "held" }
  ];
  corp.logisticsHistory = [
    { time: now - 6 * HOUR, from: "mars-orbital-dock", to: "earth-station-prime", lines: [{ item: "Silicates", quantity: 300 }], fee: 3900 },
    { time: now - 26 * HOUR, from: "luna-gateway", to: "earth-station-prime", lines: [{ item: "Nickel", quantity: 120 }, { item: "Water Ice", quantity: 60 }], fee: 540 }
  ];
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
