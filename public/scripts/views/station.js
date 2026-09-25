// The Station tab and the building views it opens: the executive suites, ISA claims and leases, lease management,
// and the assembly facility.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { OFFICE_TERMS_DAYS, officeLeaseCost, officeRenewalCost } from "../ceoEffects.js";
import { claimsAllTakenText, claimsNoLeasesText } from "../emptyStates.js";
import { stationStartPromptHtml } from "../firstAction.js";
import { deepClone, formatDuration, toCurrency } from "../helpers.js";
import { escapeHtml, stationBuildingCardsHtml } from "../html.js";
import { activeCycleFigures, extractorState } from "../leaseLive.js";
import { probeFabricationStartedText } from "../miningFeedback.js";
import { bestThroughput, costPerHourFor, miningProjection, startupCostFor as clientStartupCostFor } from "../miningProjection.js";
import { clientPrices } from "../clientPrices.js";
import { leaseFullAdvice } from "../slotAdvice.js";
import { appState } from "../state.js";
import { renderStationFacilities } from "../stationFacilities.js";
import { renderMissions } from "./assignments.js";
import { formatSystemLabel, getCurrentStationInfo, pushFeedback, revealUnderHeader, setTab, showTradeConfirmation, stationLocationBanner, updateAllViews } from "./shared.js";

export function showStationOverview() {
  const overviewEl = document.getElementById("station-overview-view");
  const detailEl = document.getElementById("station-building-view");
  const contentEl = document.getElementById("station-building-content");
  if (overviewEl) overviewEl.hidden = false;
  if (detailEl) detailEl.hidden = true;
  if (contentEl) contentEl.classList.remove("ge-bg", "icl-bg", "oes-bg");
  appState.stationActiveLease = null;
}

export function showStationBuilding(buildingId) {
  const overviewEl = document.getElementById("station-overview-view");
  const detailEl = document.getElementById("station-building-view");
  const contentEl = document.getElementById("station-building-content");
  if (!overviewEl || !detailEl || !contentEl) return;

  const building = appState.buildingRegistry.find((b) => b.id === buildingId);
  if (!building) return;

  overviewEl.hidden = true;
  detailEl.hidden = false;
  // For ISA Contracting & Assignments Bureau, renderBuildingDetail switches tab to 'missions' and returns early
  if (building.id === "isa-contracting-assignments") {
    renderBuildingDetail(building, appState.data);
    return;
  }
  renderBuildingDetail(building, appState.data);
  setTab("station");
}

export function renderBuildingDetail(building, data) {
  const contentEl = document.getElementById("station-building-content");
  if (!contentEl) return;

  // Apply building-specific background classes
  contentEl.classList.remove("ge-bg", "icl-bg", "oes-bg");
  if (building.id === "orbital-executive-suites") {
    contentEl.classList.add("oes-bg");
  } else if (building.id === "isa-claims-leases") {
    contentEl.classList.add("icl-bg");
  } else if (building.id === "galactic-exchange") {
    contentEl.classList.add("ge-bg");
  }

  // ISA Contracting & Assignments Bureau → redirect to Missions tab
  if (building.id === "isa-contracting-assignments") {
    showStationOverview();
    appState.missionsView = "board";
    setTab("missions");
    renderMissions(data);
    return;
  }

  if (building.id === "orbital-executive-suites") {
    contentEl.innerHTML = renderOrbitalExecutiveSuites(building, data);
    bindOfficeActions(building, data);
  } else if (building.id === "isa-claims-leases") {
    if (appState.stationActiveLease) {
      const lease = (data.corp?.miningLeases || []).find((l) => l.id === appState.stationActiveLease);
      if (lease) {
        contentEl.innerHTML = renderLeaseManagement(building, lease, data);
        bindLeaseManagementActions(building, lease, data);
      } else {
        // Lease no longer found — fall back to list view
        appState.stationActiveLease = null;
        contentEl.innerHTML = renderISAClaimsLeases(building, data);
        bindISAClaimsLeasesActions(building, data);
      }
    } else {
      contentEl.innerHTML = renderISAClaimsLeases(building, data);
      bindISAClaimsLeasesActions(building, data);
    }
  } else {
    const station = getCurrentStationInfo(data);
    contentEl.innerHTML = `
      <div class="building-detail-header">
        <span class="faction-code-badge">${escapeHtml(building.factionCode)}</span>
        <h2>${escapeHtml(building.name)}</h2>
      </div>
      ${stationLocationBanner(station)}
      <p class="muted lede">${escapeHtml(building.description)}</p>
      <p class="building-flavor">${escapeHtml(building.flavor)}</p>
      <p class="muted" style="margin-top:1.5rem;">This office is not yet operational. Check back in a future update.</p>
    `;
  }
}

/*
  TODO(AB#739): Move the rendering and functionality of each building to their own dedicated file. Ensure that relevant information is being fetched from the 
  database where applicable.
*/

