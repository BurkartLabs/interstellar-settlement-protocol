// server/routes/corporation.js: the corporation routes, split out of server/index.js (AB#1815).
import { bodyNumber } from "../bodyNumber.js";
import { resolveLeaseBody } from "../leases.js";
import { officeRenewalCost } from "../../public/scripts/ceoEffects.js";
import { ECONOMY } from "../economy.js";
import { officeLeaseCost, OFFICE_TERMS_DAYS } from "../../public/scripts/ceoEffects.js";
import { leaseFilingRefusal } from "../../public/scripts/navigation.js";
import { employeesForNextLease } from "../../public/scripts/leaseStaffing.js";
import { bodyProfile, leaseTypeLabel } from "../../public/scripts/bodyYield.js"; // Bug #2354
import { addAccountNotification, saveAccountsNow, mutateAccountState } from "../gameState.js";
import { applyCredits } from "../finances.js";
// Bug #1058: refusals that say what to do next. Imported beside their first use, away from the import block.
import { employeeCapMessage, LEVELS } from "../nextStep.js";

import { SYSTEMS_CATALOG } from "../travel.js";
import { allStations, stationMap } from "../game/stations.js"; // ISP-209 (AB#904)
import { emitToAccount } from "../realtime.js";
import { activeOfficeAt, fundingRequirementMessage, formatCredits } from "./helpers.js";
// AB#743: what each committing action did, from the values its mutation used, for the confirmation modal.
import { hireReceipt, rentOfficeReceipt, renewOfficeReceipt, purchaseLeaseReceipt } from "../receipts.js";
import { memberOfficeCost } from "../../public/scripts/memberRates.js"; // ISP-212 (AB#907)
import { memberStation } from "../game/stationGovernance.js";
import { leaseCostFor, payConcessionShare } from "../concessions.js"; // ISP-228 (AB#923)

