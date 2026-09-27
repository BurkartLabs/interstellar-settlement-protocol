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
// Usage: node e2e/seed-construction-account.mjs <dataDir> <email> <password> <fresh|level5|ferric|refinery|cryo|tier5|tier5-locked|ledger|level10|level20|military|shipyard|shipyard-built|troops|unpaid|fleet-tab|mercs|cg-station|cg-station-closed|cg-station-member>
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
  if (!["level5", "ferric", "refinery", "cryo", "tier5", "tier5-locked", "ledger", "level10", "level20", "military", "shipyard", "shipyard-built", "troops", "unpaid", "fleet-tab", "mercs", "cg-station", "cg-station-closed", "cg-station-member"].includes(kind)) return;
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
  if (kind === "fleet-tab") { // ISP-175 (AB#869): two fleets, one in transit, and something in each production queue
    const now = Date.now();
    corp.level = 10;
    corp.unlockedTech = [...new Set([...corp.unlockedTech, "tt-fleet-coordination", "tt-capital-hulls"])];
    const built = construct(corp, playerBuilding("orbital-shipyard"), null);
    if (built.outcome !== "ok") throw new Error(`seeding a shipyard: ${built.outcome}`);
    corp.military = {
      units: { lf: 20, ds: 4, se: 0, at: 10, dt: 6 }, readiness: 85, garrisons: { "earth-station-prime": 6 },
      fleets: [
        { id: "flt-e2e-aegis", name: "Aegis", units: { lf: 8, ds: 2, se: 0, at: 4 }, stationId: "earth-station-prime", transit: null, formedAt: now },
        { id: "flt-e2e-talon", name: "Talon", units: { lf: 6, ds: 0, se: 0, at: 0 }, stationId: null, formedAt: now,
          transit: { fromStationId: "earth-station-prime", toStationId: "mars-orbital-dock", toSystemId: "sol", departedAt: now, arrivesAt: now + 45 * 60_000 } }
      ]
    };
    corp.shipyard = { queue: [{ id: "ship-e2e-1", unitId: "lf", quantity: 3, stationId: "earth-station-prime", credits: 3450, goods: { "Carbon Fibre Sheets": 30 }, queuedAt: now, startsAt: now, completesAt: now + 90 * 60_000 }] };
    corp.training = { queue: [{ id: "troop-e2e-1", unitId: "at", quantity: 2, stationId: "earth-station-prime", credits: 1400, goods: { "Battery Cells": 4 }, queuedAt: now, startsAt: now, completesAt: now + 40 * 60_000 }] };
    corp.inventory = { ...corp.inventory, "earth-station-prime": { ...(corp.inventory?.["earth-station-prime"] || {}), "Carbon Fibre Sheets": 60, "Battery Cells": 10 } };
  }
  if (kind === "mercs") { // ISP-177 (AB#871): a fleet of the player's own to offer; the other corporation is seeded below
    corp.military = {
      units: { lf: 12, ds: 3, se: 0, at: 4, dt: 6 }, readiness: 100, garrisons: { "earth-station-prime": 6 },
      fleets: [{ id: "flt-e2e-aegis", name: "Aegis", units: { lf: 8, ds: 2, se: 0, at: 2 }, stationId: "earth-station-prime", transit: null, formedAt: Date.now() }]
    };
  }
  if (kind === "unpaid") { // ISP-173 (AB#867): a fleet whose upkeep has gone unpaid for three days
    corp.military = { ...corp.military, units: { ...(corp.military?.units || {}), lf: 14, ds: 2, dt: 10 }, readiness: 70, upkeep: { paidThrough: Date.now(), remainder: 0, short: true } };
    corp.finances.credits = 0;
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
if (kind === "mercs") { // ISP-177 (AB#871): another corporation offers three fleets, and the player has hired one of them
  const { offerFleet, hireOffer } = await import("../server/mercenaries.js");
  const { formFleet } = await import("../server/fleets.js");
  const seller = (await store.createAccount({ email: `vega-${Date.now()}@example.test`, password, ceoName: "Ines Vega", corpName: `Vega Freight Syndicate ${Date.now() % 1000}` })).account;
  const fleetIds = [];
  store.mutateAccountState(seller.id, (state) => {
    state.corp.currentStationId = "earth-station-prime";
    state.corp.military = { units: { lf: 30, ds: 6, se: 2, at: 8 } };
    for (const [name, units] of [["Corsair", { lf: 12, ds: 2 }], ["Halberd", { ds: 4, se: 2, at: 6 }], ["Lancer", { lf: 10, at: 2 }]]) {
      const formed = formFleet(state.corp, { units, name });
      if (formed.outcome !== "ok") throw new Error(`seeding a fleet: ${formed.outcome}`);
      fleetIds.push(formed.fleet.id);
    }
  }, { sanitize: false, settleMining: false });
  const terms = [
    { termHours: 24, price: 6_500, collateral: 12_000, allowedUse: "defense" },
    { termHours: 72, price: 24_000, collateral: 30_000, allowedUse: "raids" },
    { termHours: 168, price: 18_000, collateral: 10_000, allowedUse: "pve" }
  ];
  const offers = fleetIds.map((id, i) => {
    const made = offerFleet(seller.id, id, terms[i]);
    if (!made.ok) throw new Error(`seeding an offer: ${made.error}`);
    return made.offer;
  });
  const hired = hireOffer(account.id, offers[2].id);
  if (!hired.ok) throw new Error(`seeding a hire: ${hired.error}`);
}
// ISP-211 (AB#906): cg-station-closed is the same station built by another corporation, whose stake voted it members-only;
// the player is an outsider docked at Earth.
if (kind === "cg-station" || kind === "cg-station-closed" || kind === "cg-station-member") { // ISP-210 (AB#905): Venus Platform, built through the real project
  const { accountsStore } = await import("../server/game/store.js");
  const { conglomerateList, foundConglomerate } = await import("../server/game/conglomerates.js");
  const { CONGLOMERATE_CATALOG: C } = await import("../server/conglomerates.js");
  const { billOfMaterials, contributeToStationProject, settleStationProject, startStationProject } = await import("../server/game/stationProjects.js");
  const builderId = kind !== "cg-station-closed" ? account.id
    : (await store.createAccount({ email: `venus-${Date.now()}@example.test`, password, ceoName: "Iris Venn", corpName: `Venus Holdings ${Date.now() % 1000}` })).account.id;
  const raw = accountsStore.accounts[builderId];
  if (!raw.state.corp.miningLeases?.length) raw.state.corp.miningLeases = [{ id: "lease-venus-builder", body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [], issuedAt: Date.now() }];
  const bom = billOfMaterials();
  raw.createdAt = Date.now() - (C.minFounderAgeDays + 1) * 86_400_000;
  raw.state.corp.currentStationId = C.charterStationId;
  raw.state.corp.finances.credits = bom.credits + 500_000;
  const founded = foundConglomerate(builderId, { name: "Venus Builders Guild", emblem: 2, colour: 3 });
  if (founded.refused) throw new Error(`seeding a conglomerate: ${founded.refused.error}`);
  const c = conglomerateList().find((x) => x.id === founded.conglomerate.id);
  c.level = C.stationMinLevel; // the level a station project needs; the ladder is ISP-202's to test
  const inv = ((raw.state.corp.inventory ||= {})[C.homeStationId] ||= {});
  for (const [item, n] of Object.entries(bom.goods)) inv[item] = (inv[item] || 0) + n;
  const started = startStationProject(builderId, c.id, { systemId: "sol", body: "Venus", suffix: 3 }); // a lease on Earth puts Sol in reach
  if (started.refused) throw new Error(`seeding a station project: ${started.refused.error}`);
  for (const body of [{ source: "own", credits: bom.credits }, ...Object.entries(bom.goods).map(([item, quantity]) => ({ source: "own", item, quantity }))]) {
    const given = contributeToStationProject(builderId, c.id, body);
    if (given.refused) throw new Error(`seeding a contribution: ${given.refused.error}`);
  }
  settleStationProject(c, c.stationProject.completesAt);
  if (!c.station) throw new Error("seeding a station: the project did not complete");
  if (kind === "cg-station-member") { // ISP-212 (AB#907): docked at its own station, with goods at Earth to bring over
    raw.state.corp.currentStationId = c.station.id;
    const earth = (raw.state.corp.inventory["earth-station-prime"] ||= {});
    earth.Silicates = (earth.Silicates || 0) + 600;
  }
  if (kind === "cg-station-closed") {
    const { proposeStationSetting } = await import("../server/game/stationGovernance.js");
    const vote = proposeStationSetting(builderId, c.id, { setting: "access", value: "members" }); // its whole stake: passes at once
    if (vote.refused || vote.proposal.state !== "passed") throw new Error(`seeding the access vote: ${vote.refused?.error || vote.proposal.state}`);
  }
}
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