// ─── Orbital Executive Suites ──────────────────────────────────────────
import { numberMarkup } from "../numberChange.js"; // AB#745: marks a number that is acknowledged when it changes
export function renderOrbitalExecutiveSuites(building, data) {
  const corp = data.corp;
  const station = getCurrentStationInfo(data);
  const currentStationId = station?.id || "earth-station-prime";
  const currentBody = station?.body || corp?.location || "Earth";
  const stationId = station?.id || "earth-station-prime";
  const existingOffice = (corp.offices || []).find((o) => o.stationId === stationId);

  const headerHtml = `
    <div class="building-detail-header">
      <span class="faction-code-badge">${escapeHtml(building.factionCode)}</span>
      <h2>${escapeHtml(building.name)}</h2>
    </div>
    ${stationLocationBanner(station)}
    <p class="muted lede">${escapeHtml(building.description)}</p>
    <p class="building-flavor">${escapeHtml(building.flavor)}</p>
  `;

  if (!existingOffice) {
    return `
      ${headerHtml}
      <section id="lease-suite-box" class="form-card action-surface" style="margin-top:1.5rem;">
        <h3>Lease an Office Suite</h3>
        <p class="muted">Establish a registered corporate presence at ${escapeHtml(station?.name || "this station")} by leasing a suite. This is required before your corporation can hire personnel or engage with station services.</p>
        <dl class="kv-list" style="margin:0.9rem 0;">
          <dt>Lease Cost</dt><dd>${toCurrency(officeLeaseCost(1))} credits a day</dd>
          <dt>Station</dt><dd>${escapeHtml(station?.name || stationId)}</dd>
          <dt>Location</dt><dd>${escapeHtml(currentBody)}, ${escapeHtml(formatSystemLabel(station?.systemId || "sol"))}</dd>
        </dl>
        <p class="muted">The lease runs for the term you choose and can be extended from this office before or after it ends. Without an active office you cannot start a mining cycle.</p>
        <div class="inline-form compact-action-form">
          <label>
            Term
            <select id="rent-office-duration">
              ${OFFICE_TERMS_DAYS.map((days) => `<option value="${days}">${days} days — ${toCurrency(officeLeaseCost(days))}</option>`).join("")}
            </select>
          </label>
          <button id="rent-office-btn" class="btn btn-accent" type="button">Execute Lease Agreement</button>
        </div>
        <p id="rent-office-status" class="muted action-hint"></p>
      </section>
    `;
  }

  const rentedDate = new Date(existingOffice.rentedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric"
  });
  const availableStaffCapacity = Math.max(1, corp.employeeCap - corp.employeeCount);

  const now = Date.now();
  const rentedUntil = existingOffice.rentedUntil || 0;
  const leaseExpired = rentedUntil <= now;
  const msRemaining = Math.max(0, rentedUntil - now);
  const daysRemaining = msRemaining / 86_400_000;
  const fullDays = Math.floor(daysRemaining);
  const hoursRemaining = Math.floor((msRemaining % 86_400_000) / 3_600_000);
  const expiryDate = new Date(rentedUntil).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
  const leaseStatusBadge = leaseExpired
    ? `<span class="building-status-badge downtime">Expired</span>`
    : `<span class="building-status-badge operational">Active Lease</span>`;
  const timeRemainingText = leaseExpired
    ? `<span style="color:var(--red,#f44);">Lease expired</span>`
    : `${fullDays}d ${hoursRemaining}h remaining`;

  return `
    ${headerHtml}

    <section class="form-card" style="margin-top:1.5rem;max-width:750px;">
      <h3>Office Status</h3>
      <dl class="kv-list kv-list--compact">
        <dt>Status</dt><dd>${leaseStatusBadge}</dd>
        <dt>Station</dt><dd>${escapeHtml(existingOffice.name)}</dd>
        <dt>Location</dt><dd>${escapeHtml(existingOffice.body)}, ${escapeHtml(formatSystemLabel(existingOffice.systemId || "sol"))}</dd>
        <dt>Lease Commenced</dt><dd>${rentedDate}</dd>
        <dt>Lease Expires</dt><dd>${expiryDate}</dd>
        <dt>Time Remaining</dt><dd>${timeRemainingText}</dd>
      </dl>
    </section>

    <section class="form-card action-surface" style="margin-top:1rem;max-width:750px;">
      <h3>${leaseExpired ? "Renew Expired Lease" : "Extend Lease"}</h3>
      <p class="muted">${leaseExpired ? "Your office lease has expired. Renew to restore access to station services." : "Extend your current lease term. The additional days will be added to your existing expiry date."}</p>
      <form id="renew-office-form" class="inline-form compact-action-form">
        <label>
          Duration
          <select id="renew-office-duration">
            ${[7, 14, 21, 28].map((days) => `<option value="${days}"${days === 28 ? " selected" : ""}>${days} days — ${toCurrency(officeRenewalCost(corp.completedInsights, days))}</option>`).join("")}
          </select>
        </label>
        <button class="btn btn-accent" type="submit">${leaseExpired ? "Renew Lease" : "Extend Lease"}</button>
      </form>
      <p id="renew-office-status" class="muted action-hint"></p>
    </section>

    <section class="form-card action-surface" style="margin-top:1rem;max-width:750px;">
      <h3>Workforce — Hire Personnel</h3>
      <p class="muted">Recruit employees through your registered office. Each hire costs ${toCurrency(clientPrices(appState.economy).hireCost)} credits and adds ${toCurrency(clientPrices(appState.economy).payrollPerDay)}/day to operational payroll.</p>
      <form id="office-hire-form" class="inline-form compact-action-form">
        <label>
          Head Count
          <input id="office-hire-count" type="number" min="1" max="${availableStaffCapacity}" value="1" />
        </label>
        <button class="btn btn-accent" type="submit">Hire Personnel</button>
      </form>
      <p id="office-hire-hint" class="muted action-hint">Available headroom: ${corp.employeeCap - corp.employeeCount} position(s). Staffing: ${numberMarkup("station:staffing", corp.employeeCount)} / ${corp.employeeCap}.</p>
      <p id="office-hire-status" class="muted"></p>
    </section>

    <section class="form-card" style="margin-top:1rem;max-width:750px;">
      <h3>Station Services</h3>
      <p class="muted">Visit the ISA Claims &amp; Leases Division to file extraction rights applications. Each station's claims office files leases on the body it orbits.</p>
    </section>
  `;
}

