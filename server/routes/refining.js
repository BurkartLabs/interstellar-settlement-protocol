// server/routes/refining.js: the refining routes, split out of server/index.js (AB#1815).
import { addAccountNotification, mutateAccountState, REFINERY_CHAINS } from "../gameState.js";
import { getStationInventory } from "../gameState.js";
import { applyCredits } from "../finances.js";
// AB#1255: the run-size rule the Refinery Chains form uses too; imported here beside its use.
import { refineQuantityCheck } from "../../public/scripts/refineQuantity.js";
import { emitToAccount } from "../realtime.js";
// ISP-94 (AB#784): buildHandler builds a refinery, as it builds every player building (server/construction.js).
import { buildHandler } from "./helpers.js";
import { startRefineryReceipt } from "../receipts.js"; // AB#744
// ISP-97 (AB#787): what a run delivers, the Refinery Complex's 1.5 times included, as the tick delivers it.
import { refineryMultiplierFor, refineryOutput } from "../../public/scripts/refineryOutput.js";
import { ECONOMY } from "../economy.js";

export function registerRefiningRoutes(app) {
  // ─── Refinery ────────────────────────────────────────────────────────────────

  // ISP-94 (AB#784): POST /gameplay/build with the Refinery (server/routes/construction.js).
  app.post("/api/accounts/:accountId/gameplay/build-refinery", buildHandler(() => ({ buildingId: "refinery" })));

  app.post("/api/accounts/:accountId/gameplay/start-refinery", (req, res) => {
    const refineryId = String(req.body?.refineryId || "").trim();
    const chainId = String(req.body?.chainId || "").trim();
    // The input units to refine: whole batches of the chain's per-cycle input, at least 100 (refineQuantity.js).
    // Checked as sent; nothing is rounded or defaulted.
    const requestedQuantity = req.body?.inputQuantity;
    let outcome = "ok";
    let targetLabel = "";
    let actualQuantity = 0;
    let actualScale = 1;
    let actualDurationHours = 0;
    let quantityRefusal = "";

    const chain = REFINERY_CHAINS[chainId];
    if (!chain) {
      res.status(400).json({ error: "Unknown refinery chain." });
      return;
    }

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;
      const unlockedTech = corp.unlockedTech || [];

      // Check tech prerequisites for this chain
      if (Array.isArray(chain.requiresTechIds) && !chain.requiresTechIds.every((t) => unlockedTech.includes(t))) {
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

      // The run is exactly what was asked for, or refused (AB#1255): it used to raise anything below one batch to a batch
      // and round the rest down, spending materials the player never chose. The rule is shared with the form.
      const perCycle = Math.max(1, Number(chain.inputQuantityPerCycle));
      const check = refineQuantityCheck(requestedQuantity, { perCycle, input: chain.input });
      if (!check.ok) {
        outcome = "bad-quantity";
        quantityRefusal = check.reason;
        return;
      }
      const scale = check.batches;
      const inputQty = check.quantity;

      // Check input material availability at current station
      const refStationId = corp.currentStationId || "earth-station-prime";
      const refInv = getStationInventory(corp, refStationId);
      const available = Number(refInv[chain.input] || 0);
      if (available < inputQty) {
        outcome = "insufficient-input";
        actualQuantity = inputQty;
        return;
      }

      // Consume input
      refInv[chain.input] -= inputQty;
      if (refInv[chain.input] <= 0) delete refInv[chain.input];

      const now = Date.now();
      actualQuantity = inputQty;
      actualScale = scale;
      actualDurationHours = chain.cycleDurationHours * scale;

      refinery.active = true;
      refinery.chainId = chain.id;
      // Outputs are delivered where the inputs came from, not wherever the corporation is at completion (Bug #692).
      refinery.stationId = refStationId;
      refinery.cycleScale = scale;
      refinery.startedAt = now;
      refinery.lastTickAt = now;
      refinery.endsAt = now + actualDurationHours * 60 * 60 * 1000;
      refinery.totalInputConsumed += inputQty;
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
        "bad-quantity": quantityRefusal,
        "insufficient-input": `Not enough ${chain.input} at this station. Need ${actualQuantity || chain.inputQuantityPerCycle} but only have ${Number(getStationInventory(account.state.corp, account.state.corp.currentStationId || "earth-station-prime")[chain.input] || 0)}.`
      };
      res.status(400).json({ error: messageMap[outcome] || "Refinery cycle failed to start." });
      return;
    }

    // AB#744: the run as the mutation set it up.
    const started = account.state.corp.refineries.find((r) => r.name === targetLabel);
    const delivers = (o) => refineryOutput(o.quantityPerCycle, actualScale, started?.tier, refineryMultiplierFor(started?.tier, ECONOMY.buildings)); // AB#794
    const outputNames = chain.outputs
      .map((o) => `${delivers(o)} ${o.item}`)
      .join(", ");
    const notification = addAccountNotification(req.params.accountId, {
      type: "operations",
      title: "Refinery Cycle Started",
      body: `${targetLabel} processing ${actualQuantity} ${chain.input} → ${outputNames} (${actualDurationHours}h, ${actualScale} batch${actualScale === 1 ? "" : "es"}).`
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    const receipt = startRefineryReceipt({
      refineryName: targetLabel,
      input: chain.input,
      inputQuantity: actualQuantity,
      outputs: chain.outputs.map((o) => ({ item: o.item, quantity: delivers(o) })),
      hours: actualDurationHours,
      endsAt: started?.endsAt
    });
    res.json({ ...account, receipt });
  });
}
