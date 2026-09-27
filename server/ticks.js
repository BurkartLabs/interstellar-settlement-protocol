// server/ticks.js: the background tickers: mining, refining, expeditions, fabrication, travel, shipments, research and finances, split out of server/index.js (AB#1815).
import { SYSTEM_SENDERS } from "./corporationName.js";
import { npcBidAfterRecovery } from "./economy.js";
import { addAccountNotification, getAllAccountIds, getState, mutateAccountState, mutateState, addSystemMessageToAccount, refreshExchangeTax, applyRefineryOperations, ensureBidShape } from "./gameState.js";
import { applyMiningOperations, getStationInventory } from "./gameState.js";
import { applyAsteroidExpeditions, EXPEDITION_DURATIONS, PROBE_ASSET_VALUE } from "./gameState.js";
// Bug #1097: payroll is settled on this same 5-second tick, for every account, online or not.
import { settleAccountPayroll } from "./gameState.js";
// The R&D schedule lives in public/scripts/rndQueue.js, which the R&D panel reads too; imported here beside its use
// (Bug #1258), away from the import block other branches edit.
import { scheduleRndQueue, rndItemStatus } from "../public/scripts/rndQueue.js"; // Bug #1258
import { refreshDailyExpenses } from "./finances.js"; // Bug #1022 (placed apart from the import below, which parallel PRs append to)
import { buildSnapshot, pushSnapshot, refreshDailyRevenue } from "./finances.js";
import { recordTransfer, describeLines } from "../public/scripts/logistics.js";
import { beltRespawnTick, ensureBeltState, isBeltPresent } from "./game/belts.js"; // AB#2329, AB#2330
import { placeNpcAsks } from "./game/npcAsks.js"; // ISP-122 (AB#815)
import { STATION_REGISTRY, SYSTEMS_CATALOG } from "./travel.js";
import { completeShipJobs } from "./shipyard.js"; // ISP-171 (AB#865)
import { UNITS } from "./game/units.js";
import { systemName } from "../public/scripts/displayNames.js"; // AB#1336
import { expeditionNotificationBody, expeditionPlaces, minutesEarly } from "./expeditionText.js"; // AB#1295, AB#2330
import { emitBeltsChanged, emitMarketUpdated, emitToAccount } from "./realtime.js";
import { RATING, refreshCreditRating } from "./creditRating.js"; // ISP-147 (AB#841)
import { getStatements } from "./gameState.js"; // ISP-147: the statements the rating reads
import { statementsVersion } from "./game/store.js"; // AB#842: the rating's basis follows the statements file

// ─── NPC buy-order daily reset ────────────────────────────────────────────────
function getESTDateString() {
  // "sv-SE" locale produces YYYY-MM-DD which is unambiguous
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/New_York" });
}

function checkAndResetNpcBuyOrders() {
  const today = getESTDateString();
  // ISP-122 (AB#815): the NPC asks refill once a day, on the same date change as the bids. Only npc entries move.
  if (getState().market?.npcAsksRefilledOn !== today) {
    mutateState((draft) => {
      placeNpcAsks(draft.market, { refill: true });
      draft.market.npcAsksRefilledOn = today;
    });
    emitMarketUpdated();
  }
  const orders = getState().market?.npcBuyOrders || [];
  if (!orders.some((o) => o.lastResetDate !== today)) return;

  mutateState((draft) => {
    (draft.market.npcBuyOrders || []).forEach((order) => {
      if (order.lastResetDate !== today) {
        ensureBidShape(order);
        // ISP-87: the quota refills and the bid recovers most of the way back towards its base price. A market
        // glutted yesterday opens dearer than it closed, and not as dear as if nobody had sold.
        order.remainingQty = order.totalQtyPerDay;
        order.soldToday = 0;
        order.unitPrice = npcBidAfterRecovery(order.basePrice, order.unitPrice);
        order.lastResetDate = today;
      }
    });
  });
  emitMarketUpdated();
}
// ─── R&D auto-completion tick ────────────────────────────────────────────────
// ─── Mining tick: process downtime, recovery, and mining progress ─────────────

function miningTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    settleAccountPayroll(accountId, now);
    mutateAccountState(accountId, (state) => {
      if (state && state.corp) {
        applyMiningOperations(state.corp, now);
        emitToAccount(accountId, "mining:updated", {
          accountId,
          extractors: state.corp.mining?.silicateExtractors || [],
          inventory: state.corp.inventory || {},
          credits: state.corp.finances?.credits ?? 0
        });
      }
    }, { sanitize: false, settleMining: false });
  }
}

function refineryTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    mutateAccountState(accountId, (state) => {
      if (state && state.corp) {
        applyRefineryOperations(state.corp, now);
      }
    }, { sanitize: false, settleMining: false });
  }
}

// ─── Asteroid expedition tick ────────────────────────────────────────────────
// TODO(AB#729): Consider implementation of unified tick system where all tick based actions are performed at once, rather than a separate ticker calculation
//       for each function.
//
// AB#2330: expeditions mine the belts in the world state, whose reserves every corporation shares, so each corporation
// settles against the same belts in turn. When a belt runs out, a second pass ends the expeditions on it that the first
// pass had already settled, and forgets it from every corporation's scouting: a belt that forms there later is a new
// generation, unscouted.
function asteroidExpeditionTick(now = Date.now()) {
  const home = new Map(); // accountId → { corpName, completedExpeditions }
  const settle = (accountId, world, emptied) => mutateAccountState(accountId, (state) => {
    if (!state?.corp) return;
    const am = state.corp.asteroidMining;
    if (emptied && Array.isArray(am?.scoutedBelts)) am.scoutedBelts = am.scoutedBelts.filter((k) => !emptied.includes(k));
    const came = applyAsteroidExpeditions(state.corp, now, world);
    if (!came.length) return;
    const entry = home.get(accountId) || { corpName: "", completedExpeditions: [] };
    entry.corpName = state.corp.corporationName || "";
    entry.completedExpeditions.push(...came);
    home.set(accountId, entry);
  }, { sanitize: false, settleMining: false });

  let emptied = [];
  mutateState((world) => {
    ensureBeltState(world, now);
    const present = Object.keys(world.belts).filter((k) => isBeltPresent(world.belts[k]));
    for (const accountId of getAllAccountIds()) settle(accountId, world, null);
    emptied = present.filter((k) => !isBeltPresent(world.belts[k]));
    if (emptied.length) for (const accountId of getAllAccountIds()) settle(accountId, world, emptied);
  });
  emitBeltsChanged(emptied); // AB#2331: an open belt panel shows the slot empty without a reload

  for (const [accountId, { corpName, completedExpeditions }] of home) {
    for (const exp of completedExpeditions) {
      const notification = addAccountNotification(accountId, {
        type: "mining",
        title: exp.endedEarly ? "Expedition Ended Early" : "Expedition Complete", // AB#2330
        body: expeditionNotificationBody(exp) // AB#1295: names, not the belt key's suffix and the station id
      });
      if (notification) {
        emitToAccount(accountId, "notifications:new", { accountId, notification });
      }

      // Send detailed expedition report to inbox
      const places = expeditionPlaces(exp); // AB#1295: from the catalogs, not title-cased ids ("Ac Belt")
      const beltLabel = places.belt || "Asteroid Belt";
      const systemLabel = places.system || "Unknown";
      const stationName = places.station || "your nearest station";
      const durationLabel = EXPEDITION_DURATIONS[exp.duration]?.label || exp.duration;
      const yieldLines = Object.entries(exp.yields || {});
      const yieldBlock = yieldLines.length
        // ISP-96 (AB#786): a metal the Ferric Mining Complex added to says how much of it was the complex's.
        ? yieldLines.map(([r, q]) => `  ${String(q).padStart(6)} units — ${r}${exp.ferricBonus?.[r] ? ` (+${exp.ferricBonus[r]} from your Ferric Mining Complex)` : ""}`).join("\n")
        : "  No recoverable material extracted.";
      const totalUnits = yieldLines.reduce((sum, [, q]) => sum + q, 0);
      const refNo = `MPR-${(exp.systemId || "sol").slice(0, 3).toUpperCase()}-${String(exp.completedAt || Date.now()).slice(-8)}`;

      addSystemMessageToAccount(accountId, {
        subject: `Mining Probe Return — ${beltLabel} [${refNo}]`,
        fromName: SYSTEM_SENDERS.MINERAL_SURVEY,
        body:
          `Attn: ${corpName || "Registered Operator"},\n\n` +
          `This report confirms the return of one (1) mining probe from the ${beltLabel} asteroid field, ${systemLabel} system. ` +
          (exp.endedEarly // AB#2330
            ? `The probe's ${durationLabel} operation was cut short ${minutesEarly(exp)} minute(s) before its scheduled return: the belt was mined out. The probe has been recovered intact. The launch fee is not refundable.\n\n`
            : `The probe completed a ${durationLabel} operation and has been recovered intact.\n\n`) +
          `RECOVERED MATERIAL MANIFEST\n` +
          `${"─".repeat(40)}\n` +
          `${yieldBlock}\n` +
          `${"─".repeat(40)}\n` +
          `  Total: ${totalUnits} units\n\n` +
          `All extracted material has been deposited into your registered inventory at ${stationName}. Standard ISA handling fees have been waived under current extraction licence terms.\n\n` +
          `Probe status: Operational. Returned to available inventory.\n\n` +
          `This record is filed under your active extraction licence and may be subject to ISA audit. Retain for your records.\n\n` +
          `Ref: ${refNo}\nISA Mineral Survey Division — ${systemLabel} Sector Office`
      });
    }

    if (completedExpeditions.length > 0) {
      emitToAccount(accountId, "expedition:completed", { accountId });
    }
  }
}