export function bindOfficeActions(building, data) {
  const rentBtn = document.getElementById("rent-office-btn");
  if (rentBtn) {
    rentBtn.addEventListener("click", async () => {
      const statusEl = document.getElementById("rent-office-status");
      const corp = appState.data?.corp;
      const currentStationId = corp?.currentStationId || "earth-station-prime";
      const station = appState.stationRegistry.find((s) => s.id === currentStationId) || appState.stationRegistry[0];
      const durationDays = Number(document.getElementById("rent-office-duration")?.value) || OFFICE_TERMS_DAYS[0];

      rentBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Processing lease agreement...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/rent-office`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stationId: station?.id || "earth-station-prime", durationDays }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          showStationBuilding(building.id);
          // AB#1056: hiring is the next thing to do, and on a phone its form sat a screen and a half down
          revealUnderHeader(document.getElementById("office-hire-form")?.closest(".form-card"));
        } else {
          const cost = officeLeaseCost(durationDays);
          if ((appState.data.corp.finances.credits || 0) < cost) {
            throw new Error(`Leasing requires ${toCurrency(cost)} credits. Current reserves: ${toCurrency(appState.data.corp.finances.credits)}.`);
          }
          if (!Array.isArray(appState.data.corp.offices)) appState.data.corp.offices = [];
          appState.data.corp.finances.credits -= cost;
          appState.data.corp.offices.push({
            stationId: station?.id || "earth-station-prime",
            name: station?.name || "Earth Station Prime",
            body: station?.body || corp?.location || "Earth", // AB#1825: as renderOrbitalExecutiveSuites derives it
            systemId: station?.systemId || "sol",
            tier: station?.tier || 1,
            rentedAt: Date.now(),
            rentedUntil: Date.now() + durationDays * 86_400_000,
            durationDays
          });
          updateAllViews();
          showStationBuilding(building.id);
        }
        pushFeedback(`Office lease confirmed at ${station?.name || "Earth Station Prime"}.`, "success");
      } catch (err) {
        rentBtn.disabled = false;
        if (statusEl) statusEl.textContent = err.message || "Lease agreement failed.";
      }
    });
  }

  const renewForm = document.getElementById("renew-office-form");
  if (renewForm) {
    renewForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const durationSelect = document.getElementById("renew-office-duration");
      const statusEl = document.getElementById("renew-office-status");
      const durationDays = Number(durationSelect?.value || 28);
      const submitBtn = renewForm.querySelector("button[type=submit]");
      const corp = appState.data?.corp;
      const currentStationId = corp?.currentStationId || "earth-station-prime";
      const station = appState.stationRegistry.find((s) => s.id === currentStationId) || appState.stationRegistry[0];

      if (submitBtn) submitBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Processing lease renewal...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/renew-office`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stationId: station?.id || "earth-station-prime", durationDays }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          showStationBuilding(building.id);
        } else {
          const renewalCost = officeRenewalCost(corp.completedInsights, durationDays);
          if ((corp.finances.credits || 0) < renewalCost) {
            throw new Error(`Renewal requires ${toCurrency(renewalCost)} credits. Current reserves: ${toCurrency(corp.finances.credits)}.`);
          }
          const office = (corp.offices || []).find((o) => o.stationId === (station?.id || "earth-station-prime"));
          if (!office) throw new Error("No office found to renew.");
          corp.finances.credits -= renewalCost;
          const now = Date.now();
          office.rentedUntil = Math.max(office.rentedUntil || now, now) + durationDays * 86_400_000;
          updateAllViews();
          showStationBuilding(building.id);
        }
        pushFeedback(`Lease extended by ${durationDays} days.`, "success");
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
        if (statusEl) statusEl.textContent = err.message || "Lease renewal failed.";
      }
    });
  }

  const hireForm = document.getElementById("office-hire-form");
  if (hireForm) {
    hireForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const countInput = document.getElementById("office-hire-count");
      const statusEl = document.getElementById("office-hire-status");
      const count = Math.max(1, Number(countInput?.value || 1));
      const submitBtn = hireForm.querySelector("button[type=submit]");

      if (submitBtn) submitBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Processing hire order...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/hire`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          showStationBuilding(building.id);
        } else {
          const corp = appState.data.corp;
          const available = Math.max(0, corp.employeeCap - corp.employeeCount);
          const hired = Math.min(count, available);
          const { hireCost, payrollPerDay } = clientPrices(appState.economy);
          const cost = hired * hireCost;
          if (hired <= 0) throw new Error("No available headroom to hire additional personnel.");
          if (corp.finances.credits < cost) throw new Error(`Hiring requires ${toCurrency(cost)} credits.`);
          corp.employeeCount += hired;
          corp.finances.credits -= cost;
          corp.finances.dailyCosts += hired * payrollPerDay;
          updateAllViews();
          showStationBuilding(building.id);
        }
        pushFeedback(`Personnel hired successfully.`, "success");
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
        if (statusEl) statusEl.textContent = err.message || "Hire action failed.";
      }
    });
  }
}

// ─── ISA Claims & Leases Division ──────────────────────────────────────────

import { employeesForNextLease } from "../leaseStaffing.js"; // AB#1202: the server's rule, not a copy of it
import { activeOfficeAt } from "../officeStatus.js"; // AB#1870: the server's rule, not a copy of it

// The bodies the ISA leases. Module level so a full lease can say which are left (Bug #1057).
export const LEASE_BODIES = [
  { body: "Earth", cost: 20000, description: "Grants two (2) on-surface building slots for Basic Extractor Yard construction. Abundant mineral and silicate deposits across diverse terrain." },
  { body: "Mars", cost: 25000, description: "Grants two (2) on-surface building slots for Basic Extractor Yard construction. Primary source of silicate deposits." },
  { body: "Luna", cost: 30000, description: "Grants two (2) on-surface building slots. Lunar regolith operations with access to Helium-3 deposits." }
];

/** The bodies this corporation has not leased yet, each with the station that files it, for public/scripts/slotAdvice.js. */
export function unleasedBodiesForPage(corp) {
  const leased = new Set((corp?.miningLeases || []).map((l) => l.body));
  return LEASE_BODIES.filter((b) => !leased.has(b.body))
    .map((b) => ({ body: b.body, station: (appState.stationRegistry || []).find((st) => st.body === b.body)?.name }))
    .filter((b) => b.station);
}

export function renderISAClaimsLeases(building, data) {
  const corp = data.corp;
  const station = getCurrentStationInfo(data);
  const stationBody = station?.body || "Earth";
  const allLeases = corp?.miningLeases || [];
  const leases = allLeases.filter((l) => l.body === stationBody);

  const headerHtml = `
    <div class="building-detail-header">
      <span class="faction-code-badge">${escapeHtml(building.factionCode)}</span>
      <h2>${escapeHtml(building.name)}</h2>
    </div>
    ${stationLocationBanner(station)}
    <p class="muted lede">${escapeHtml(building.description)}</p>
    <p class="building-flavor">${escapeHtml(building.flavor)}</p>
  `;

  const currentStationId = station?.id || "earth-station-prime";
  const hasOffice = Boolean(activeOfficeAt(corp, currentStationId, Date.now()));
  const requiredForNext = employeesForNextLease(allLeases.length);
  const currentEmployees = corp?.employeeCount || 0;

  // Active leases section
  let leasesHtml = "";
  if (leases.length === 0) {
    leasesHtml = `<p class="muted" style="margin-top:0.4rem;">${escapeHtml(claimsNoLeasesText(hasOffice))}</p>`; // Bug #1060
  } else {
    leasesHtml = `<div class="lease-card-grid">`;
    for (const lease of leases) {
      const extractorCount = (lease.extractorIds || []).length;
      const issuedDate = new Date(lease.issuedAt || Date.now()).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric"
      });
      leasesHtml += `
        <div class="lease-card">
          <div class="lease-card-header">
            <span class="lease-body-badge">${escapeHtml(lease.body)}</span>
            <span class="lease-type-label">${escapeHtml(lease.leaseType || "Silicate Extraction")}</span>
          </div>
          <dl class="kv-list kv-list--compact" style="margin:0.6rem 0;">
            <dt>Claim ID</dt><dd><code>${escapeHtml(lease.id)}</code></dd>
            <dt>Issued</dt><dd>${issuedDate}</dd>
            <dt>Building Slots</dt><dd>${extractorCount} / ${lease.buildingSlots || 2} used</dd>
          </dl>
          <button class="btn btn-outline btn-sm lease-manage-btn" data-lease-id="${escapeHtml(lease.id)}" type="button">
            Manage Lease
          </button>
        </div>
      `;
    }
    leasesHtml += `</div>`;
  }

  // Purchase section — only show bodies accessible from this station

  const ownedBodies = new Set(leases.map((l) => l.body));
  const availableBodies = LEASE_BODIES.filter((b) => b.body === stationBody && !ownedBodies.has(b.body));

  let purchaseHtml = "";
  const hasLocalBodies = LEASE_BODIES.some((b) => b.body === stationBody);

  if (!hasOffice) {
    purchaseHtml = `<p class="muted">An office at ${escapeHtml(station?.name || "this station")} is required before the ISA will process lease applications here. Visit the Orbital Executive Suites to lease one.</p>`;
  } else if (!hasLocalBodies) {
    purchaseHtml = `<p class="muted">No extraction zones are available at ${escapeHtml(station?.name || "this station")}. Travel to a station orbiting a resource-bearing body to file new lease applications.</p>`;
  } else if (availableBodies.length === 0) {
    // Bug #1060: say where the other leases are filed, by station name from the registry.
    purchaseHtml = `<p class="muted">${escapeHtml(claimsAllTakenText({
      offeredBodies: LEASE_BODIES.map((b) => b.body),
      ownedBodies: allLeases.map((l) => l.body), // every lease held, not only this station's
      stations: appState.stationRegistry || []
    }))}</p>`;
  } else {
    purchaseHtml = availableBodies.map((entry) => {
      const canAfford = (corp?.finances?.credits || 0) >= entry.cost;
      const hasEnoughStaff = currentEmployees >= requiredForNext;
      return `
        <div class="lease-purchase-block" style="margin-bottom:1.2rem;">
          <h4 style="margin:0 0 0.5rem;">${escapeHtml(entry.body)} — Silicate Extraction Lease</h4>
          <p class="muted" style="margin-bottom:0.8rem;">${escapeHtml(entry.description)}</p>
          <dl class="kv-list kv-list--compact" style="max-width:380px;margin-bottom:0.9rem;">
            <dt>Lease Cost</dt><dd>${toCurrency(entry.cost)} credits (one-time)</dd>
            <dt>Employee Requirement</dt><dd>${requiredForNext} on payroll (current: ${currentEmployees})</dd>
            <dt>Building Slots Granted</dt><dd>2 on-surface slots</dd>
          </dl>
          ${!hasEnoughStaff ? `<p class="muted action-hint" style="color:var(--warn,#f0ad4e);">Hire at least ${requiredForNext - currentEmployees} more employee(s) before filing this application.</p>` : ""}
          <button class="purchase-lease-btn btn btn-accent" type="button" data-body="${escapeHtml(entry.body)}" ${!hasEnoughStaff || !canAfford ? "disabled" : ""}>
            File Lease Application — ${escapeHtml(entry.body)}
          </button>
        </div>
      `;
    }).join("");
  }

  return `
    ${headerHtml}
    <section class="form-card" style="margin-top:1.5rem;">
      <h3>Active Mining Claims</h3>
      ${leasesHtml}
    </section>
    <section class="form-card action-surface" style="margin-top:1rem;">
      <h3>File Extraction Lease Application</h3>
      ${purchaseHtml}
    </section>
  `;
}

export function bindISAClaimsLeasesActions(building, data) {
  const contentEl = document.getElementById("station-building-content");
  if (!contentEl) return;

  // Purchase lease buttons (one per available body)
  contentEl.querySelectorAll(".purchase-lease-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const body = btn.getAttribute("data-body");
      if (!body) return;
      btn.disabled = true;
      btn.textContent = "Submitting lease application to ISA...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/purchase-lease`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ body }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          showStationBuilding(building.id);
        }
        pushFeedback(`${body} mining lease approved by the ISA.`, "success");
      } catch (err) {
        btn.disabled = false;
        btn.textContent = `File Lease Application — ${body}`;
        pushFeedback(err.message || "Lease application failed.", "warn");
      }
    });
  });

  // Manage buttons for each lease card
  contentEl.querySelectorAll(".lease-manage-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const leaseId = btn.getAttribute("data-lease-id");
      if (leaseId) {
        appState.stationActiveLease = leaseId;
        renderBuildingDetail(building, appState.data || data);
      }
    });
  });
}

