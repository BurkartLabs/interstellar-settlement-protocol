// server/routes/mining.js: the mining routes, split out of server/index.js (AB#1815).
import { bodyNumber } from "../bodyNumber.js";
import { buildCostFor, operationCostPerHourFor, startupCostFor, yardUpkeepPerHourFor } from "../economy.js";
import { addAccountNotification, mutateAccountState } from "../gameState.js";
import { startExtractorCycle, stopExtractorCycle } from "../gameState.js"; // AB#575, AB#1052
import { applyCredits } from "../finances.js";
// Bug #1058: refusals that say what to do next. Imported beside their first use, away from the import block.
import { miningCreditsAdvice } from "../nextStep.js";
import { leaseSlotsFullMessage } from "../../public/scripts/slotAdvice.js";
import { emitToAccount } from "../realtime.js";
import { unleasedFor, corpSlotsFull, fundingRequirementMessage, activeOfficeAt } from "./helpers.js";
// AB#743: what each committing action did, from the values its mutation used, for the confirmation modal.
import { buildExtractorReceipt, startMiningReceipt } from "../receipts.js";
// AB#783: the Basic Extractor Yard's cost, asset value, research and cap come from data/player-buildings.json.
import { catalogueRefusal, playerBuilding } from "../playerBuildings.js";
import { RESEARCH_LIBRARY } from "../game/catalog.js";

const YARD = playerBuilding("basic-extractor-yard");

