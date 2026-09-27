// Companion to e2e/construction-panel.spec.js (ISP-95, AB#785): a corporation docked at Earth Station Prime, either
// fresh (nothing researched, no lease) or at level 5 with the catalogue's research, two extractor yards built on a
// full Earth lease through the server's own construct(), and a Mars lease with room. Built with the server's own
// account code in a separate process (see seed-logistics-account.mjs for why).
//
// `ferric` (ISP-96) is level5 plus a Sol belt expedition due back 25 seconds after seeding, carrying 40 Nickel,
// 20 Titanium and 12 Silicates and mining nothing more on the way: time to build the Ferric Mining Complex first.
//
// `refinery` (ISP-97) is level5 plus a Refinery built through construct(), running the Silicates chain and due to
// finish 30 seconds after seeding: time to upgrade it to a Refinery Complex from the panel before it delivers.
//
// `cryo` (ISP-98) is level5 plus Containment Physics and a Luna lease holding one idle yard built through construct().
//
// `tier5` (ISP-312, AB#2308) is level5 with both Earth yards at tier 5 and the corporation allowed tier 6, which Level 20
// grants (AB#800): the upgrade control's tier-6 row with its price. `tier5-locked` is the same at
// maxUpgradeTier 5, what a corporation sees today.
//
// `ledger` (Bug AB#2315) is level5 plus a third yard built through construct() on the Mars lease: the first yard past the
// starting kit, so the first to pay price growth since ISP-309 (AB#2305), for e2e/ledger-categories.spec.js.
//
// Usage: node e2e/seed-construction-account.mjs <dataDir> <email> <password> <fresh|level5|ferric|refinery|cryo|tier5|tier5-locked|ledger|level10|level20|military|shipyard|shipyard-built|troops>
//
// `level10` (ISP-108, AB#800) is level5 raised to Level 10, the old top, with 150,000 Silicates mined: the Overview shows
// Level 11's requirements, which did not exist before. `level20` (ISP-109, AB#801) is the same at Level 20, the next old top,
// with 150 expeditions completed: the Overview shows Level 21's. `military` (ISP-167, AB#861) is level5 with a few of each
// unit and every research node that is not planned, for the Military Power card and the planned ship research.
const [, , dataDir, email, password, kind] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "construction-panel-e2e-fixture-secret-0123";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { PLAYER_BUILDING_CATALOGUE, playerBuilding } = await import("../server/playerBuildings.js");
const { construct } = await import("../server/construction.js");
const { account } = await store.createAccount({ email, password, ceoName: "Construction QA", corpName: `Construction QA ${Date.now() % 100000}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
store.mutateAccountState(account.id, (state) => {
  const corp = state.corp;
  corp.currentStationId = "earth-station-prime";
  if (!["level5", "ferric", "refinery", "cryo", "tier5", "tier5-locked", "ledger", "level10", "level20", "military", "shipyard", "shipyard-built", "troops"].includes(kind)) return;
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
  if (kind === "ledger") {
    const built = construct(corp, playerBuilding("basic-extractor-yard"), "lease-mars-qa");
    if (built.outcome !== "ok") throw new Error(`seeding a third yard: ${built.outcome}`);
  }
  if (kind === "level10") {
    corp.level = 10;
    corp.mining.silicateExtractors[0].totalMined = 150_000;
  }
  if (kind === "military") {
    corp.military = { ...corp.military, units: { lf: 14, ds: 2, se: 0, at: 6, dt: 10 } };
    const { RESEARCH_LIBRARY } = store;
    corp.unlockedTech = Object.values(RESEARCH_LIBRARY).filter((t) => t.status !== "planned").map((t) => t.id);
  }
  if (kind === "troops") { // ISP-172 (AB#866): a garrison already standing, and the goods to train more
    corp.military = { ...corp.military, units: { ...(corp.military?.units || {}), dt: 10 }, garrisons: { "earth-station-prime": 10 } };
    corp.inventory = { ...corp.inventory, "earth-station-prime": { ...(corp.inventory?.["earth-station-prime"] || {}), "Structural Alloys": 120, "Battery Cells": 20 } };
  }
  if (kind === "shipyard-built") { // ISP-171 (AB#865): a built shipyard and the goods for a few fighters
    corp.level = 10;
    const built = construct(corp, playerBuilding("orbital-shipyard"), null);
    if (built.outcome !== "ok") throw new Error(`seeding a shipyard: ${built.outcome}`);
    corp.inventory = { ...corp.inventory, "earth-station-prime": { ...(corp.inventory?.["earth-station-prime"] || {}), "Carbon Fibre Sheets": 100 } };
  }
  if (kind === "shipyard") corp.level = 10; // ISP-170 (AB#864): the Orbital Shipyard's level, its research from the catalogue's gates above
  if (kind === "level20") {
    corp.level = 20;
    corp.stats = { ...(corp.stats || {}), asteroidExpeditionsCompleted: 150 };
  }
  if (kind === "tier5" || kind === "tier5-locked") {
    for (const b of corp.buildings.filter((x) => x.name === "Basic Extractor Yard")) b.tier = 5;
    for (const ex of corp.mining.silicateExtractors) ex.tier = 5;
    corp.unlocks = { ...corp.unlocks, maxUpgradeTier: kind === "tier5" ? 6 : 5 };
  }
  if (kind === "cryo") {
    corp.unlockedTech = [...new Set([...corp.unlockedTech, "tt-containment-physics"])];
    corp.currentStationId = "luna-gateway"; // a Luna lease is managed from Luna Gateway's Claims & Leases
    corp.miningLeases.push(lease("lease-luna-qa", "Luna"));
    const built = construct(corp, playerBuilding("basic-extractor-yard"), "lease-luna-qa");
    if (built.outcome !== "ok") throw new Error(`seeding a Luna yard: ${built.outcome}`);
  }
  if (kind === "refinery") {
    const built = construct(corp, playerBuilding("refinery"), null);
    if (built.outcome !== "ok") throw new Error(`seeding a refinery: ${built.outcome}`);
    const due = Date.now() + 30_000;
    Object.assign(corp.refineries[0], { active: true, chainId: "silicates-chain", stationId: "earth-station-prime", startedAt: due - 4 * 3_600_000, lastTickAt: due - 4 * 3_600_000, endsAt: due, cycleScale: 1 });
    corp.inventory = { "earth-station-prime": {} };
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