/**
 * Refresh the open lease view's running figures from the latest extractors, in place, so a Start Cycle form being
 * filled in is not wiped. When an extractor changes state (a cycle ends or breaks down) the row's layout changes,
 * so the view is redrawn instead. Does nothing when no lease view is open.
 */
export function refreshOpenLeaseView(extractors) {
  const rows = document.querySelectorAll("[data-live-ex]");
  if (!rows.length) return;
  const byId = new Map((extractors || []).map((ex) => [ex.id, ex]));
  for (const row of rows) {
    const ex = byId.get(row.getAttribute("data-live-ex"));
    if (!ex || extractorState(ex) !== row.getAttribute("data-live-state")) {
      showStationBuilding("isa-claims-leases");
      return;
    }
    if (extractorState(ex) !== "active" || !ex.endsAt || !ex.startedAt) continue;
    const { pct, hrs, mins, mined, fees } = activeCycleFigures(ex);
    const set = (key, text) => { const el = row.querySelector(`[data-live="${key}"]`); if (el) el.textContent = text; };
    set("pct", `${pct}%`);
    set("left", `${hrs}h ${mins}m left`);
    set("remaining", `${hrs}h ${mins}m`);
    set("mined", mined.toLocaleString());
    set("fees", toCurrency(fees));
    const fill = row.querySelector('[data-live="fill"]');
    if (fill) fill.style.width = `${pct}%`;
  }
}

