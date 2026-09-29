// server/routes/asteroids.js: the asteroids routes, split out of server/index.js (AB#1815).
import { addAccountNotification, saveAccountsNow, getAccountById, getState, mutateAccountState } from "../gameState.js";
import { beltAt, beltView, isBeltPresent, isBeltScoutedBy, recordBeltScouted } from "../game/belts.js"; // AB#2330, AB#2331
import { beltSharedWith, currentConglomerateOf } from "../game/intel.js"; // ISP-207 (AB#902)
import { roomEvent } from "../game/membership.js"; // Bug #4665: a partner's scouting reaches open pages
import { ECONOMY } from "../economy.js";
import { emptyBeltMessage } from "../expeditionText.js"; // AB#2330
import { BELT_KEYS, EXPEDITION_DURATIONS, beltComposition, EXPEDITION_LAUNCH_COST, PROBE_BUILD_COST, PROBE_FABRICATION_MS, BASE_MAX_DEPLOYMENTS, NAVIGATION } from "../gameState.js";
import { CONGLOMERATE_CATALOG } from "../conglomerates.js"; // Bug #4656: the remote launch's yield share
import { applyCredits } from "../finances.js";
import { fleetStatus } from "../gameState.js"; // Bug #586
import { deploymentCapText } from "../game/progression.js"; // Bug AB#2310
import { emitToAccount } from "../realtime.js";
import { SYSTEMS_CATALOG } from "../travel.js";
import { beltPhrase } from "../../public/scripts/displayNames.js"; // AB#1336
// ISP-94 (AB#784): buildHandler builds the Assembly Facility, as it builds every player building (server/construction.js).
import { fundingRequirementMessage, buildHandler } from "./helpers.js";
import { fabricationMsFor } from "../buildingTiers.js"; // ISP-102 (AB#794)
// AB#783: probes need an Assembly Facility, counted from data/player-buildings.json.
import { countBuilt, playerBuilding } from "../playerBuildings.js";

const ASSEMBLY = playerBuilding("assembly-facility");
import { launchExpeditionReceipt, probeFabricationReceipt, scoutBeltReceipt } from "../receipts.js"; // AB#744
import { RATS, encounterChance, forcePower, forceSupply, nominalHours, seedFor } from "../game/rats.js"; // AB#820
import { rateFactorFor } from "../hunts.js"; // ISP-284 (AB#991): a belt a hunt cleared is quiet
import { SYSTEMS_BY_ID } from "../game/catalog.js";
import { stationById } from "../game/stations.js";
import { commitHiredEscort } from "../hiredEscort.js"; // AB#4678
import { ESCORT_REFUSALS, expeditionOutlook, hiredEscortOption, ownEscortFor } from "../escorts.js"; // AB#821: one copy of the escort rules

