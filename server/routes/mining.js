// server/routes/mining.js: the mining routes, split out of server/index.js (AB#1815).
import { bodyNumber } from "../bodyNumber.js";
import { operationCostPerHourFor, startupCostFor, yardTierFor, yardUpkeepPerHourFor } from "../economy.js";
import { addAccountNotification, mutateAccountState } from "../gameState.js";
import { startExtractorCycle, stopExtractorCycle } from "../gameState.js"; // AB#575, AB#1052
import { applyCredits } from "../finances.js";
// Bug #1058: refusals that say what to do next. Imported beside their first use, away from the import block.
import { miningCreditsAdvice } from "../nextStep.js";
import { emitToAccount } from "../realtime.js";
// ISP-94 (AB#784): buildHandler builds the yard, as it builds every player building (server/construction.js).
import { fundingRequirementMessage, activeOfficeAt, buildHandler } from "./helpers.js";
// AB#743: what each committing action did, from the values its mutation used, for the confirmation modal.
import { startMiningReceipt } from "../receipts.js";
import { utcTime } from "../../public/scripts/timeFormat.js"; // ISP-249 (AB#945): one format for every timestamp

export function registerMiningRoutes(app) {
  // ─── Lease-scoped: Build an extractor yard on a specific lease ──────────────
  // ISP-94 (AB#784): POST /gameplay/build with the yard and this lease (server/routes/construction.js).
  app.post("/api/accounts/:accountId/gameplay/lease/:leaseId/build-extractor", buildHandler((req) => ({ buildingId: "basic-extractor-yard", leaseId: req.params.leaseId })));

  // ─── Lease-scoped: Start a mining cycle on a lease extractor ───────────────
  app.post("/api/accounts/:accountId/gameplay/lease/:leaseId/start-mining", (req, res) => {
    const { leaseId } = req.params;
    let neededStartup = 0; // Bug #1058: the start-up cost, for the refusal
    let upgradingUntil = 0; // AB#793: when an upgrading yard is back, for the refusal
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

      // AB#793: a yard being upgraded is offline until the upgrade finishes.
      if (Number(extractorCycle.upgradingUntil) > now) {
        outcome = "upgrading";
        upgradingUntil = Number(extractorCycle.upgradingUntil);
        return;
      }

      // AB#793: the yard's tier sets its cap and the curve its running cost follows (docs/design/upgrades.md).
      const { tier, throughputCap } = yardTierFor(extractorCycle.tier);
      let throughputPerHour = Math.max(10, Math.min(throughputCap, amount));
      if (!Number.isFinite(throughputPerHour) || throughputPerHour <= 0) throughputPerHour = 40;
      // ISP-301 (AB#2284): yards after the corporation's first pay upkeep while they run. The startup is priced on the
      // running cost without it, so the upkeep is only ever charged by the hour.
      const yardIndex = corp.mining.silicateExtractors.indexOf(extractorCycle);
      let baseCostPerHour = operationCostPerHourFor(throughputPerHour, undefined, { tier });
      if (!Number.isFinite(baseCostPerHour) || baseCostPerHour <= 0) baseCostPerHour = 640;
      const upkeepPerHour = yardUpkeepPerHourFor(yardIndex);
      const operationCostPerHour = baseCostPerHour + upkeepPerHour;
      const startupCost = startupCostFor(baseCostPerHour);

      if ((corp.finances.credits || 0) < startupCost) {
        outcome = "insufficient-credits";
        neededStartup = startupCost;
        return;
      }

      applyCredits(corp, -startupCost, "mining-startup");

      startExtractorCycle(extractorCycle, { now, hours: requestedHours, throughputPerHour, operationCostPerHour, startupCost, upkeepPerHour }); // ISP-307
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
        upgrading: `${targetExtractorLabel} is being upgraded and is offline until ${utcTime(upgradingUntil, { withDate: true })}.`, // ISP-249 (AB#945)
        "insufficient-credits": fundingRequirementMessage("Starting this mining cycle", account.state.corp, neededStartup, miningCreditsAdvice(neededStartup))
      };
      res.status(400).json({ error: messageMap[outcome] || "Mining cycle failed to start." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "mining",
      protocol: { meaning: "active", screen: "station-active-mining-cycles" }, // ISP-254 Bd (AB#4819)
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
      protocol: { meaning: "cancelled", screen: "station-active-mining-cycles" }, // ISP-254 Bd (AB#4819)
      title: "Mining Cycle Stopped",
      body: `${targetExtractorLabel} was stopped early, keeping ${minedThisCycle} t mined this cycle.`
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    res.json(account);
  });
}