export function renderLeaseManagement(building, lease, data) {
  const corp = data.corp;
  const extractors = (corp?.mining?.silicateExtractors || []).filter((ex) => ex.leaseId === lease.id);
  const usedSlots = extractors.length;
  const totalSlots = lease.buildingSlots || 2;
  const hasSlotAvailable = usedSlots < totalSlots;
  const buildCost = clientPrices(appState.economy).extractorYardCost;
  const canAffordBuild = (corp?.finances?.credits || 0) >= buildCost;

  const issuedDate = new Date(lease.issuedAt || Date.now()).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric"
  });

  // Extractor list
  let extractorRows = "";
  for (const ex of extractors) {
    let statusClass = "idle";
    if (ex.downtimeActive) {
      statusClass = "downtime";
    } else if (ex.active) {
      statusClass = "active";
    }
    let cycleInfo = "";
    let progressBarHtml = "";

    if (ex.downtimeActive) {
      const downtimeStart = Number(ex.downtimeStartedAt || Date.now());
      const now = Date.now();
      const downtimeDur = now - downtimeStart;
      const dtHrs = Math.floor(downtimeDur / 3_600_000);
      const dtMins = Math.floor((downtimeDur % 3_600_000) / 60_000);

      // Show where the mining cycle was paused
      let cyclePct = 0;
      let cycleRemaining = "";
      let cycleElapsed = "";
      if (ex.endsAt && ex.startedAt) {
        const cycleDuration = ex.endsAt - ex.startedAt;
        const elapsedBeforeDowntime = Math.min(downtimeStart - ex.startedAt, cycleDuration);
        cyclePct = cycleDuration > 0 ? Math.min(100, Math.round((elapsedBeforeDowntime / cycleDuration) * 100)) : 0;
        const remainMs = Math.max(0, cycleDuration - elapsedBeforeDowntime);
        const remHrs = Math.floor(remainMs / 3_600_000);
        const remMins = Math.floor((remainMs % 3_600_000) / 60_000);
        const elapHrs = Math.floor(elapsedBeforeDowntime / 3_600_000);
        const elapMins = Math.floor((elapsedBeforeDowntime % 3_600_000) / 60_000);
        cycleRemaining = `${remHrs}h ${remMins}m remaining when halted`;
        cycleElapsed = `${elapHrs}h ${elapMins}m elapsed before shutdown`;
      }

      cycleInfo = `<span class="extractor-cycle-status downtime">Equipment Offline &mdash; Down for ${dtHrs}h ${dtMins}m</span>`;
      progressBarHtml = `
        <div class="extractor-progress-wrap">
          <div class="extractor-progress-header">
            <span class="extractor-progress-pct">${cyclePct}% (paused)</span>
            <span class="extractor-progress-time">${cycleRemaining}</span>
          </div>
          <div class="extractor-progress-track">
            <div class="extractor-progress-fill downtime" style="width:${cyclePct}%"></div>
          </div>
          <div class="extractor-stat-row">
            <span class="extractor-stat"><span class="extractor-stat-label">Cycle progress</span><span class="extractor-stat-value">${cycleElapsed}</span></span>
            <span class="extractor-stat"><span class="extractor-stat-label">Downtime elapsed</span><span class="extractor-stat-value">${dtHrs}h ${dtMins}m</span></span>
            <span class="extractor-stat"><span class="extractor-stat-label">Mined before halt</span><span class="extractor-stat-value">${(ex.minedThisCycle || 0).toLocaleString()}</span></span>
          </div>
        </div>
      `;
    } else if (ex.active && ex.endsAt && ex.startedAt) {
      // Bug #1091: the figures come from public/scripts/leaseLive.js, and carry data-live so mining:updated can refresh
      // them in place while the view stays open.
      const { pct, hrs, mins, mined, fees: estimatedFees } = activeCycleFigures(ex);

      cycleInfo = `<span class="extractor-cycle-status">${ex.throughputPerHour} t/h &mdash; <span data-live="remaining">${hrs}h ${mins}m</span> remaining</span>`;
      progressBarHtml = `
        <div class="extractor-progress-wrap">
          <div class="extractor-progress-header">
            <span class="extractor-progress-pct" data-live="pct">${pct}%</span>
            <span class="extractor-progress-time" data-live="left">${hrs}h ${mins}m left</span>
          </div>
          <div class="extractor-progress-track">
            <div class="extractor-progress-fill" data-live="fill" style="width:${pct}%"></div>
          </div>
          <div class="extractor-stat-row">
            <span class="extractor-stat"><span class="extractor-stat-label">Mined this cycle</span><span class="extractor-stat-value" data-live="mined">${mined.toLocaleString()}</span></span>
            <span class="extractor-stat"><span class="extractor-stat-label">Fees incurred</span><span class="extractor-stat-value" data-live="fees">${toCurrency(estimatedFees)}</span></span>
            <span class="extractor-stat"><span class="extractor-stat-label">Rate</span><span class="extractor-stat-value">${ex.throughputPerHour} t/h</span></span>
          </div>
        </div>
      `;
    } else if (ex.totalMined > 0) {
      cycleInfo = `<span class="extractor-cycle-status idle">Idle &mdash; ${ex.totalMined.toLocaleString()} t extracted lifetime</span>`;
    } else {
      cycleInfo = `<span class="extractor-cycle-status idle">Idle &mdash; no cycle history</span>`;
    }

    const mineFormId = `mine-form-${ex.id}`;
    const mineFormHtml = !ex.active
      ? `<form class="inline-form compact-action-form lease-mine-form" id="${escapeHtml(mineFormId)}" data-extractor-id="${escapeHtml(ex.id)}" style="margin-top:0.5rem;">
          <label>Throughput (t/h)<input type="number" name="amount" min="10" max="250" value="40" style="width:72px;" /></label>
          <label>Duration (hrs)<input type="number" name="hours" min="1" max="72" value="24" style="width:60px;" /></label>
          <button class="btn btn-accent btn-sm" type="submit">Start Cycle</button>
        </form>
        <p class="muted action-hint lease-mine-projection" data-for="${escapeHtml(ex.id)}">${escapeHtml(mineProjectionText(40))}</p>
        <p class="muted action-hint lease-mine-status" data-for="${escapeHtml(ex.id)}"></p>`
      : "";

    // AB#1052: a Stop control on a running cycle (including one paused in downtime, since that is still
    // extractor.active — see server/game/mining.js). It ends the cycle now, keeping what has been mined.
    const stopButtonHtml = ex.active
      ? `<button type="button" class="btn btn-outline btn-sm lease-stop-btn" data-extractor-id="${escapeHtml(ex.id)}" data-extractor-name="${escapeHtml(ex.name)}" style="margin-top:0.5rem;">Stop Cycle</button>
        <p class="muted action-hint lease-stop-status" data-for="${escapeHtml(ex.id)}"></p>`
      : "";

    const mineFormVisible = !ex.active && !ex.downtimeActive;
    extractorRows += `
      <div class="extractor-row ${statusClass}" data-live-ex="${escapeHtml(ex.id)}" data-live-state="${extractorState(ex)}">
        <div class="extractor-row-header">
          <strong>${escapeHtml(ex.name)}</strong>
          <span class="building-status-badge ${statusClass}">${ex.downtimeActive ? "Downtime" : (ex.active ? "Active" : "Idle")}</span>
        </div>
        ${ex.downtimeActive ? cycleInfo : (ex.active ? "" : cycleInfo)}
        ${progressBarHtml}
        ${mineFormVisible ? mineFormHtml : ""}
        ${ex.active ? stopButtonHtml : ""}
      </div>
    `;
  }

  const extractorSection = extractors.length === 0
    ? `<p class="muted" style="margin-top:0.4rem;">No extraction facilities on this claim yet. Commission a yard below to begin operations.</p>`
    : `<div class="extractor-list">${extractorRows}</div>`;

  const buildSection = hasSlotAvailable
    ? `<div class="lease-purchase-block" style="margin-top:0.6rem;">
        <h4 style="margin:0 0 0.4rem;">Commission Basic Extractor Yard</h4>
        <p class="muted" style="margin-bottom:0.7rem;">Deploys an extraction facility to this lease's surface allocation. Slot usage: ${usedSlots}/${totalSlots}.</p>
        <dl class="kv-list kv-list--compact" style="max-width:360px;margin-bottom:0.8rem;">
          <dt>Construction Cost</dt><dd>${toCurrency(buildCost)} credits</dd>
          <dt>Asset Value</dt><dd>${toCurrency(clientPrices(appState.economy).extractorYardAssetValue)} credits</dd>
        </dl>
        <button id="lease-build-extractor-btn" class="btn btn-accent" type="button" ${!canAffordBuild ? "disabled" : ""}>
          Commission Extractor Yard
        </button>
        <p id="lease-build-extractor-status" class="muted action-hint"></p>
      </div>`
    : `<p class="muted" style="margin-top:0.6rem;">This lease's building slots are fully allocated (${usedSlots}/${totalSlots}). ${escapeHtml(leaseFullAdvice(corp, lease, unleasedBodiesForPage(corp)))}</p>`;

  const station = getCurrentStationInfo(data);

  return `
    <div class="building-detail-header">
      <span class="faction-code-badge">${escapeHtml(building.factionCode)}</span>
      <h2>Mining Lease — ${escapeHtml(lease.body)}</h2>
    </div>
    ${stationLocationBanner(station)}
    <button id="lease-back-btn" class="btn btn-outline btn-sm" type="button" style="margin-bottom:1.2rem;">&#8592; Back to Claims &amp; Leases</button>

    <section class="form-card lease-management-card" style="margin-top:0;">
      <h3>Lease Details</h3>
      <dl class="kv-list kv-list--compact">
        <dt>Claim ID</dt><dd><code>${escapeHtml(lease.id)}</code></dd>
        <dt>Body</dt><dd>${escapeHtml(lease.body)}</dd>
        <dt>Lease Type</dt><dd>${escapeHtml(lease.leaseType || "Silicate Extraction")}</dd>
        <dt>Issued</dt><dd>${issuedDate}</dd>
        <dt>Building Slots</dt><dd>${usedSlots} / ${totalSlots} used</dd>
      </dl>
    </section>

    <section class="form-card lease-management-card" style="margin-top:1rem;">
      <h3>Extraction Facilities</h3>
      ${extractorSection}
    </section>

    <section class="form-card action-surface lease-management-card" style="margin-top:1rem;">
      <h3>Commission Infrastructure</h3>
      ${buildSection}
    </section>
  `;
}