// ─── Fabrication queue tick ──────────────────────────────────────────────────
function fabricationTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let completed = false;
    const shipsDone = [];
    mutateAccountState(accountId, (state) => {
      // ISP-171 (AB#865): the shipyard's jobs complete on the same tick; delivered once, then gone from the queue
      const ships = completeShipJobs(state.corp, now);
      if (ships.length) shipsDone.push(...ships);
      if (!state?.corp?.asteroidMining?.fabricationQueue?.length) return;
      const am = state.corp.asteroidMining;
      const done = am.fabricationQueue.filter(j => now >= j.completesAt);
      if (!done.length) return;

      for (const job of done) {
        if (job.type === "mining-probe") {
          am.probeCount = (am.probeCount || 0) + 1; // the gate already counted it against the Fleet Cap
          state.corp.finances.assets = (state.corp.finances.assets || 0) + PROBE_ASSET_VALUE;
        }
      }
      am.fabricationQueue = am.fabricationQueue.filter(j => now < j.completesAt);
      completed = true;
    }, { sanitize: false, settleMining: false });

    if (completed) {
      const notification = addAccountNotification(accountId, {
        type: "infrastructure",
        title: "Mining Probe Fabricated",
        body: "A new Mining Probe has been manufactured and is ready for deployment."
      });
      if (notification) emitToAccount(accountId, "notifications:new", { accountId, notification });
      emitToAccount(accountId, "fabrication:completed", { accountId });
    }
    for (const job of shipsDone) {
      const notification = addAccountNotification(accountId, {
        type: "infrastructure",
        title: "Ships Delivered",
        body: `${job.quantity} ${UNITS[job.unitId].name}${job.quantity === 1 ? "" : "s"} left the Orbital Shipyard and joined your fleet.`
      });
      if (notification) emitToAccount(accountId, "notifications:new", { accountId, notification });
    }
  }
}

