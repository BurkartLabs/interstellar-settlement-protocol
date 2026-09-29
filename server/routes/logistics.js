// server/routes/logistics.js: the logistics routes, split out of server/index.js (AB#1815).
import { randomUUID } from "node:crypto";
import { ECONOMY } from "../economy.js";
import { addAccountNotification, saveAccountsNow, getAccountById, mutateAccountState, NAVIGATION, RESEARCH_LIBRARY, SYSTEMS_BY_ID } from "../gameState.js";
import { getStationInventory } from "../gameState.js";
import { applyCredits } from "../finances.js";
import { describeLines, parseTransferRequest, planTransfer } from "../../public/scripts/logistics.js";
import { transferReceipt, travelReceipt } from "../receipts.js"; // AB#744
import { transitTime } from "../transfers.js";
// Bug #1270 (placed here, apart from the navigation.js import at the top that open PRs edit)
import { IS_DEV } from "../app.js";
import { SYSTEMS_CATALOG, getInterstellarTravelTimeMs, getTravelTimeMs } from "../travel.js";
import { allStations, stationById, stationMap } from "../game/stations.js"; // ISP-209 (AB#904)
import { systemName } from "../../public/scripts/displayNames.js"; // AB#1336
import { emitToAccount } from "../realtime.js";
import { dockRefusal, memberStation } from "../game/stationGovernance.js"; // ISP-211 (AB#906), ISP-212 (AB#907)
import { chargeTariff, systemOfStation, tariffRateFor, transferBase } from "../tariffService.js"; // ISP-230 (AB#925)
import { tariffOn } from "../game/tariffs.js";