export function bindLeaseManagementActions(building, lease, data) {
  const backBtn = document.getElementById("lease-back-btn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      appState.stationActiveLease = null;
      renderBuildingDetail(building, appState.data || data);
    });
  }

  const buildBtn = document.getElementById("lease-build-extractor-btn");
  if (buildBtn) {
    buildBtn.addEventListener("click", async () => {
      const statusEl = document.getElementById("lease-build-extractor-status");
      buildBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Commissioning extraction facility...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/lease/${encodeURIComponent(lease.id)}/build-extractor`,
            { method: "POST" }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          renderBuildingDetail(building, appState.data);
        } else {
          // Demo account fallback
          const corp = appState.data.corp;
          const { extractorYardCost: cost, extractorYardAssetValue } = clientPrices(appState.economy);
          if ((corp.finances.credits || 0) < cost) throw new Error(`Construction requires ${toCurrency(cost)} credits.`);
          if (!Array.isArray(corp.mining.silicateExtractors)) corp.mining.silicateExtractors = [];
          const nextIndex = corp.mining.silicateExtractors.length + 1;
          const newId = `ext-basic-${nextIndex}`;
          corp.buildings.push({ name: "Basic Extractor Yard", tier: 1, status: "Operational" });
          corp.mining.silicateExtractors.push({
            id: newId, name: `Basic Extractor Yard #${nextIndex}`, tier: 1, active: false,
            startedAt: null, lastTickAt: null, endsAt: null, throughputPerHour: 0,
            operationCostPerHour: 0, totalMined: 0, totalSpent: 0, lastCompletedAt: null, leaseId: lease.id
          });
          const leaseObj = corp.miningLeases.find((l) => l.id === lease.id);
          if (leaseObj) { if (!Array.isArray(leaseObj.extractorIds)) leaseObj.extractorIds = []; leaseObj.extractorIds.push(newId); }
          corp.finances.credits -= cost;
          corp.finances.assets = (corp.finances.assets || 0) + extractorYardAssetValue;
          updateAllViews();
          const updatedLease = corp.miningLeases.find((l) => l.id === lease.id);
          renderBuildingDetail(building, appState.data);
        }
        pushFeedback("Basic Extractor Yard commissioned and linked to lease.", "success");
      } catch (err) {
        buildBtn.disabled = false;
        // If the server can't find the lease (e.g. server restarted and lost in-memory state),
        // the client state is stale. Clear it and send the user back to the list view.
        if (err.message && err.message.includes("could not be found")) {
          appState.stationActiveLease = null;
          pushFeedback("Session state out of sync — please re-purchase your lease.", "error");
          renderBuildingDetail(building, appState.data);
          return;
        }
        if (statusEl) statusEl.textContent = err.message || "Construction failed.";
      }
    });
  }

  // ISP-86: what an hour at the chosen rate earns after its running cost, shown before the cycle starts. The
  // running cost rises faster than the rate, so the top of the range is no longer the answer to everything and
  // the player can see that while they are choosing rather than afterwards.
  const showMineProjection = (form) => {
    const line = form.parentElement?.querySelector(`.lease-mine-projection[data-for="${CSS.escape(form.getAttribute("data-extractor-id") || "")}"]`);
    if (!line) return;
    const rate = Math.max(10, Math.min(250, Number(form.querySelector('[name="amount"]')?.value || 40)));
    line.textContent = mineProjectionText(rate);
  };

  // Mining cycle forms
  document.querySelectorAll(".lease-mine-form").forEach((form) => {
    showMineProjection(form);
    form.querySelector('[name="amount"]')?.addEventListener("input", () => showMineProjection(form));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const extractorId = form.getAttribute("data-extractor-id");
      const amount = Number(form.querySelector('[name="amount"]')?.value || 40);
      const hours = Number(form.querySelector('[name="hours"]')?.value || 24);
      const statusEl = document.querySelector(`.lease-mine-status[data-for="${CSS.escape(extractorId)}"]`);
      const submitBtn = form.querySelector("button[type=submit]");
      if (submitBtn) submitBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Initiating mining cycle...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/lease/${encodeURIComponent(lease.id)}/start-mining`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ extractorId, amount, hours }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          renderBuildingDetail(building, appState.data);
        } else {
          // Demo fallback
          const corp = appState.data.corp;
          const throughputPerHour = Math.max(10, Math.min(250, amount));
          // ISP-86: the same curve the server charges, from the server's own constants.
          const operations = appState.economy?.operations;
          const operationCostPerHour = costPerHourFor(throughputPerHour, operations);
          const startupCost = clientStartupCostFor(operationCostPerHour, operations);
          if ((corp.finances.credits || 0) < startupCost) throw new Error(`Startup requires ${toCurrency(startupCost)} credits.`);
          const ex = corp.mining.silicateExtractors.find((e) => e.id === extractorId);
          if (!ex) throw new Error("Extractor not found.");
          if (ex.active) throw new Error("Extractor already has an active cycle.");
          const now = Date.now();
          corp.finances.credits -= startupCost;
          ex.active = true; ex.startedAt = now; ex.lastTickAt = now;
          ex.endsAt = now + hours * 3_600_000;
          ex.throughputPerHour = throughputPerHour;
          ex.operationCostPerHour = operationCostPerHour;
          ex.totalSpent += startupCost;
          updateAllViews();
          renderBuildingDetail(building, appState.data);
        }
        pushFeedback("Mining cycle started.", "success");
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
        if (statusEl) statusEl.textContent = err.message || "Mining cycle failed to start.";
      }
    });
  });

  // AB#1052: stop a running cycle early, keeping what has been mined and settling the cost for the time used.
  document.querySelectorAll(".lease-stop-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const extractorId = btn.getAttribute("data-extractor-id");
      const extractorName = btn.getAttribute("data-extractor-name") || "This extractor";
      const statusEl = document.querySelector(`.lease-stop-status[data-for="${CSS.escape(extractorId)}"]`);

      const confirmed = await showTradeConfirmation({
        heading: "Stop Mining Cycle",
        title: `Stop ${extractorName}?`,
        confirmLabel: "Stop Cycle",
        rows: [
          { label: "Extractor", value: extractorName },
          { label: "What happens", value: "Ends the cycle now. Silicates mined so far are kept; running costs stop." }
        ]
      });
      if (!confirmed) return;

      btn.disabled = true;
      if (statusEl) statusEl.textContent = "Stopping mining cycle...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/lease/${encodeURIComponent(lease.id)}/stop-mining`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ extractorId }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          renderBuildingDetail(building, appState.data);
        } else {
          // Demo fallback: settle the elapsed time the same way the server would, then stop.
          const corp = appState.data.corp;
          const ex = corp.mining.silicateExtractors.find((e) => e.id === extractorId);
          if (!ex) throw new Error("Extractor not found.");
          if (!ex.active) throw new Error("This extractor has no mining cycle running.");
          const now = Date.now();
          const elapsedHours = Math.max(0, (Math.min(now, ex.endsAt || now) - (ex.lastTickAt || ex.startedAt || now)) / 3_600_000);
          const mined = Math.floor(elapsedHours * (ex.throughputPerHour || 0));
          const cost = Math.floor(elapsedHours * (ex.operationCostPerHour || 0));
          ex.minedThisCycle = (ex.minedThisCycle || 0) + mined;
          ex.totalMined = (ex.totalMined || 0) + mined;
          corp.finances.credits = Math.max(0, (corp.finances.credits || 0) - cost);
          ex.totalSpent = (ex.totalSpent || 0) + cost;
          ex.active = false;
          ex.endsAt = now;
          ex.lastTickAt = now;
          ex.lastCompletedAt = now;
          updateAllViews();
          renderBuildingDetail(building, appState.data);
        }
        pushFeedback("Mining cycle stopped.", "success");
      } catch (err) {
        btn.disabled = false;
        if (statusEl) statusEl.textContent = err.message || "Could not stop the mining cycle.";
      }
    });
  });
}