export function registerAsteroidRoutes(app) {
  // ─── Asteroid Mining: Assembly Facility, Probes, Expeditions ─────────────────

  // ISP-94 (AB#784): POST /gameplay/build with the Assembly Facility (server/routes/construction.js).
  app.post("/api/accounts/:accountId/gameplay/build-assembly-facility", buildHandler(() => ({ buildingId: "assembly-facility" })));

  app.post("/api/accounts/:accountId/gameplay/build-mining-probe", (req, res) => {
    let outcome = "ok";
    let fabricationMs = PROBE_FABRICATION_MS; // AB#794: set from the Assembly Facility's tier below

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;

      if (!(corp.unlockedTech || []).includes("tt-asteroid-prospecting")) {
        outcome = "missing-research";
        return;
      }

      if (countBuilt(ASSEMBLY, corp) === 0) {
        outcome = "no-assembly";
        return;
      }

      if (!corp.asteroidMining) corp.asteroidMining = {};
      const am = corp.asteroidMining;
      if (typeof am.probeCount !== "number") am.probeCount = 0;
      if (!Array.isArray(am.fabricationQueue)) am.fabricationQueue = [];

      // Bug #586: the Fleet Cap the player is shown, counting every vessel they own
      const pendingCount = am.fabricationQueue.length;
      if (fleetStatus(corp).full) {
        outcome = "probe-cap";
        return;
      }

      // AB#794: the Assembly Facility's tier sets the fabrication time; while it upgrades it is offline.
      const facility = (corp.buildings || []).find((b) => b.name === ASSEMBLY.name);
      if (Number(facility?.upgradingUntil) > Date.now()) {
        outcome = "assembly-upgrading";
        return;
      }
      fabricationMs = fabricationMsFor(facility?.tier, PROBE_FABRICATION_MS);

      // Only one fabrication at a time
      if (pendingCount > 0) {
        outcome = "already-fabricating";
        return;
      }

      if ((corp.finances.credits || 0) < PROBE_BUILD_COST) {
        outcome = "insufficient-credits";
        return;
      }

      applyCredits(corp, -PROBE_BUILD_COST, "construction");

      const now = Date.now();
      am.fabricationQueue.push({
        id: `fab-${now}-${Math.random().toString(36).slice(2, 8)}`,
        type: "mining-probe",
        startedAt: now,
        completesAt: now + fabricationMs, // AB#794: the Assembly Facility's tier
        cost: PROBE_BUILD_COST
      });
    });

    if (!account) { res.status(404).json({ error: "Account not found." }); return; }

    if (outcome !== "ok") {
      const am = account.state.corp.asteroidMining || {};
      const pendingCount = (am.fabricationQueue || []).length;
      const msgs = {
        "missing-research": "Asteroid Prospecting Arrays research is required before fabricating mining probes.",
        "no-assembly": "You must construct an Assembly Facility before fabricating probes.",
        "probe-cap": (() => { const fleet = fleetStatus(account.state.corp); return `Your fleet is at its Fleet Cap (${fleet.vessels}/${fleet.cap}). ${fleet.raiseText}`; })(),
        "already-fabricating": "A probe is already being fabricated. Wait for it to complete before starting another.",
        "assembly-upgrading": "The Assembly Facility is being upgraded and is offline until it finishes.",
        "insufficient-credits": fundingRequirementMessage("Mining Probe fabrication", account.state.corp, PROBE_BUILD_COST, "Sell goods or finish an assignment to raise the credits, then fabricate it.")
      };
      res.status(400).json({ error: msgs[outcome] || "Probe fabrication failed.", code: outcome }); // ISP-254 (AB#4818)
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "infrastructure",
      protocol: { meaning: "queued", screen: "building-assembly-facility" }, // ISP-254 Bd (AB#4819)
      title: "Probe Fabrication Started",
      body: `Mining Probe fabrication has begun. Estimated completion: ${fabricationMs >= 60000 ? Math.round(fabricationMs / 60000) + " minute(s)" : Math.round(fabricationMs / 1000) + " second(s)"}.`
    });
    if (notification) emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    saveAccountsNow();
    // AB#744: the probe the mutation queued, and the fleet with it counted.
    const queued = account.state.corp.asteroidMining.fabricationQueue;
    const fleet = fleetStatus(account.state.corp);
    const receipt = probeFabricationReceipt({ cost: PROBE_BUILD_COST, completesAt: queued[queued.length - 1]?.completesAt, vessels: fleet.vessels, cap: fleet.cap });
    res.json({ ...account, receipt });
  });

  app.post("/api/accounts/:accountId/gameplay/scout-belt", (req, res) => {
    const beltKey = String(req.body?.beltKey || "").trim();
    if (!beltKey || !beltComposition(beltKey)) {
      res.status(400).json({ error: "Invalid asteroid belt identifier." });
      return;
    }

    // AB#2330: a mined-out slot has nothing to scout until a belt forms there again.
    const scoutedBelt = beltAt(getState(), beltKey);
    if (!isBeltPresent(scoutedBelt)) { res.status(400).json({ error: emptyBeltMessage(scoutedBelt) }); return; }

    let outcome = "ok";
    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;
      // Bug #1256: scouting takes the research the Starmap names and a presence in the belt's system, as
      // launch-expedition does. Without these a new corporation could read every belt's composition from Sol.
      if (!(corp.unlockedTech || []).includes("tt-asteroid-prospecting")) { outcome = "missing-research"; return; }
      if ((corp.currentSystemId || "sol") !== beltKey.split(":")[0]) { outcome = "wrong-system"; return; }
      if (!corp.asteroidMining) corp.asteroidMining = {};
      // AB#2331: scouting is of the belt there now; a key scouted in an earlier generation is scouted afresh.
      if (isBeltScoutedBy(corp.asteroidMining, scoutedBelt)) {
        outcome = "already-scouted";
        return;
      }

      recordBeltScouted(corp.asteroidMining, scoutedBelt);
    });

    if (!account) { res.status(404).json({ error: "Account not found." }); return; }
    if (outcome === "missing-research") {
      res.status(400).json({ error: "Research Asteroid Prospecting Arrays in Corporate R&D to scout asteroid belts." });
      return;
    }
    if (outcome === "wrong-system") {
      res.status(400).json({ error: "You must be in the same system as the asteroid belt to scout it. Travel there first." });
      return;
    }
    if (outcome === "already-scouted") {
      res.json(account); // Idempotent — no error, just return current state; nothing was done, so no receipt (AB#744)
      return;
    }

    // Bug #4665: the scout's partners share this belt now (ISP-207); tell their open pages to read it again. A signal
    // only: no composition, which each partner reads through its own intel-checked request.
    const scout = getAccountById(req.params.accountId)?.state?.corp;
    const conglomerate = currentConglomerateOf(scout);
    if (conglomerate) roomEvent(conglomerate, "conglomerate:intel", { kind: "belt-scouted", corp: scout.publicId, corpName: scout.corporationName, beltKey });
    res.json({ ...account, receipt: scoutBeltReceipt({ beltLabel: beltPhrase(SYSTEMS_CATALOG, beltKey) }) }); // AB#744
  });

  // AB#821 (docs/design/rats.md, section 7): the launch panel's figures for a belt and a length, before anything is
  // committed: the chance of meeting Rats, and for every fleet the caller could name (its own and those it has hired)
  // the chance with it, the chance it holds, the share of the haul kept and the provisions, or why it cannot escort.
  // Read only; the figures are launchOutlook's, the functions the tick resolves encounters with.
  app.get("/api/accounts/:accountId/gameplay/expedition-outlook", (req, res) => {
    const account = getAccountById(req.params.accountId);
    if (!account) { res.status(404).json({ error: "Account not found." }); return; }
    const beltKey = String(req.query?.beltKey || "").trim();
    const duration = String(req.query?.duration || "standard").trim();
    if (!beltKey || !beltComposition(beltKey)) { res.status(400).json({ error: "Invalid asteroid belt identifier." }); return; }
    if (!EXPEDITION_DURATIONS[duration]) { res.status(400).json({ error: "Invalid expedition duration. Choose: short, standard, or extended." }); return; }
    const outlook = expeditionOutlook(account.state.corp, beltKey, duration);
    if (!outlook) { res.status(400).json({ error: "The ISA has no reading of that system's pirate activity." }); return; }
    res.json(outlook);
  });

  app.post("/api/accounts/:accountId/gameplay/launch-expedition", (req, res) => {
    const beltKey = String(req.body?.beltKey || "").trim();
    const duration = String(req.body?.duration || "standard").trim();
    // AB#820: an optional escort, one of the caller's own fleets by id; the input check has refused any other shape
    const escortFleetId = req.body?.escortFleetId === undefined || req.body?.escortFleetId === null ? null : String(req.body.escortFleetId);
    // AB#4678: or a hired fleet, by its contract; one escort, not both
    const escortContractId = req.body?.escortContractId === undefined || req.body?.escortContractId === null ? null : String(req.body.escortContractId);
    if (escortFleetId !== null && escortContractId !== null) {
      res.status(400).json({ error: "Choose one escort: one of your fleets or one you have hired, not both." });
      return;
    }

    if (!beltKey || !beltComposition(beltKey)) {
      res.status(400).json({ error: "Invalid asteroid belt identifier." });
      return;
    }

    if (!EXPEDITION_DURATIONS[duration]) {
      res.status(400).json({ error: "Invalid expedition duration. Choose: short, standard, or extended." });
      return;
    }

    // AB#2330: a mined-out slot is refused before anything is spent; an expedition mines the belt's generation it left for.
    const belt = beltAt(getState(), beltKey);
    if (!isBeltPresent(belt)) { res.status(400).json({ error: emptyBeltMessage(belt) }); return; }

    let outcome = "ok";
    let launchCost = EXPEDITION_LAUNCH_COST;
    let provisions = 0;
    let rats = null;
    let hiredEscort = null; // AB#4678: committed on its owner's books once the launch has gone through

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;

      if (!(corp.unlockedTech || []).includes("tt-asteroid-prospecting")) {
        outcome = "missing-research";
        return;
      }

      if (!corp.asteroidMining) corp.asteroidMining = {};
      const am = corp.asteroidMining;
      if (typeof am.probeCount !== "number") am.probeCount = 0;
      if (typeof am.maxDeployments !== "number") am.maxDeployments = BASE_MAX_DEPLOYMENTS;
      if (!Array.isArray(am.activeExpeditions)) am.activeExpeditions = [];

      // AB#2331: this generation, not the key alone. ISP-207 (AB#902): or a current conglomerate partner scouted it.
      let sharedBy = [];
      if (!isBeltScoutedBy(am, belt)) {
        sharedBy = beltSharedWith(corp, belt);
        if (!sharedBy.length) { outcome = "not-scouted"; return; }
      }

      if (am.probeCount <= 0) {
        outcome = "no-probes";
        return;
      }

      if (am.activeExpeditions.length >= am.maxDeployments) {
        outcome = "deployment-cap";
        return;
      }

      // Player must be in the same system as the belt. Bug #4656: or, for a belt a conglomerate partner scouted this
      // generation, anywhere its research reaches: the probe works at range and brings home remoteDispatchYieldPct of
      // what it mines. This is what makes shared intel worth something; scouting it yourself needs you there.
      const beltSystemId = beltKey.split(":")[0];
      const here = corp.currentSystemId || "sol";
      let remote = false;
      if (here !== beltSystemId) {
        if (!sharedBy.length) { outcome = "wrong-system"; return; }
        if (!NAVIGATION.canReachSystem(corp.unlockedTech || [], here, beltSystemId)) { outcome = "out-of-reach"; return; }
        remote = true;
      }

      // AB#820 (docs/design/rats.md): the belt's danger, and the escort that goes with the probe. Fails closed: a belt
      // whose system has no pirate density, or a seed that cannot be made, launches nothing.
      const density = Number(SYSTEMS_BY_ID.get(beltSystemId)?.pirateDensity);
      if (!Number.isFinite(density) || density < 0) { outcome = "no-danger-reading"; return; }
      const hours = nominalHours(duration);
      let escort = null;
      if (escortFleetId !== null) { // AB#821: the rules in server/escorts.js, which the launch panel shows too
        const pick = ownEscortFor(corp, escortFleetId, beltSystemId, Date.now());
        if (pick.outcome) { outcome = pick.outcome; return; }
        escort = corp.military.fleets.find((f) => f.id === pick.escort.fleetId);
      }
      if (escortContractId !== null) { // AB#4678 (section 3): a hired fleet whose contract allows pve or raids
        const pick = hiredEscortOption(corp, escortContractId, beltSystemId, Date.now());
        if (pick.outcome) { outcome = pick.outcome; return; }
        hiredEscort = pick.escort;
      }
      const escortUnits = hiredEscort ? { ...hiredEscort.units } : escort ? Object.fromEntries(Object.entries(escort.units || {}).filter(([, n]) => Number(n) > 0)) : null;
      const escortPower = escortUnits ? forcePower(escortUnits) : 0;
      provisions = escortUnits ? Math.round(RATS.escortCostPerSupplyHour * forceSupply(escortUnits) * hours) : 0;
      try { seedFor("probe"); } catch { outcome = "no-seed"; return; }

      if ((corp.finances.credits || 0) < launchCost + provisions) {
        outcome = "insufficient-credits";
        return;
      }

      applyCredits(corp, -launchCost, "expeditions");
      if (provisions) applyCredits(corp, -provisions, "expeditions"); // AB#820: the escort's provisions, a sink
      // AB#991: a belt a hunt cleared is quiet for everyone; the rate is fixed at launch, so the plan drawn each tick is the same
      const rateFactor = rateFactorFor(beltKey);
      rats = {
        density, hours, escortFleetId: escort?.id ?? hiredEscort?.fleetId ?? null, escortUnits, escortPower, rateFactor,
        ...(hiredEscort ? { escortContractId: hiredEscort.contractId, escortOwnerCorpId: hiredEscort.ownerCorpId } : {}), // AB#4678
        chance: encounterChance(density, hours, escortPower, rateFactor), chanceUnescorted: encounterChance(density, hours, 0, rateFactor),
        provisions, encounters: []
      };
      am.probeCount -= 1;

      const now = Date.now();
      const durationMs = EXPEDITION_DURATIONS[duration].ms;

      am.activeExpeditions.push({
        id: `exp-${now}-${Math.random().toString(36).slice(2, 8)}`,
        beltKey,
        systemId: beltSystemId,
        duration,
        deployedAt: now,
        completesAt: now + durationMs,
        lastTickAt: now,
        generation: belt.generation, // AB#2330
        ...(sharedBy.length ? { sharedIntel: true } : {}), // ISP-207 (AB#902): sent on a partner's scouting, so its use can be counted
        ...(remote ? { remote: true, remoteYieldPct: CONGLOMERATE_CATALOG.remoteDispatchYieldPct } : {}), // Bug #4656
        launchCost,
        yields: {},
        rats, // AB#820: the belt's danger and the escort; each encounter is added when it happens
        status: "active"
      });
      if (escort) escort.escort = { expeditionId: am.activeExpeditions.at(-1).id, since: now }; // committed until it comes home
      if (hiredEscort) hiredEscort.expeditionId = am.activeExpeditions.at(-1).id;
    });
    // AB#4678: the hired fleet is committed on its owner's books, as a raid commits one
    if (outcome === "ok" && hiredEscort?.expeditionId) commitHiredEscort(hiredEscort, hiredEscort.expeditionId);

    if (!account) { res.status(404).json({ error: "Account not found." }); return; }

    if (outcome !== "ok") {
      const am = account.state.corp.asteroidMining || {};
      const msgs = {
        "missing-research": "Asteroid Prospecting Arrays research must be completed before launching expeditions.",
        "not-scouted": "This asteroid belt has not been scouted. Scout the belt first to reveal its composition before launching an expedition.",
        "out-of-reach": "Your research does not reach that system yet, so a probe cannot be launched to it from here.", // Bug #4656
        "no-probes": "No mining probes available. Fabricate probes at your Assembly Facility.",
        "deployment-cap": deploymentCapText(account.state.corp), // Bug AB#2310: no research raises this; a level does
        "wrong-system": "You must be in the same system as the asteroid belt to launch an expedition.",
        "insufficient-credits": fundingRequirementMessage(provisions ? "Expedition launch with its escort's provisions" : "Expedition launch", account.state.corp, launchCost + provisions),
        ...ESCORT_REFUSALS, // AB#820, AB#4678: the escort's refusals, one copy (server/escorts.js)
        "no-danger-reading": "The ISA has no reading of that system's pirate activity, so no expedition can be launched there.",
        "no-seed": "The Mineral Survey Office cannot plan an expedition just now; nothing was launched or charged."
      };
      res.status(400).json({ error: msgs[outcome] || "Expedition launch failed." });
      return;
    }

    const durationLabel = EXPEDITION_DURATIONS[duration]?.label || duration;
    const notification = addAccountNotification(req.params.accountId, {
      type: "mining",
      protocol: { meaning: "active", screen: "expedition-panel" }, // ISP-254 Bd (AB#4819)
      title: "Expedition Launched",
      body: `Mining probe deployed to ${beltPhrase(SYSTEMS_CATALOG, beltKey)} on a ${durationLabel} mission. Resources will be deposited upon return.` // AB#1336
    });
    if (notification) emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    saveAccountsNow();
    // AB#744: the expedition the mutation launched, the newest of its belt.
    const am = account.state.corp.asteroidMining;
    const launched = [...(am.activeExpeditions || [])].reverse().find((e) => e.beltKey === beltKey);
    const receipt = launchExpeditionReceipt({
      beltLabel: beltPhrase(SYSTEMS_CATALOG, beltKey),
      durationLabel,
      cost: launched?.launchCost ?? launchCost,
      completesAt: launched?.completesAt,
      probesLeft: am.probeCount,
      rats: launched?.rats ?? null // AB#820: the chance of meeting Rats, and the escort
    });
    res.json({ ...account, receipt });
  });

  // Provide belt compositions to the client (only scouted belts return data)
  app.get("/api/accounts/:accountId/gameplay/belt-compositions", (req, res) => {
    const account = getAccountById(req.params.accountId);
    if (!account) { res.status(404).json({ error: "Account not found." }); return; }

    // AB#2331: every slot as this corporation may see it (server/game/belts.js beltView): whether a belt is there, its
    // generation and next draw, and for a belt it scouted, this generation's rarity, composition and reserve.
    // `compositions` is the scouted ones' compositions, as before.
    const am = account.state?.corp?.asteroidMining || {};
    const belts = {};
    const result = {};
    for (const key of BELT_KEYS) {
      const belt = beltAt(getState(), key);
      // ISP-207 (AB#902): a partner's scouting shows too; getAccountById's copy is read, the roster checked now.
      const view = beltView(belt, am, belt && !isBeltScoutedBy(am, belt) ? beltSharedWith(account.state.corp, belt) : []);
      if (!view) continue;
      belts[key] = view;
      if (view.scouted) result[key] = view.composition;
    }
    res.json({ compositions: result, belts, respawnChancePerHour: ECONOMY.belts.respawnChancePerHour, allBeltKeys: BELT_KEYS, remoteDispatchYieldPct: CONGLOMERATE_CATALOG.remoteDispatchYieldPct }); // Bug #4656
  });
}
