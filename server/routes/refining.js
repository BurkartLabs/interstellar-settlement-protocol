// server/routes/refining.js: the refining routes, split out of server/index.js (AB#1815).
import { ECONOMY } from "../economy.js";
import { addAccountNotification, mutateAccountState, REFINERY_CHAINS } from "../gameState.js";
import { getStationInventory } from "../gameState.js";
import { applyCredits } from "../finances.js";
// AB#1255: the run-size rule the Refinery Chains form uses too; imported here beside its use.
import { refineQuantityCheck } from "../../public/scripts/refineQuantity.js";
import { emitToAccount } from "../realtime.js";
import { corpSlotsFull, fundingRequirementMessage } from "./helpers.js";
import { buildRefineryReceipt, startRefineryReceipt } from "../receipts.js"; // AB#744

export function registerRefiningRoutes(app) {
  // ─── Refinery ────────────────────────────────────────────────────────────────

  app.post("/api/accounts/:accountId/gameplay/build-refinery", (req, res) => {
    const BUILD_COST = ECONOMY.buildings.refineryCost;
    const ASSET_VALUE = ECONOMY.buildings.refineryAssetValue;
    let outcome = "ok";

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;
      const unlockedTech = corp.unlockedTech || [];

      // Require both Material Compression I and Nano-Lattice Weaving
      if (!unlockedTech.includes("tt-material-compression") || !unlockedTech.includes("tt-nano-lattice")) {
        outcome = "missing-research";
        return;
      }

      // Cap concurrent refineries (each lets you run one chain in parallel).
      const MAX_REFINERIES = 2;
      const existingRefineries = (corp.buildings || []).filter((b) => b.name === "Refinery").length;
      if (existingRefineries >= MAX_REFINERIES) {
        outcome = "max-refineries";
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
      corp.buildings.push({ name: "Refinery", tier: 1, status: "Operational" });

      if (!Array.isArray(corp.refineries)) corp.refineries = [];
      const nextIndex = corp.refineries.length + 1;
      corp.refineries.push({
        id: `ref-${nextIndex}`,
        name: `Refinery #${nextIndex}`,
        tier: 1,
        active: false,
        chainId: null,
        startedAt: null,
        lastTickAt: null,
        endsAt: null,
        cyclesCompleted: 0,
        totalInputConsumed: 0,
        totalOutputProduced: 0
      });

      applyCredits(corp, -BUILD_COST, "construction");
      corp.finances.assets = (corp.finances.assets || 0) + ASSET_VALUE;
    });

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    if (outcome !== "ok") {
      const corp = account.state.corp;
      const messageMap = {
        "missing-research": "Refinery construction requires Material Compression I and Nano-Lattice Weaving research.",
        "max-refineries": "You already operate the maximum of 2 refineries.",
        "no-slot": `A refinery needs a free building slot. ${corpSlotsFull(corp)}`,
        "insufficient-credits": fundingRequirementMessage("Refinery construction", corp, BUILD_COST)
      };
      res.status(400).json({ error: messageMap[outcome] || "Build action failed." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "infrastructure",
      title: "Refinery Commissioned",
      body: "A new Refinery is now operational and ready for production runs."
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    // AB#744: what was built and what it took, from the corporation the mutation left.
    const built = account.state.corp;
    const receipt = buildRefineryReceipt({
      refineryName: built.refineries[built.refineries.length - 1]?.name || "Refinery",
      cost: BUILD_COST,
      slotsUsed: (built.buildings || []).length,
      slotsTotal: built.buildingSlots || 2
    });
    res.json({ ...account, receipt });
  });

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
        "bad-quantity": quantityRefusal,
        "insufficient-input": `Not enough ${chain.input} at this station. Need ${actualQuantity || chain.inputQuantityPerCycle} but only have ${Number(getStationInventory(account.state.corp, account.state.corp.currentStationId || "earth-station-prime")[chain.input] || 0)}.`
      };
      res.status(400).json({ error: messageMap[outcome] || "Refinery cycle failed to start." });
      return;
    }

    const outputNames = chain.outputs
      .map((o) => `${o.quantityPerCycle * actualScale} ${o.item}`)
      .join(", ");
    const notification = addAccountNotification(req.params.accountId, {
      type: "operations",
      title: "Refinery Cycle Started",
      body: `${targetLabel} processing ${actualQuantity} ${chain.input} → ${outputNames} (${actualDurationHours}h, ${actualScale} batch${actualScale === 1 ? "" : "es"}).`
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    // AB#744: the run as the mutation set it up.
    const started = account.state.corp.refineries.find((r) => r.name === targetLabel);
    const receipt = startRefineryReceipt({
      refineryName: targetLabel,
      input: chain.input,
      inputQuantity: actualQuantity,
      outputs: chain.outputs.map((o) => ({ item: o.item, quantity: o.quantityPerCycle * actualScale })),
      hours: actualDurationHours,
      endsAt: started?.endsAt
    });
    res.json({ ...account, receipt });
  });
}