export function renderStation(data) {
  const header = document.getElementById("station-location-header");
  const npcGrid = document.getElementById("station-npc-buildings");
  const playerGrid = document.getElementById("station-player-buildings");
  const travelBanner = document.getElementById("station-travel-banner");
  const overviewView = document.getElementById("station-overview-view");
  if (!header || !npcGrid || !playerGrid) return;

  const corp = data.corp || {};
  const currentStationId = corp.currentStationId;

  // If player is not docked, show an in-space message
  if (!currentStationId) {
    const systemId = corp.currentSystemId || "sol";
    header.innerHTML = `
      <p class="overline">IN OPEN SPACE</p>
      <h2>${escapeHtml(formatSystemLabel(systemId))} System</h2>
      <p class="muted lede">You are not docked at any station. Use the Travel tab or Starmap to dock at a station in this system.</p>
    `;
    npcGrid.innerHTML = "";
    playerGrid.innerHTML = "";
    const facSection = document.getElementById("station-facilities-section");
    if (facSection) facSection.hidden = true;
    if (travelBanner) travelBanner.hidden = true;
    if (overviewView) overviewView.hidden = false;
    return;
  }

  const station = appState.stationRegistry.find((s) => s.id === currentStationId) || appState.stationRegistry[0];

  // Always show station content (travel lockdown handled by tab system now)
  if (travelBanner) travelBanner.hidden = true;
  // Only restore overview if no building detail is currently open
  const buildingDetailView = document.getElementById("station-building-view");
  const buildingDetailOpen = buildingDetailView && !buildingDetailView.hidden;
  if (overviewView && !buildingDetailOpen) overviewView.hidden = false;

  if (!station) {
    header.innerHTML = `<h2>Station</h2><p class="muted">No station data available for your current location.</p>`;
    return;
  }

  header.innerHTML = `
    <p class="overline">${escapeHtml(station.designation)} &#47;&#47; ${escapeHtml(station.systemId.toUpperCase())}</p>
    <h2>${escapeHtml(station.name)}</h2>
    ${stationStartPromptHtml(corp)}
    <p class="muted lede">${escapeHtml(station.description)}</p>
  `;

  // ── Station buildings ──
  const stationBuildings = station.buildingIds
    .map((id) => appState.buildingRegistry.find((b) => b.id === id))
    .filter(Boolean);

  npcGrid.innerHTML = stationBuildingCardsHtml(stationBuildings);

  // ── Operational Facilities (Assembly, Refinery — prominent usable cards, and Construct) ──
  // Bug #1253: rendered and bound in one place, stationFacilities.js.
  renderStationFacilities(document, data.corp, {
    accountId: () => appState.accountId,
    request: async (path, init) => parseJsonResponse(await apiFetch(path, init)),
    onEnter: (name) => {
      if (name === "Assembly Facility") renderAssemblyFacility(data);
      else if (name === "Refinery") setTab("refinery");
    },
    onBuilt: (account) => {
      appState.data = deepClone(account.state);
      updateAllViews();
      pushFeedback("Assembly Facility online. Enter it to fabricate Mining Probes.", "ok");
    },
    onError: (error) => pushFeedback(error.message || "Construction failed.", "warn")
  }, clientPrices(appState.economy).assemblyFacilityCost);

  // ── Licensed Corporate Holdings (Extractor Yards — filtered to current station body) ──
  const stationBody = station.body;
  const leases = data.corp?.miningLeases || [];
  const leasesAtStation = leases.filter((l) => l.body === stationBody);
  const leaseIdsAtStation = new Set(leasesAtStation.map((l) => l.id));

  // Count extractors at this station via their lease linkage. Only show
  // extractors whose lease body matches the current station's body.
  const allExtractors = data.corp?.mining?.silicateExtractors || [];
  const displayExtractors = allExtractors.filter(
    (ex) => ex.leaseId && leaseIdsAtStation.has(ex.leaseId)
  );

  const extractorBuildingCount = displayExtractors.length;

  if (!extractorBuildingCount) {
    playerGrid.innerHTML = `<p class="muted">No extractor yards deployed at ${escapeHtml(station.name)}. Yards are linked to mining leases on ${escapeHtml(stationBody)}.</p>`;
  } else {
    playerGrid.innerHTML = displayExtractors
      .map(
        (ex) => {
          const statusText = ex.active ? "Active" : "Idle";
          const statusClass = ex.active ? "operational" : "idle";
          return `
            <article class="building-card data-card">
              <header class="building-card-header">
                <span class="faction-code-badge corp-badge">CORP</span>
                <h3>${escapeHtml(ex.name || "Basic Extractor Yard")}</h3>
              </header>
              <p class="muted">Tier ${ex.tier || 1} &mdash; <span class="building-status-badge ${statusClass}">${statusText}</span></p>
              <footer class="building-card-footer"></footer>
            </article>
          `;
        }
      )
      .join("");
  }
}