export function registerLogisticsRoutes(app) {
  // ─── Logistics: transfer resources between stations ──────────────────────────

  // AB#717: transfers carry up to 10 lines, all or nothing, into corp.logisticsHistory. The rules, the fee and the
  // error copy live in public/scripts/logistics.js, which the Logistics tab reads too; imported here beside its use.
  // AB#985 (ISP-278): dispatch no longer delivers on the spot. transitTime (server/transfers.js, dead since AB#718)
  // gives the arrival time; shipmentTick below delivers on the tick it is reached, the way travelTick delivers travel.

  app.post("/api/accounts/:accountId/gameplay/transfer-resources", (req, res) => {
    const request = parseTransferRequest(req.body);
    if (!request.ok) {
      res.status(400).json({ error: request.error });
      return;
    }

    let refusal = null;
    let dispatched = null;
    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;
      const toStationId = corp.currentStationId || null;
      const plan = planTransfer({
        navigation: NAVIGATION,
        fromStationId: request.fromStationId, toStationId, lines: request.lines,
        inventory: corp.inventory, credits: corp.finances.credits, stations: stationMap(), rates: ECONOMY.logistics,
        memberStationId: memberStation(corp)?.id ?? null // ISP-212 (AB#907): resolved now, not when the page was drawn
      });
      if (!plan.ok) {
        refusal = plan.error; // nothing has moved
        return;
      }
      // Client-supplied arrival time, if any, is never read: the server always derives it from the two stations.
      const minutes = transitTime(request.fromStationId, toStationId);
      if (minutes === null) {
        refusal = "No shipping route joins those stations."; // planTransfer already validated both stations, so this is defensive
        return;
      }

      // ISP-230 (AB#925): goods shipped into a system from outside it pay its holder's tariff at dispatch, on their
      // normal value, beside the fee; the fee and the tariff are both covered, or nothing moves
      const now = Date.now();
      const intoSystem = systemOfStation(toStationId) !== systemOfStation(request.fromStationId);
      const tariffBase = intoSystem ? transferBase(request.lines, now) : 0;
      const tariffDue = intoSystem ? tariffOn(tariffBase, tariffRateFor(corp, toStationId, now)) : 0;
      if (tariffDue > 0 && Number(corp.finances.credits) < plan.fee + tariffDue) {
        refusal = `This shipment costs ${plan.fee.toLocaleString("en-US")} credits in fees and ${tariffDue.toLocaleString("en-US")} in the destination system's concession tariff; you have ${Math.floor(Number(corp.finances.credits)).toLocaleString("en-US")}. Move fewer units or sell goods first.`; // Bug #4807
        return;
      }

      const fromInv = getStationInventory(corp, request.fromStationId);
      for (const { item, quantity } of request.lines) {
        fromInv[item] -= quantity;
        if (fromInv[item] <= 0) delete fromInv[item];
      }
      applyCredits(corp, -plan.fee, "transfer-fees");
      const tariff = intoSystem ? chargeTariff(corp, { stationId: toStationId, base: tariffBase, now }) : { pct: 0, amount: 0 };

      dispatched = {
        id: `shp-${randomUUID()}`,
        fromStationId: request.fromStationId,
        toStationId, // pinned at dispatch (Bug #692's lesson: never re-read "wherever the corp is" at delivery time)
        lines: request.lines,
        fee: plan.fee,
        ...(tariff.amount ? { tariff } : {}), // ISP-230 (AB#925): the rate and amount charged at dispatch
        dispatchedAt: now,
        arrivesAt: now + minutes * 60_000,
        status: "in-transit"
      };
      if (!Array.isArray(corp.shipments)) corp.shipments = [];
      corp.shipments.unshift(dispatched);
    });

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    if (refusal) {
      res.status(400).json({ error: refusal });
      return;
    }
    // AB#744: the shipment as dispatched.
    const receipt = transferReceipt({
      linesText: describeLines(dispatched.lines),
      fromName: stationById(dispatched.fromStationId)?.name || "the source station",
      toName: stationById(dispatched.toStationId)?.name || "this station",
      fee: dispatched.fee,
      arrivesAt: dispatched.arrivesAt,
      tariff: dispatched.tariff || null // ISP-231 (AB#926)
    });
    res.json({ ...account, shipment: dispatched, receipt });
  });

  app.get("/api/accounts/:accountId/gameplay/shipments", (req, res) => {
    const account = getAccountById(req.params.accountId);
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    res.json({ shipments: Array.isArray(account.state.corp.shipments) ? account.state.corp.shipments : [] });
  });

  app.get("/api/accounts/:accountId/gameplay/shipments/:shipmentId", (req, res) => {
    const account = getAccountById(req.params.accountId);
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    const shipment = (account.state.corp.shipments || []).find((s) => s.id === req.params.shipmentId);
    if (!shipment) {
      res.status(404).json({ error: "Shipment not found." });
      return;
    }
    res.json(shipment);
  });

  // ─── Travel: interstellar (system-to-system) or local (dock at station) ──────
  app.post("/api/accounts/:accountId/gameplay/travel", (req, res) => {
    const toSystemId = String(req.body?.toSystemId || "").trim();
    const toStationId = String(req.body?.toStationId || "").trim();

    // Must specify exactly one destination type
    const isInterstellar = Boolean(toSystemId);
    const isLocal = Boolean(toStationId);
    if ((!isInterstellar && !isLocal) || (isInterstellar && isLocal)) {
      res.status(400).json({ error: "Specify either toSystemId (interstellar) or toStationId (dock)." });
      return;
    }

    if (isLocal && !stationById(toStationId)) {
      res.status(400).json({ error: "Invalid destination station." });
      return;
    }

    if (isInterstellar && !SYSTEMS_BY_ID.has(toSystemId)) {
      res.status(400).json({ error: "Invalid destination system." });
      return;
    }

    let outcome = "ok";
    let travelInfo = null;
    let refusedDock = null;

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;

      if (corp.travel) {
        outcome = "already-traveling";
        return;
      }

      if (isInterstellar) {
        // ── Interstellar jump ──
        const fromSystemId = corp.currentSystemId || "sol";
        if (fromSystemId === toSystemId) {
          outcome = "already-in-system";
          return;
        }

        // Research gate: Sol needs none, so a corporation can always come home (Bug #976).
        if (!NAVIGATION.canReachSystem(corp.unlockedTech, fromSystemId, toSystemId)) { outcome = "missing-research"; return; }
        // ISP-117 (AB#809): no route through the catalog's lanes is no jump, not a 99-hour one. Sol is the exception, as
        // the gate's is (Bug #976): a corporation left in a system the catalog no longer has can always go home.
        if (NAVIGATION.systemHops(fromSystemId, toSystemId) === null && toSystemId !== "sol") { outcome = "no-route"; return; }

        const durationMs = getInterstellarTravelTimeMs(fromSystemId, toSystemId);
        const now = Date.now();

        corp.travel = {
          travelType: "interstellar",
          fromSystemId,
          toSystemId,
          fromStationId: corp.currentStationId || null,
          departedAt: now,
          arrivesAt: now + durationMs
        };

        // Undock from current station
        corp.currentStationId = null;
        travelInfo = { ...corp.travel };

      } else {
        // ── Local docking ──
        const station = stationById(toStationId);
        const currentSystemId = corp.currentSystemId || "sol";

        if (station.systemId !== currentSystemId) {
          outcome = "wrong-system";
          return;
        }

        if (corp.currentStationId === toStationId) {
          outcome = "already-docked";
          return;
        }
        // ISP-211 (AB#906): a conglomerate's station admits whom its stakeholders voted to admit
        refusedDock = dockRefusal(corp, toStationId);
        if (refusedDock) {
          outcome = "dock-refused";
          return;
        }

        const durationMs = corp.currentStationId
          ? getTravelTimeMs(corp.currentStationId, toStationId)
          : (IS_DEV ? 5 * 1000 : 10 * 60 * 1000); // from open space: dev 5s, prod 10 min
        const now = Date.now();

        corp.travel = {
          travelType: "local",
          fromStationId: corp.currentStationId || null,
          toStationId,
          toSystemId: currentSystemId,
          departedAt: now,
          arrivesAt: now + durationMs
        };

        // Undock from current station (if docked)
        corp.currentStationId = null;
        travelInfo = { ...corp.travel };
      }
    });

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    if (outcome !== "ok") {
      const messageMap = {
        "already-traveling": "Your ship is already in transit. Wait for arrival before initiating a new course.",
        "already-docked": "You are already docked at this station.",
        "already-in-system": "You are already in this system.",
        // Bug #1270: name the research, and what stands before it, from the research library.
        "missing-research": NAVIGATION.travelResearchLock(RESEARCH_LIBRARY, account.state.corp.unlockedTech, account.state.corp.level,
          account.state.corp.currentSystemId, toSystemId) || "You lack the required navigation research to travel to that system.",
        "wrong-system": "That station is in a different system. Travel to the system first.",
        "no-route": "No jump route reaches that system from here. Jump to a charted system first.",
        "dock-refused": refusedDock
      };
      res.status(400).json({ error: messageMap[outcome] || "Travel request failed." });
      return;
    }

    // Notification
    const etaMs = travelInfo.arrivesAt - travelInfo.departedAt;
    const etaMin = Math.round(etaMs / 60000);
    const etaText = etaMin >= 60
      ? `${Math.floor(etaMin / 60)}h ${etaMin % 60 ? etaMin % 60 + "m" : ""}`
      : etaMin < 1 ? "< 1 minute" : `${etaMin} minute(s)`;

    let notifBody;
    if (travelInfo.travelType === "interstellar") {
      const sysName = systemName(SYSTEMS_CATALOG, travelInfo.toSystemId) || "destination"; // AB#1336: "Barnard's Star", not "Barnards Star"
      notifBody = `Initiating interstellar jump to the ${sysName} system. ETA ${etaText}.`;
    } else {
      const dest = stationById(travelInfo.toStationId);
      notifBody = `Setting course for ${dest.name} (${dest.body}). ETA ${etaText}.`;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "travel",
      title: travelInfo.travelType === "interstellar" ? "Interstellar Jump Initiated" : "Undocking — Course Set",
      body: notifBody,
      protocol: { meaning: "active", screen: "travel" } // ISP-255 (AB#4831): In force until arrival
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    saveAccountsNow();
    // AB#744: the course the mutation set.
    const interstellar = travelInfo.travelType === "interstellar";
    const receipt = travelReceipt({
      interstellar,
      destination: interstellar
        ? `the ${systemName(SYSTEMS_CATALOG, travelInfo.toSystemId) || "destination"} system`
        : stationById(travelInfo.toStationId)?.name || "the station",
      arrivesAt: travelInfo.arrivesAt,
      // AB#2333: where the player can dock on arrival; none in a system whose stations are not built yet.
      stations: interstellar ? allStations().filter((s) => s.systemId === travelInfo.toSystemId).map((s) => s.name) : []
    });
    res.json({ ...account, receipt });
  });
}