// ─── Travel arrival tick ─────────────────────────────────────────────────────
function travelTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let arrived = false;
    let travelResult = null;

    mutateAccountState(accountId, (state) => {
      const travel = state.corp?.travel;
      if (!travel || !travel.arrivesAt) return;
      if (now < travel.arrivesAt) return;

      if (travel.travelType === "interstellar") {
        // Arrive in a new system — not docked at any station
        state.corp.currentSystemId = travel.toSystemId;
        state.corp.currentStationId = null;
        state.corp.location = travel.toSystemId;
        travelResult = { type: "interstellar", systemId: travel.toSystemId };
      } else {
        // Local dock — arrive at station
        const dest = STATION_REGISTRY[travel.toStationId];
        if (dest) {
          state.corp.currentStationId = travel.toStationId;
          state.corp.currentSystemId = dest.systemId;
          state.corp.location = dest.body;
          travelResult = { type: "local", stationId: travel.toStationId };
        }
      }
      state.corp.travel = null;
      arrived = true;
    }, { sanitize: false, settleMining: false });

    if (arrived && travelResult) {
      let notification;
      if (travelResult.type === "interstellar") {
        const sysLabel = systemName(SYSTEMS_CATALOG, travelResult.systemId) || "destination"; // AB#1336
        notification = addAccountNotification(accountId, {
          type: "travel",
          title: "System Arrival",
          body: `Your ship has arrived in the ${sysLabel} system. You are in open space — select a station to dock.`
        });
        emitToAccount(accountId, "travel:arrived", { accountId, systemId: travelResult.systemId });
      } else {
        const station = STATION_REGISTRY[travelResult.stationId];
        if (station) {
          notification = addAccountNotification(accountId, {
            type: "travel",
            title: "Docking Complete",
            body: `Your ship has arrived at ${station.name} (${station.body}, ${systemName(SYSTEMS_CATALOG, station.systemId) || "open space"}).` // AB#1336: not "SOL"
          });
          emitToAccount(accountId, "travel:arrived", { accountId, stationId: travelResult.stationId });
        }
      }
      if (notification) {
        emitToAccount(accountId, "notifications:new", { accountId, notification });
      }
    }
  }
}
function processRndCompletions() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let completedItems = [];

    mutateAccountState(accountId, (state) => {
      const queue = state.queues?.corporateRnD;
      if (!Array.isArray(queue) || queue.length === 0) return;

      // One technology at a time (Bug #1258): sequence the queue first, which also pushes research queued before
      // the fix back behind the item ahead of it, then complete the finished items, always a run from the front.
      scheduleRndQueue(queue, now);
      let finished = 0;
      while (finished < queue.length && rndItemStatus(queue[finished], now).state === "done") finished += 1;
      completedItems = queue.slice(0, finished);
      if (completedItems.length === 0) return;

      if (!Array.isArray(state.corp.unlockedTech)) state.corp.unlockedTech = [];
      for (const item of completedItems) {
        if (item.techId && !state.corp.unlockedTech.includes(item.techId)) {
          state.corp.unlockedTech.push(item.techId);
        }
      }
      // By position, not id: two items queued in the same millisecond share an id.
      state.queues.corporateRnD = queue.slice(finished);
    }, { sanitize: false, settleMining: false });

    if (completedItems.length === 0) continue;

    emitToAccount(accountId, "rnd:completed", { accountId });

    for (const item of completedItems) {
      const notification = addAccountNotification(accountId, {
        type: "research",
        title: "R&D Complete",
        body: `${item.name} has been completed and applied to your corporation.`
      });
      if (notification) {
        emitToAccount(accountId, "notifications:new", { accountId, notification });
      }
    }
  }
}

function processCeoInsightCompletions() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let completedItems = [];

    mutateAccountState(accountId, (state) => {
      const queue = state.queues?.ceoInsight;
      if (!Array.isArray(queue) || queue.length === 0) return;

      completedItems = queue.filter((item) => {
        const startedAt = Number(item?.startedAt || 0);
        const durationHours = Number(item?.durationHours ?? NaN);
        if (!startedAt || !Number.isFinite(durationHours) || durationHours < 0) {
          return false;
        }
        return now >= startedAt + durationHours * 3_600_000;
      });
      if (completedItems.length === 0) return;

      if (!Array.isArray(state.corp.completedInsights)) state.corp.completedInsights = [];
      for (const item of completedItems) {
        if (item.programId) {
          state.corp.completedInsights.push(item.programId);
        }
      }

      // Recalculate the effective tax rate and its breakdown after insight completions (ISP-302, AB#2285)
      refreshExchangeTax(state);

      state.queues.ceoInsight = queue.filter(
        (item) => !completedItems.some((c) => c.id === item.id)
      );
    }, { sanitize: false, settleMining: false });

    if (completedItems.length === 0) continue;

    emitToAccount(accountId, "ceo:completed", { accountId });

    for (const item of completedItems) {
      const notification = addAccountNotification(accountId, {
        type: "insight",
        title: "CEO Insight Complete",
        body: `${item.name} has been completed.`
      });
      if (notification) {
        emitToAccount(accountId, "notifications:new", { accountId, notification });
      }
    }
  }
}
// ─── Financial snapshot tick ─────────────────────────────────────────────────
// Captures a rolling balance/flow snapshot for every active corp so the
// Financial Core dashboard can render real historical series (cash reserves,
// net flow, assets vs liabilities) instead of synthesised projections.

const FINANCIAL_SNAPSHOT_INTERVAL_MS = 30_000;

function financialSnapshotTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let finances = null;
    let creditRating = null;
    mutateAccountState(accountId, (state) => {
      if (!state || !state.corp) return;
      refreshDailyRevenue(state.corp, now); // Bug #984: income older than 24 hours leaves the daily figure
      refreshDailyExpenses(state.corp, now); // Bug #1022: and so do costs
      const snap = buildSnapshot(state.corp, now, getState().market);
      pushSnapshot(state.corp, snap);
      // ISP-147 (AB#841): the credit rating, recomputed only when a statement closed or the debt or wages owed changed
      refreshCreditRating(state.corp, now, () => getStatements(accountId, RATING.windowStatements, now)?.statements, { statementsVersion: statementsVersion(accountId) });
      finances = state.corp.finances;
      creditRating = state.corp.creditRating ?? null; // AB#842: the Finance tab's rating card rides on this event
    }, { sanitize: false, settleMining: false });
    if (finances) {
      // Reuse the existing finance:updated channel so clients refresh their snapshot-driven dashboard. Only this
      // account's sockets get it, with the account id so the client can check it (Bug #1021).
      emitToAccount(accountId, "finance:updated", { accountId, finances, creditRating });
    }
  }
}

// ─── Shipment arrival tick ────────────────────────────────────────────────────
// Mirrors travelTick: goods dispatched above arrive here, on the first tick at or after arrivesAt, exactly once
// (delivered shipments are dropped from corp.shipments in the same pass that credits the destination).
/** AB#2329: the hourly draw for every empty belt slot; run often, it draws only at each hour boundary it has passed. */
function beltTick(now = Date.now()) {
  let spawned = [];
  mutateState((draft) => { spawned = beltRespawnTick(draft, now); });
  emitBeltsChanged(spawned.map((b) => b.key)); // AB#2331: and a new belt there, unscouted, likewise
  return spawned;
}

function shipmentTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    const outcomes = []; // { shipment, delivered }

    mutateAccountState(accountId, (state) => {
      const corp = state.corp;
      if (!Array.isArray(corp.shipments) || corp.shipments.length === 0) return;

      for (const shipment of corp.shipments) {
        if (shipment.status !== "in-transit" || now < shipment.arrivesAt) continue;

        const destination = STATION_REGISTRY[shipment.toStationId];
        if (!destination) {
          // The destination is no longer in the catalog (a decommissioned station). Nothing is destroyed: the
          // shipment stays held rather than delivered or dropped, for the Board to resolve.
          shipment.status = "held";
          outcomes.push({ shipment, delivered: false });
          continue;
        }

        const toInv = getStationInventory(corp, shipment.toStationId);
        for (const { item, quantity } of shipment.lines) {
          toInv[item] = (toInv[item] || 0) + quantity;
        }
        corp.logisticsHistory = recordTransfer(corp.logisticsHistory, {
          time: now, from: shipment.fromStationId, to: shipment.toStationId, lines: shipment.lines, fee: shipment.fee
        });
        shipment.status = "delivered";
        outcomes.push({ shipment, delivered: true });
      }

      corp.shipments = corp.shipments.filter((s) => s.status !== "delivered");
    }, { sanitize: false, settleMining: false });

    for (const { shipment, delivered } of outcomes) {
      const destinationName = STATION_REGISTRY[shipment.toStationId]?.name || shipment.toStationId;
      const notification = addAccountNotification(accountId, delivered
        ? { type: "logistics", title: "Shipment Received", body: `${describeLines(shipment.lines)} has arrived at ${destinationName}.` }
        : { type: "logistics", title: "Shipment Held", body: `A shipment bound for ${destinationName} could not be delivered: the destination is not recognized. Reference number: ${shipment.id}.` });
      if (notification) emitToAccount(accountId, "notifications:new", { accountId, notification });
      // ISP-279 (AB#986): lets the Logistics tab move the shipment to history (or show it held) with no reload,
      // the way travel:arrived already does for travel.
      emitToAccount(accountId, "logistics:arrived", { accountId, shipmentId: shipment.id, delivered });
    }
  }
}

export { beltTick, checkAndResetNpcBuyOrders, miningTick, refineryTick, asteroidExpeditionTick, fabricationTick, travelTick, processRndCompletions, processCeoInsightCompletions, financialSnapshotTick, FINANCIAL_SNAPSHOT_INTERVAL_MS, shipmentTick };
