// server/routes/refining.js: the refining routes, split out of server/index.js (AB#1815).
import { addAccountNotification, mutateAccountState, REFINERY_CHAINS } from "../gameState.js";
import { getStationInventory } from "../gameState.js";
import { applyCredits } from "../finances.js";
// AB#1255, ISP-131 (AB#825): the run rule the Refinery Chains form uses too: whole batches, a week at most, and every
// input present in full or the whole start refused.
import { refineRunCheck } from "../../public/scripts/refineryRun.js";
import { emitToAccount } from "../realtime.js";
// ISP-94 (AB#784): buildHandler builds a refinery, as it builds every player building (server/construction.js).
import { buildHandler } from "./helpers.js";
import { startRefineryReceipt } from "../receipts.js"; // AB#744
// ISP-97 (AB#787): what a run delivers, the Refinery Complex's 1.5 times included, as the tick delivers it.
import { refineryMultiplierFor, refineryOutput } from "../../public/scripts/refineryOutput.js";
import { ECONOMY } from "../economy.js";
import { chainResearchMissing } from "../game/researchGates.js";

export function registerRefiningRoutes(app) {
  // ─── Refinery ────────────────────────────────────────────────────────────────

  // ISP-94 (AB#784): POST /gameplay/build with the Refinery (server/routes/construction.js).
  app.post("/api/accounts/:accountId/gameplay/build-refinery", buildHandler(() => ({ buildingId: "refinery" })));

  app.post("/api/accounts/:accountId/gameplay/start-refinery", (req, res) => {
    const refineryId = String(req.body?.refineryId || "").trim();
    const chainId = String(req.body?.chainId || "").trim();
    // The run as sent: `inputQuantity` units of a one-input chain's input, or `batches` of any chain (refineryRun.js).
    // Checked as sent; nothing is rounded or defaulted.
    const requested = { inputQuantity: req.body?.inputQuantity, batches: req.body?.batches };
    let outcome = "ok";
    let targetLabel = "";
    let actualDebits = [];
    let actualScale = 1;
    let actualDurationHours = 0;
    let runRefusal = "";

    const chain = Object.hasOwn(REFINERY_CHAINS, chainId) ? REFINERY_CHAINS[chainId] : null;
    if (!chain) {
      res.status(400).json({ error: "Unknown refinery chain." });
      return;
    }

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;
      // Check tech prerequisites for this chain
      if (chainResearchMissing(chain, corp)) {
        outcome = "missing-research";
        return;
      }

      if (!Array.isArray(corp.refineries) || !corp.refineries.length) {
        outcome = "no-refinery";
        return;
      }

      const refinery = refineryId
        ? corp.refineries.find((r) => r.id === refineryId)
        : corp.refineries.find((r) => !r.active);
      targetLabel = refinery?.name || refineryId || "Refinery";

      if (!refinery) {
        outcome = refineryId ? "refinery-not-found" : "all-busy";
        return;
      }

      if (refinery.active) {
        outcome = "already-active";
        return;
      }

      // AB#794: a refinery being upgraded is offline until the upgrade finishes.
      if (Number(refinery.upgradingUntil) > Date.now()) {
        outcome = "upgrading";
        return;
      }

      // The run is exactly what was asked for, or refused whole (AB#1255, AB#825): every input is checked against the
      // station's stock before any is taken, so a start never leaves half its inputs debited.
      const refStationId = corp.currentStationId || "earth-station-prime";
      const refInv = getStationInventory(corp, refStationId);
      const run = refineRunCheck(chain, requested, (item) => refInv[item]);
      if (!run.ok) {
        outcome = "bad-run";
        runRefusal = run.reason;
        return;
      }

      for (const { item, quantity } of run.debits) {
        refInv[item] -= quantity;
        if (refInv[item] <= 0) delete refInv[item];
      }

      const now = Date.now();
      actualDebits = run.debits;
      actualScale = run.batches;
      actualDurationHours = chain.cycleDurationHours * run.batches;

      refinery.active = true;
      refinery.chainId = chain.id;
      // Outputs are delivered where the inputs came from, not wherever the corporation is at completion (Bug #692).
      refinery.stationId = refStationId;
      refinery.cycleScale = run.batches;
      // AB#825: the run records what it took and what it will deliver, so a chain edited or removed while it runs
      // cannot change what it produces (applyRefineryOperations delivers this record).
      refinery.inputs = run.debits;
      refinery.outputs = chain.outputs.map((o) => ({
        item: o.item,
        quantity: refineryOutput(o.quantityPerCycle, run.batches, refinery.tier, refineryMultiplierFor(refinery.tier, ECONOMY.buildings))
      }));
      refinery.startedAt = now;
      refinery.lastTickAt = now;
      refinery.endsAt = now + actualDurationHours * 60 * 60 * 1000;
      refinery.totalInputConsumed += run.debits.reduce((sum, d) => sum + d.quantity, 0);
    });

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    if (outcome !== "ok") {
      const messageMap = {
        "missing-research": `This chain requires: ${chain.requiresResearch.join(", ")}.`,
        "no-refinery": "Build a Refinery before starting a production run.",
        "refinery-not-found": "That refinery was not found. It may have been removed; reload and choose another.", // AB#1336: no id echoed back
        "all-busy": "All refineries are currently running cycles.",
        "already-active": `${targetLabel} already has an active production cycle.`,
        upgrading: `${targetLabel} is being upgraded and is offline until it finishes.`,
        "bad-run": runRefusal
      };
      res.status(400).json({ error: messageMap[outcome] || "Refinery cycle failed to start." });
      return;
    }

    // AB#744: the run as the mutation set it up, and what it recorded it will deliver.
    const started = account.state.corp.refineries.find((r) => r.name === targetLabel);
    const outputs = started?.outputs || [];
    const outputNames = outputs.map((o) => `${o.quantity} ${o.item}`).join(", ");
    const notification = addAccountNotification(req.params.accountId, {
      type: "operations",
      title: "Refinery Cycle Started",
      body: `${targetLabel} processing ${actualDebits.map((d) => `${d.quantity} ${d.item}`).join(" + ")} → ${outputNames} (${actualDurationHours}h, ${actualScale} batch${actualScale === 1 ? "" : "es"}).`
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    const receipt = startRefineryReceipt({
      refineryName: targetLabel,
      inputs: actualDebits,
      outputs,
      hours: actualDurationHours,
      endsAt: started?.endsAt
    });
    res.json({ ...account, receipt });
  });
}