export function renderAssemblyFacility(data) {
  const overviewView = document.getElementById("station-overview-view");
  const buildingView = document.getElementById("station-building-view");
  const contentEl = document.getElementById("station-building-content");
  if (!contentEl || !buildingView) return;

  if (overviewView) overviewView.hidden = true;
  buildingView.hidden = false;
  contentEl.classList.remove("ge-bg", "icl-bg", "oes-bg");

  const am = data.corp?.asteroidMining || {};
  const probeCount = am.probeCount || 0;
  const fleet = data.corp?.fleet || { cap: 2, vessels: probeCount, full: probeCount >= 2, raiseText: "" }; // Bug #586
  const hasProspecting = (data.corp?.unlockedTech || []).includes("tt-asteroid-prospecting");
  const station = getCurrentStationInfo(data);

  let probeSection = "";
  if (!hasProspecting) {
    probeSection = `<p class="muted">Research <em>Asteroid Prospecting Arrays</em> to unlock Mining Probe fabrication.</p>`;
  } else {
    const fabQueue = am.fabricationQueue || [];
    const activeFab = fabQueue[0] || null;
    const pendingCount = fabQueue.length;
    const canBuild = !fleet.full && !activeFab;
    const deployedCount = (am.activeExpeditions || []).length;

    let fabProgressHtml = "";
    if (activeFab) {
      const elapsed = Date.now() - activeFab.startedAt;
      const total = activeFab.completesAt - activeFab.startedAt;
      const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
      const remainMs = Math.max(0, activeFab.completesAt - Date.now());
      fabProgressHtml = `
        <div class="assembly-fab-progress" style="margin-top:0.75rem;">
          <p class="muted" style="font-size:0.8rem;">Fabricating Mining Probe &mdash; ${formatDuration(remainMs)} remaining</p>
          <div class="progress-wrap"><div class="progress-bar" id="fab-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
        </div>
      `;
    }

    probeSection = `
      <div class="assembly-probe-status">
        <img src="/images/mining_probe.png" alt="Mining Probe" class="assembly-probe-img" />
        <div>
          <p>Mining Probes: <strong>${fleet.vessels} / ${fleet.cap}</strong> Fleet Cap <span class="muted">(${probeCount} in hangar${deployedCount > 0 ? `, ${deployedCount} on expedition` : ""}${pendingCount > 0 ? `, ${pendingCount} in fabrication` : ""})</span></p>
          ${canBuild
            ? `<button id="build-probe-btn" class="btn btn-accent">Fabricate Mining Probe (¤${clientPrices(appState.economy).probeBuildCost.toLocaleString("en-US")})</button>`
            : activeFab
              ? ""
              : `<p class="muted">Your fleet is at its Fleet Cap. ${fleet.raiseText}</p>`
          }
          ${fabProgressHtml}
        </div>
      </div>
    `;
  }

  contentEl.innerHTML = `
    <div class="building-detail-header">
      <span class="faction-code-badge corp-badge">CORP</span>
      <h2>Assembly Facility</h2>
    </div>
    ${stationLocationBanner(station)}
    <p class="muted lede">A modular manufacturing bay capable of fabricating autonomous mining probes and other deployable units.</p>
    ${probeSection}
  `;

  const buildProbeBtn = contentEl.querySelector("#build-probe-btn");
  if (buildProbeBtn) {
    buildProbeBtn.addEventListener("click", async () => {
      if (!appState.accountId) return;
      try {
        const res = await apiFetch(
          `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/build-mining-probe`,
          { method: "POST", headers: { "Content-Type": "application/json" } }
        );
        const account = await parseJsonResponse(res);
        appState.data = deepClone(account.state);
        updateAllViews();
        renderAssemblyFacility(appState.data);
        // AB#1257: it said "fabricated" here, 30 minutes before the probe existed; that line now comes on completion.
        pushFeedback(probeFabricationStartedText(appState.data?.corp?.asteroidMining?.fabricationQueue), "ok");
      } catch (err) {
        pushFeedback(err.message || "Probe fabrication failed.", "warn");
      }
    });
  }
}

export function bindBuildingActions() {
  document.getElementById("station-npc-buildings")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-building-action]");
    if (!btn) return;
    const action = btn.dataset.buildingAction;
    if (action?.startsWith("tab:")) {
      setTab(action.slice(4));
    } else if (action?.startsWith("building:")) {
      showStationBuilding(action.slice(9));
    }
  });

  document.getElementById("station-back-btn")?.addEventListener("click", () => {
    showStationOverview();
  });

  // AB#1056: the Start here prompt opens the Suites; it has its own attribute so the walkthrough's highlight, which
  // finds the Suites card by data-building-action, still lands on the card.
  document.getElementById("station-location-header")?.addEventListener("click", (event) => {
    if (!event.target.closest("[data-start-office]")) return;
    showStationBuilding("orbital-executive-suites");
    // straight to the lease form, which sits under the Suites' description and was below the fold on a phone
    revealUnderHeader(document.getElementById("rent-office-btn")?.closest(".form-card") || document.getElementById("station-building-view"));
  });
}

/**
 * ISP-86: what an hour at this rate earns after its running cost, and what the best rate would be. Rendered into
 * the extractor row itself, because the row is rewritten whenever a cycle ticks and anything written to it
 * afterwards is wiped by the next rewrite.
 */
export function mineProjectionText(rate) {
  const economy = appState.economy;
  if (!economy?.operations) return "";
  const efficiency = miningEfficiencyOf(appState.data?.corp);
  const at = miningProjection(rate, { operations: economy.operations, unitPrice: economy.silicateUnitPrice, taxPct: economy.salesTaxPct, efficiency });
  const best = bestThroughput({ operations: economy.operations, unitPrice: economy.silicateUnitPrice, taxPct: economy.salesTaxPct, efficiency });
  const net = at.profitPerHour >= 0 ? `nets ${toCurrency(at.profitPerHour)}/hour` : `loses ${toCurrency(Math.abs(at.profitPerHour))}/hour`;
  return `At ${rate} t/h: earns ${toCurrency(at.revenuePerHour)}/hour, costs ${toCurrency(at.costPerHour)}/hour, ${net}. `
    + (best.throughputPerHour === rate
      ? "That is the best rate for your research."
      : `Best for your research: ${best.throughputPerHour} t/h, netting ${toCurrency(best.profitPerHour)}/hour.`);
}

/** What the corporation's research multiplies an hour of extraction by (ISP-86; the server applies the same two). */
export function miningEfficiencyOf(corp) {
  const tech = corp?.unlockedTech || [];
  let efficiency = 1;
  if (tech.includes("tt-basic-extraction")) efficiency *= 1.1;
  if (tech.includes("tt-supply-forecast")) efficiency *= 1.06;
  return efficiency;
}