export function registerCorporationRoutes(app) {
  app.post("/api/accounts/:accountId/gameplay/hire", (req, res) => {
    const count = bodyNumber(req.body?.count, { fallback: 1, min: 1, integer: true });
    let outcome = "ok";
    let hiredCount = 0;
    let hireCostCharged = 0;

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;

      if (!activeOfficeAt(corp, corp.currentStationId, Date.now())) {
        outcome = "no-office";
        return;
      }

      const available = Math.max(0, corp.employeeCap - corp.employeeCount);
      const hired = Math.min(count, available);
      const hireCost = hired * ECONOMY.employees.hireCost;

      if (hired <= 0) {
        outcome = "no-capacity";
        return;
      }

      if (corp.finances.credits < hireCost) {
        outcome = "insufficient-credits";
        return;
      }

      corp.employeeCount += hired;
      applyCredits(corp, -hireCost, "hiring");
      corp.finances.dailyCosts += hired * ECONOMY.employees.payrollPerDay;
      hiredCount = hired;
      hireCostCharged = hireCost;
    });

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    if (outcome !== "ok") {
      const corp = account.state.corp;
      const messageMap = {
        "no-office": "You must maintain a registered office at this station before recruiting personnel.",
        "no-capacity": employeeCapMessage(corp, LEVELS),
        "insufficient-credits": fundingRequirementMessage("Hiring", corp, count * 2000)
      };
      res.status(400).json({ error: messageMap[outcome] || "Hire action failed." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "workforce",
      title: "Hiring Order Confirmed",
      body: `${hiredCount} employee(s) were added to your workforce.`
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    const receipt = hireReceipt({
      hired: hiredCount,
      cost: hireCostCharged,
      payrollPerDay: hiredCount * ECONOMY.employees.payrollPerDay,
      corp: account.state.corp
    });
    res.json({ ...account, receipt });
  });

  app.post("/api/accounts/:accountId/gameplay/rent-office", (req, res) => {
    const requestedStationId = String(req.body?.stationId || "earth-station-prime").trim();
    const durationDays = OFFICE_TERMS_DAYS.includes(Number(req.body?.durationDays)) ? Number(req.body.durationDays) : 7;
    let officeCost = officeLeaseCost(durationDays); // Bug #1032: the figure the Suites panel quotes
    let outcome = "ok";
    let stationName = "Earth Station Prime";
    let dockedStationName = "";

    const stationsData = allStations(); // ISP-209 (AB#904): built stations too

    const station = stationsData.find((s) => s.id === requestedStationId);
    if (!station) {
      res.status(400).json({ error: "Station not found." });
      return;
    }

    stationName = station.name;

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;

      // Bug #1124: a lease establishes presence at this location, so it can only be filed at the station the
      // corporation is docked at now -- the only one the Suites panel itself offers.
      if (corp.currentStationId !== station.id) {
        outcome = corp.currentStationId ? "wrong-station" : "in-transit";
        dockedStationName = stationsData.find((s) => s.id === corp.currentStationId)?.name || corp.currentStationId || "";
        return;
      }

      if (!Array.isArray(corp.offices)) {
        corp.offices = [];
      }

      if (corp.offices.some((o) => o.stationId === station.id && o.rentedUntil > Date.now())) {
        outcome = "already-rented";
        return;
      }
      // ISP-212 (AB#907): the member rate at the corporation's own conglomerate's station, membership read now
      officeCost = memberOfficeCost(officeCost, memberStation(corp), station.id);

      if (corp.finances.credits < officeCost) {
        outcome = "insufficient-credits";
        return;
      }

      applyCredits(corp, -officeCost, "office-rent");
      const now = Date.now();
      corp.offices.push({
        stationId: station.id,
        name: station.name,
        body: station.body,
        systemId: station.systemId,
        tier: station.tier,
        rentedAt: now,
        rentedUntil: now + durationDays * 86_400_000,
        durationDays
      });
    });

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    if (outcome !== "ok") {
      const corp = account.state.corp;
      const messageMap = {
        "wrong-station": `You must be docked at ${stationName} to rent an office there. You are at ${dockedStationName || "another station"}: travel there on the Starmap first.`,
        "in-transit": `You are in transit. Dock at ${stationName} to rent an office there.`,
        "already-rented": `Your corporation already maintains an office at ${stationName}.`,
        // AB#1809: formatCredits() already appends "credits" (Bug #1201) -- no second "credits" suffix here.
        "insufficient-credits": `Leasing an office at ${stationName} for ${durationDays} days requires ${formatCredits(officeCost)}. Current reserves: ${formatCredits(corp.finances.credits)}.`
      };
      res.status(400).json({ error: messageMap[outcome] || "Office rental failed." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "administration",
      title: "Office Lease Confirmed",
      body: `Your corporation now maintains a registered operational office at ${stationName}.`
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    const office = (account.state.corp.offices || []).find((o) => o.stationId === station.id);
    const receipt = rentOfficeReceipt({ stationName, durationDays, cost: officeCost, rentedUntil: office?.rentedUntil, corp: account.state.corp });
    res.json({ ...account, receipt });
  });

  // ─── Orbital Executive Suites: Renew an office lease ───────────────────────
  app.post("/api/accounts/:accountId/gameplay/renew-office", (req, res) => {
    const requestedStationId = String(req.body?.stationId || "earth-station-prime").trim();
    const durationDays = OFFICE_TERMS_DAYS.includes(Number(req.body?.durationDays)) ? Number(req.body.durationDays) : 7;
    // Priced inside the mutation: the CEO program that discounts it is part of the corporation's state (Bug #983).
    let renewalCost = officeRenewalCost([], durationDays);
    let outcome = "ok";
    let stationName = "Earth Station Prime";

    const stationsData = allStations(); // ISP-209 (AB#904): built stations too

    const station = stationsData.find((s) => s.id === requestedStationId);
    if (!station) {
      res.status(400).json({ error: "Station not found." });
      return;
    }
    stationName = station.name;

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;
      if (!Array.isArray(corp.offices)) {
        outcome = "no-office";
        return;
      }
      const office = corp.offices.find((o) => o.stationId === station.id);
      if (!office) {
        outcome = "no-office";
        return;
      }
      renewalCost = officeRenewalCost(corp.completedInsights, durationDays);
      renewalCost = memberOfficeCost(renewalCost, memberStation(corp), station.id); // ISP-212 (AB#907)
      if (corp.finances.credits < renewalCost) {
        outcome = "insufficient-credits";
        return;
      }
      applyCredits(corp, -renewalCost, "office-rent");
      const extensionMs = durationDays * 86_400_000;
      const now = Date.now();
      office.rentedUntil = Math.max(office.rentedUntil || now, now) + extensionMs;
      office.durationDays = (office.durationDays || 0) + durationDays;
    });

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    if (outcome !== "ok") {
      const corp = account.state.corp;
      const messageMap = {
        "no-office": `Your corporation does not have an office at ${stationName} to renew.`,
        // AB#1809: formatCredits() already appends "credits" (Bug #1201) -- no second "credits" suffix here.
        "insufficient-credits": `Renewing for ${durationDays} days requires ${formatCredits(renewalCost)}. Current reserves: ${formatCredits(corp.finances.credits)}.`
      };
      res.status(400).json({ error: messageMap[outcome] || "Lease renewal failed." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "administration",
      title: "Office Lease Renewed",
      body: `Your office lease at ${stationName} has been extended by ${durationDays} days.`
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    const office = (account.state.corp.offices || []).find((o) => o.stationId === station.id);
    const receipt = renewOfficeReceipt({ stationName, durationDays, cost: renewalCost, rentedUntil: office?.rentedUntil });
    res.json({ ...account, receipt });
  });

  // ─── ISA Claims & Leases Division: Purchase a mining lease ─────────────────
  app.post("/api/accounts/:accountId/gameplay/purchase-lease", (req, res) => {
    // Bug #691: the body is resolved against data/systems.json, which holds the only lease prices. Unknown bodies,
    // unpriced bodies, unreachable systems, markup and oversized strings are refused before any state changes, and
    // from here on only the catalog's own name is used: in the lease, the error messages and the notification.
    let requestedBody = null;
    let leaseCost = 0;
    let leaseSystemId = null; // ISP-228 (AB#923): a concession holder's share of the fee, paid once this lease is saved
    let bodyError = null;
    let outcome = "ok";
    let existingLeaseOnBody = false;

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;

      // Resolved against the corporation itself, because reachability depends on its research and location.
      const resolved = resolveLeaseBody(SYSTEMS_CATALOG, corp, req.body?.body);
      if (!resolved.ok) {
        outcome = "invalid-body";
        bodyError = resolved.error;
        return;
      }
      requestedBody = resolved.body;
      // ISP-228 (AB#923): a held system's lease discount (the holder's own 25%, or its everyone-discount after notice)
      leaseCost = leaseCostFor(resolved.systemId, corp, resolved.cost).cost;
      leaseSystemId = resolved.systemId;

      // AB#1061: filed at the station that orbits the body, as the claims office offers it; in transit, nowhere.
      const stationRefusal = leaseFilingRefusal(stationMap(), corp.currentStationId || null, requestedBody);
      if (stationRefusal) {
        outcome = "invalid-body";
        bodyError = stationRefusal;
        return;
      }

      // Bug #1124: the office that authorizes a lease is the one at the station where it is filed, not any office
      // the corporation has ever rented -- stationRefusal above already guarantees currentStationId orbits the body.
      if (!activeOfficeAt(corp, corp.currentStationId, Date.now())) {
        outcome = "no-office";
        return;
      }

      if (!Array.isArray(corp.miningLeases)) corp.miningLeases = [];

      // Case-insensitive, so a lease stored before Bug #691 as "mars" still blocks a second one on Mars.
      existingLeaseOnBody = corp.miningLeases.some((l) => String(l.body || l).toLowerCase() === requestedBody.toLowerCase());
      if (existingLeaseOnBody) {
        outcome = "duplicate-lease";
        return;
      }

      const requiredEmployees = employeesForNextLease(corp.miningLeases.length);
      if ((corp.employeeCount || 0) < requiredEmployees) {
        outcome = "insufficient-employees";
        return;
      }

      if ((corp.finances.credits || 0) < leaseCost) {
        outcome = "insufficient-credits";
        return;
      }

      const now = Date.now();
      const leaseId = `lease-${now}-${Math.random().toString(36).slice(2, 8)}`;
      corp.miningLeases.push({
        id: leaseId,
        body: requestedBody,
        leaseType: leaseTypeLabel(bodyProfile(SYSTEMS_CATALOG, requestedBody)), // Bug #2354: what the body yields; the page derives it too
        issuedAt: now,
        cost: leaseCost,
        buildingSlots: 2,
        extractorIds: []
      });

      applyCredits(corp, -leaseCost, "leases");
      corp.buildingSlots = (corp.buildingSlots || 2) + 2;
    });

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    if (outcome === "ok") payConcessionShare(leaseSystemId, leaseCost, account.state.corp, Date.now(), "lease"); // AB#923

    if (outcome !== "ok") {
      const corp = account.state.corp;
      const heldLeases = (corp.miningLeases || []).length;
      const requiredEmployees = employeesForNextLease(heldLeases);
      const headcount = corp.employeeCount || 0;
      // AB#2073: "additional" only once a lease is held; the first lease is just a lease. Say what fixes it, and where.
      const whichLease = heldLeases > 0 ? "an additional mining lease" : "a mining lease";
      const messageMap = {
        "invalid-body": bodyError,
        "no-office": "You must lease a corporate office before filing extraction claims with the ISA.",
        "duplicate-lease": `Your corporation already holds an active mining lease on ${requestedBody}.`,
        "insufficient-employees": `ISA regulations require at least ${requiredEmployees} employees on payroll before issuing ${whichLease}. Hire ${Math.max(0, requiredEmployees - headcount)} more at the Orbital Executive Suites, then file again. Current headcount: ${headcount}.`,
        "insufficient-credits": fundingRequirementMessage(`${requestedBody} mining lease acquisition`, corp, leaseCost)
      };
      res.status(400).json({ error: messageMap[outcome] || "Lease application failed." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "administration",
      title: "Mining Lease Approved",
      body: `ISA Claims & Leases has approved your extraction rights application for ${requestedBody}. Two building slots have been allocated to your lease.`
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    // Commit to disk immediately — critical state that must survive server restarts.
    saveAccountsNow();

    const receipt = purchaseLeaseReceipt({ body: requestedBody, cost: leaseCost, corp: account.state.corp });
    res.json({ ...account, receipt });
  });
}
