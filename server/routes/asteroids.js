// server/routes/asteroids.js: the asteroids routes, split out of server/index.js (AB#1815).
import { ECONOMY } from "../economy.js";
import { addAccountNotification, saveAccountsNow, getAccountById, mutateAccountState } from "../gameState.js";
import { BELT_COMPOSITIONS, EXPEDITION_DURATIONS, EXPEDITION_LAUNCH_COST, PROBE_BUILD_COST, PROBE_FABRICATION_MS, BASE_MAX_DEPLOYMENTS } from "../gameState.js";
import { applyCredits } from "../finances.js";
import { fleetStatus } from "../gameState.js"; // Bug #586
import { emitToAccount } from "../realtime.js";
import { SYSTEMS_CATALOG } from "../travel.js";
import { beltPhrase } from "../../public/scripts/displayNames.js"; // AB#1336
import { corpSlotsFull, fundingRequirementMessage } from "./helpers.js";
import { buildAssemblyReceipt, launchExpeditionReceipt, probeFabricationReceipt, scoutBeltReceipt } from "../receipts.js"; // AB#744

export function registerAsteroidRoutes(app) {
  // ─── Asteroid Mining: Assembly Facility, Probes, Expeditions ─────────────────

  app.post("/api/accounts/:accountId/gameplay/build-assembly-facility", (req, res) => {
    const BUILD_COST = ECONOMY.buildings.assemblyFacilityCost;
    const ASSET_VALUE = ECONOMY.buildings.assemblyFacilityAssetValue;
    let outcome = "ok";

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;

      if (!(corp.unlockedTech || []).includes("tt-assembly-fabrication")) {
        outcome = "missing-research";
        return;
      }

      const hasOne = (corp.buildings || []).some((b) => b.name === "Assembly Facility");
      if (hasOne) {
        outcome = "already-built";
        return;
      }

      if ((corp.buildings || []).length >= (corp.buildingSlots || 2)) {
        outcome = "no-slot";
        return;
      }

      if ((corp.finances.credits || 0) < BUILD_COST) {
        outcome = "insufficient-credits";
        return;
      }

      if (!Array.isArray(corp.buildings)) corp.buildings = [];
      corp.buildings.push({ name: "Assembly Facility", tier: 1, status: "Operational" });
      applyCredits(corp, -BUILD_COST, "construction");
      corp.finances.assets = (corp.finances.assets || 0) + ASSET_VALUE;
    });

    if (!account) { res.status(404).json({ error: "Account not found." }); return; }

    if (outcome !== "ok") {
      const msgs = {
        "missing-research": "Assembly & Fabrication Systems research is required before constructing an Assembly Facility.",
        "already-built": "Your corporation already operates an Assembly Facility.",
        "no-slot": `An Assembly Facility needs a free building slot. ${corpSlotsFull(account.state.corp)}`,
        "insufficient-credits": fundingRequirementMessage("Assembly Facility construction", account.state.corp, BUILD_COST)
      };
      res.status(400).json({ error: msgs[outcome] || "Build failed." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "infrastructure",
      title: "Assembly Facility Online",
      body: "Your Assembly Facility is now operational. You may begin fabricating units."
    });
    if (notification) emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    saveAccountsNow();
    // AB#744: a construction purchase like the refinery, so it is confirmed the same way.
    const built = account.state.corp;
    const receipt = buildAssemblyReceipt({ cost: BUILD_COST, assetValue: ASSET_VALUE, slotsUsed: (built.buildings || []).length, slotsTotal: built.buildingSlots || 2 });
    res.json({ ...account, receipt });
  });

  app.post("/api/accounts/:accountId/gameplay/build-mining-probe", (req, res) => {
    let outcome = "ok";

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;

      if (!(corp.unlockedTech || []).includes("tt-asteroid-prospecting")) {
        outcome = "missing-research";
        return;
      }

      const hasAssembly = (corp.buildings || []).some((b) => b.name === "Assembly Facility");
      if (!hasAssembly) {
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
        completesAt: now + PROBE_FABRICATION_MS,
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
        "insufficient-credits": fundingRequirementMessage("Mining Probe fabrication", account.state.corp, PROBE_BUILD_COST)
      };
      res.status(400).json({ error: msgs[outcome] || "Probe fabrication failed." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "infrastructure",
      title: "Probe Fabrication Started",
      body: `Mining Probe fabrication has begun. Estimated completion: ${PROBE_FABRICATION_MS >= 60000 ? Math.round(PROBE_FABRICATION_MS / 60000) + " minute(s)" : Math.round(PROBE_FABRICATION_MS / 1000) + " second(s)"}.`
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
    if (!beltKey || !BELT_COMPOSITIONS[beltKey]) {
      res.status(400).json({ error: "Invalid asteroid belt identifier." });
      return;
    }

    let outcome = "ok";
    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;
      // Bug #1256: scouting takes the research the Starmap names and a presence in the belt's system, as
      // launch-expedition does. Without these a new corporation could read every belt's composition from Sol.
      if (!(corp.unlockedTech || []).includes("tt-asteroid-prospecting")) { outcome = "missing-research"; return; }
      if ((corp.currentSystemId || "sol") !== beltKey.split(":")[0]) { outcome = "wrong-system"; return; }
      if (!corp.asteroidMining) corp.asteroidMining = {};
      if (!Array.isArray(corp.asteroidMining.scoutedBelts)) corp.asteroidMining.scoutedBelts = [];

      if (corp.asteroidMining.scoutedBelts.includes(beltKey)) {
        outcome = "already-scouted";
        return;
      }

      corp.asteroidMining.scoutedBelts.push(beltKey);
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

    res.json({ ...account, receipt: scoutBeltReceipt({ beltLabel: beltPhrase(SYSTEMS_CATALOG, beltKey) }) }); // AB#744
  });

  app.post("/api/accounts/:accountId/gameplay/launch-expedition", (req, res) => {
    const beltKey = String(req.body?.beltKey || "").trim();
    const duration = String(req.body?.duration || "standard").trim();

    if (!beltKey || !BELT_COMPOSITIONS[beltKey]) {
      res.status(400).json({ error: "Invalid asteroid belt identifier." });
      return;
    }

    if (!EXPEDITION_DURATIONS[duration]) {
      res.status(400).json({ error: "Invalid expedition duration. Choose: short, standard, or extended." });
      return;
    }

    let outcome = "ok";
    let launchCost = EXPEDITION_LAUNCH_COST;

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

      if (!Array.isArray(am.scoutedBelts)) am.scoutedBelts = [];
      if (!am.scoutedBelts.includes(beltKey)) {
        outcome = "not-scouted";
        return;
      }

      if (am.probeCount <= 0) {
        outcome = "no-probes";
        return;
      }

      if (am.activeExpeditions.length >= am.maxDeployments) {
        outcome = "deployment-cap";
        return;
      }

      // Player must be in the same system as the belt
      const beltSystemId = beltKey.split(":")[0];
      if ((corp.currentSystemId || "sol") !== beltSystemId) {
        outcome = "wrong-system";
        return;
      }

      if ((corp.finances.credits || 0) < launchCost) {
        outcome = "insufficient-credits";
        return;
      }

      applyCredits(corp, -launchCost, "expeditions");
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
        launchCost,
        yields: {},
        status: "active"
      });
    });

    if (!account) { res.status(404).json({ error: "Account not found." }); return; }

    if (outcome !== "ok") {
      const am = account.state.corp.asteroidMining || {};
      const msgs = {
        "missing-research": "Asteroid Prospecting Arrays research must be completed before launching expeditions.",
        "not-scouted": "This asteroid belt has not been scouted. Scout the belt first to reveal its composition before launching an expedition.",
        "no-probes": "No mining probes available. Fabricate probes at your Assembly Facility.",
        "deployment-cap": `All deployment slots are occupied (${am.activeExpeditions?.length || 0}/${am.maxDeployments || BASE_MAX_DEPLOYMENTS}). Wait for a probe to return or research additional capacity.`,
        "wrong-system": "You must be in the same system as the asteroid belt to launch an expedition.",
        "insufficient-credits": fundingRequirementMessage("Expedition launch", account.state.corp, launchCost)
      };
      res.status(400).json({ error: msgs[outcome] || "Expedition launch failed." });
      return;
    }

    const durationLabel = EXPEDITION_DURATIONS[duration]?.label || duration;
    const notification = addAccountNotification(req.params.accountId, {
      type: "mining",
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
      probesLeft: am.probeCount
    });
    res.json({ ...account, receipt });
  });

  // Provide belt compositions to the client (only scouted belts return data)
  app.get("/api/accounts/:accountId/gameplay/belt-compositions", (req, res) => {
    const account = getAccountById(req.params.accountId);
    if (!account) { res.status(404).json({ error: "Account not found." }); return; }

    const scouted = account.state?.corp?.asteroidMining?.scoutedBelts || [];
    const result = {};
    for (const key of scouted) {
      if (BELT_COMPOSITIONS[key]) {
        result[key] = BELT_COMPOSITIONS[key];
      }
    }
    res.json({ compositions: result, allBeltKeys: Object.keys(BELT_COMPOSITIONS) });
  });
}