export function registerMiningRoutes(app) {
  // ─── Lease-scoped: Build an extractor yard on a specific lease ──────────────
  app.post("/api/accounts/:accountId/gameplay/lease/:leaseId/build-extractor", (req, res) => {
    const { leaseId } = req.params;
    const BASE_BUILD_COST = YARD.cost;
    const ASSET_VALUE = YARD.assetValue;
    let outcome = "ok";
    let slotInfo = "";
    let built = null;

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;
      const hasSupplyForecast = (corp.unlockedTech || []).includes("tt-supply-forecast");
      const buildCost = buildCostFor(BASE_BUILD_COST, hasSupplyForecast);

      if (!Array.isArray(corp.miningLeases)) corp.miningLeases = [];
      const lease = corp.miningLeases.find((l) => l.id === leaseId);
      if (!lease) {
        outcome = "no-lease";
        return;
      }

      // The yard has no research gate or cap today; one added to the catalogue is enforced here.
      const refused = catalogueRefusal(YARD, corp);
      if (refused) {
        outcome = refused;
        return;
      }

      if (!Array.isArray(lease.extractorIds)) lease.extractorIds = [];
      if (lease.extractorIds.length >= lease.buildingSlots) {
        outcome = "lease-slots-full";
        slotInfo = `${lease.extractorIds.length}/${lease.buildingSlots}`;
        return;
      }

      if ((corp.buildings || []).length >= (corp.buildingSlots || 2)) {
        outcome = "no-corp-slot";
        slotInfo = `${corp.buildings.length}/${corp.buildingSlots}`;
        return;
      }

      if ((corp.finances.credits || 0) < buildCost) {
        outcome = "insufficient-credits";
        return;
      }

      if (!Array.isArray(corp.buildings)) corp.buildings = [];
      if (!corp.mining || typeof corp.mining !== "object") corp.mining = {};
      if (!Array.isArray(corp.mining.silicateExtractors)) corp.mining.silicateExtractors = [];

      const nextIndex = corp.mining.silicateExtractors.length + 1;
      const newExtractorId = `ext-basic-${nextIndex}`;

      corp.buildings.push({ name: "Basic Extractor Yard", tier: 1, status: "Operational" }); // the catalogue name; a test holds them equal
      corp.mining.silicateExtractors.push({
        id: newExtractorId,
        name: `${YARD.name} #${nextIndex}`,
        tier: 1,
        active: false,
        startedAt: null,
        lastTickAt: null,
        endsAt: null,
        throughputPerHour: 0,
        operationCostPerHour: 0,
        totalMined: 0,
        totalSpent: 0,
        lastCompletedAt: null,
        leaseId,
        // Record the lease body directly on the yard so the location survives
        // any future leaseId namespacing or reference loss.
        body: lease?.body || null
      });

      lease.extractorIds.push(newExtractorId);
      applyCredits(corp, -buildCost, "construction");
      built = { extractorName: `${YARD.name} #${nextIndex}`, body: lease?.body || null, cost: buildCost, assetValue: ASSET_VALUE };
      corp.finances.assets = (corp.finances.assets || 0) + ASSET_VALUE;
    });

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    if (outcome !== "ok") {
      const corp = account.state.corp;
      const messageMap = {
        "no-lease": "The specified lease could not be found on your account.",
        "missing-research": `${YARD.name} construction requires ${YARD.researchGates.map((id) => RESEARCH_LIBRARY[id]?.name || id).join(" and ")} research.`,
        "at-cap": `You already operate the maximum of ${YARD.cap.perCorporation} of the ${YARD.name}.`,
        "lease-slots-full": leaseSlotsFullMessage(corp, (corp.miningLeases || []).find((l) => l.id === leaseId), unleasedFor(corp)),
        "no-corp-slot": corpSlotsFull(corp),
        "insufficient-credits": fundingRequirementMessage("Basic Extractor Yard construction", corp, BASE_BUILD_COST)
      };
      res.status(400).json({ error: messageMap[outcome] || "Build action failed." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "infrastructure",
      title: "Extractor Commissioned",
      body: "Basic Extractor Yard is now operational and linked to your mining lease."
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    res.json({ ...account, receipt: buildExtractorReceipt(built) });
  });

  // ─── Lease-scoped: Start a mining cycle on a lease extractor ───────────────
  app.post("/api/accounts/:accountId/gameplay/lease/:leaseId/start-mining", (req, res) => {
    const { leaseId } = req.params;
    let neededStartup = 0; // Bug #1058: the start-up cost, for the refusal
    const amount = bodyNumber(req.body?.amount, { fallback: 40, min: 10 });
    const requestedHours = bodyNumber(req.body?.hours, { fallback: 24, min: 1, max: 72 });
    let started = null; // AB#743
    const requestedExtractorId = String(req.body?.extractorId || "").trim();
    let outcome = "ok";
    let targetExtractorLabel = "";

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;

      // Bug #1124: an office at another station cannot authorize mining here, and does not read as "expired".
      const now = Date.now();
      if (!Array.isArray(corp.offices) || corp.offices.length === 0) {
        outcome = "no-office";
        return;
      }
      if (!activeOfficeAt(corp, corp.currentStationId, now)) {
        outcome = corp.offices.some((o) => o.stationId === corp.currentStationId) ? "office-lease-expired" : "office-wrong-station";
        return;
      }

      if (!Array.isArray(corp.miningLeases)) corp.miningLeases = [];
      const lease = corp.miningLeases.find((l) => l.id === leaseId);
      if (!lease) {
        outcome = "no-lease";
        return;
      }

      if (!Array.isArray(corp.mining?.silicateExtractors) || corp.mining.silicateExtractors.length === 0) {
        outcome = "missing-extractor";
        return;
      }

      const leaseExtractors = corp.mining.silicateExtractors.filter((ex) => ex.leaseId === leaseId);
      if (leaseExtractors.length === 0) {
        outcome = "no-lease-extractors";
        return;
      }

      const extractorCycle = requestedExtractorId
        ? leaseExtractors.find((ex) => ex.id === requestedExtractorId)
        : leaseExtractors[0];

      targetExtractorLabel = extractorCycle?.name || requestedExtractorId || "Extractor";

      if (!extractorCycle) {
        outcome = "missing-extractor-target";
        return;
      }

      if (extractorCycle.active) {
        outcome = "already-active";
        return;
      }

      let throughputPerHour = Math.max(10, Math.min(250, amount));
      if (!Number.isFinite(throughputPerHour) || throughputPerHour <= 0) throughputPerHour = 40;
      // ISP-301 (AB#2284): yards after the corporation's first pay upkeep while they run. The startup is priced on the
      // running cost without it, so the upkeep is only ever charged by the hour.
      const yardIndex = corp.mining.silicateExtractors.indexOf(extractorCycle);
      let baseCostPerHour = operationCostPerHourFor(throughputPerHour);
      if (!Number.isFinite(baseCostPerHour) || baseCostPerHour <= 0) baseCostPerHour = 640;
      const operationCostPerHour = baseCostPerHour + yardUpkeepPerHourFor(yardIndex);
      const startupCost = startupCostFor(baseCostPerHour);

      if ((corp.finances.credits || 0) < startupCost) {
        outcome = "insufficient-credits";
        neededStartup = startupCost;
        return;
      }

      applyCredits(corp, -startupCost, "mining-startup");

      startExtractorCycle(extractorCycle, { now, hours: requestedHours, throughputPerHour, operationCostPerHour, startupCost });
      started = { extractorName: targetExtractorLabel, cost: startupCost, hours: requestedHours, throughputPerHour, operationCostPerHour, endsAt: extractorCycle.endsAt };

      corp.mining.silicateExtractor = corp.mining.silicateExtractors[0];
    });

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    if (outcome !== "ok") {
      const messageMap = {
        "no-office": "You must have an active office lease to operate mining facilities.",
        "office-lease-expired": "Your office lease has expired. Renew your lease to resume mining operations.",
        "office-wrong-station": "Your corporation has no office at this station. Operate from where your office is, or rent one here.",
        "no-lease": "The specified lease could not be found on your account.",
        "missing-extractor": "No extraction facilities are available.",
        "no-lease-extractors": "No extraction facilities are assigned to this lease.",
        "missing-extractor-target": "That extractor is not on this lease. Reload the lease and choose one of its extractors.", // AB#1336
        "already-active": `${targetExtractorLabel} already has an active mining cycle in progress.`,
        "insufficient-credits": fundingRequirementMessage("Starting this mining cycle", account.state.corp, neededStartup, miningCreditsAdvice(neededStartup))
      };
      res.status(400).json({ error: messageMap[outcome] || "Mining cycle failed to start." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "mining",
      title: "Mining Cycle Started",
      body: `${targetExtractorLabel} has begun silicate extraction operations.`
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    res.json({ ...account, receipt: startMiningReceipt(started) });
  });

  // ─── Lease-scoped: Stop a running mining cycle early (AB#1052) ─────────────
  // No office check, unlike start-mining: an expired or wrong-station office should not trap a player into a
  // cycle they cannot end. mutateAccountState settles every extractor up to now (AB#1448) before the mutator
  // below runs, so the mined amount and the charge already reflect the real elapsed time by the time this stops
  // the cycle — see the comment on stopExtractorCycle itself (server/game/mining.js).
  app.post("/api/accounts/:accountId/gameplay/lease/:leaseId/stop-mining", (req, res) => {
    const { leaseId } = req.params;
    const requestedExtractorId = String(req.body?.extractorId || "").trim();
    let outcome = "ok";
    let targetExtractorLabel = "";
    let minedThisCycle = 0;

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;
      const now = Date.now();

      if (!Array.isArray(corp.miningLeases)) corp.miningLeases = [];
      const lease = corp.miningLeases.find((l) => l.id === leaseId);
      if (!lease) {
        outcome = "no-lease";
        return;
      }

      if (!Array.isArray(corp.mining?.silicateExtractors) || corp.mining.silicateExtractors.length === 0) {
        outcome = "missing-extractor";
        return;
      }

      const leaseExtractors = corp.mining.silicateExtractors.filter((ex) => ex.leaseId === leaseId);
      if (leaseExtractors.length === 0) {
        outcome = "no-lease-extractors";
        return;
      }

      const extractorCycle = requestedExtractorId
        ? leaseExtractors.find((ex) => ex.id === requestedExtractorId)
        : leaseExtractors[0];

      targetExtractorLabel = extractorCycle?.name || requestedExtractorId || "Extractor";

      if (!extractorCycle) {
        outcome = "missing-extractor-target";
        return;
      }

      if (!extractorCycle.active) {
        outcome = "not-active";
        return;
      }

      minedThisCycle = extractorCycle.minedThisCycle || 0;
      stopExtractorCycle(extractorCycle, now);
    });

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    if (outcome !== "ok") {
      const messageMap = {
        "no-lease": "The specified lease could not be found on your account.",
        "missing-extractor": "No extraction facilities are available.",
        "no-lease-extractors": "No extraction facilities are assigned to this lease.",
        "missing-extractor-target": "That extractor is not on this lease. Reload the lease and choose one of its extractors.", // AB#1336
        "not-active": `${targetExtractorLabel || "This extractor"} has no mining cycle running.`
      };
      res.status(400).json({ error: messageMap[outcome] || "Could not stop the mining cycle." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "mining",
      title: "Mining Cycle Stopped",
      body: `${targetExtractorLabel} was stopped early, keeping ${minedThisCycle} t mined this cycle.`
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    res.json(account);
  });
}
