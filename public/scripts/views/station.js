// The Station tab and the building views it opens: the executive suites, ISA claims and leases, lease management,
// and the assembly facility.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { OFFICE_TERMS_DAYS, officeLeaseCost, officeRenewalCost } from "../ceoEffects.js";
import { isMemberStation, memberOfficeCost } from "../memberRates.js"; // ISP-212 (AB#907)
import { claimsAllTakenText, claimsNoLeasesText } from "../emptyStates.js";
import { deepClone, formatDuration, toCurrency } from "../helpers.js";
import { escapeHtml, stationBuildingCardsHtml } from "../html.js";
import { activeCycleFigures, extractorState, spentText } from "../leaseLive.js";
import { probeFabricationStartedText } from "../miningFeedback.js";
import { leaseFacilities, leaseSlotsUsed } from "../leaseSlots.js"; // ISP-98 (AB#788)
import { miningEfficiency } from "../miningEfficiency.js"; // ISP-98 (AB#788): research and a Cryo-vapor Extractor Array
import { bestThroughput, costPerHourFor, miningProjection, operationsForTier, startupCostFor as clientStartupCostFor, yardTierFor, yardUpkeepPerHourFor } from "../miningProjection.js";
import { bestRateAlongBid, hourAlongBid } from "../standingBid.js"; // AB#2480
import { clientPrices } from "../clientPrices.js";
import { leaseFullAdvice } from "../slotAdvice.js";
import { appState, techTree } from "../state.js";
import { renderStationFacilities } from "../stationFacilities.js";
import { paintStationArt, stationArtHtml } from "../stationArt.js"; // ISP-78 (AB#767)
import { renderConstructionPanel } from "../constructionPanel.js"; // ISP-95 (AB#785)
import { nextYardPriceFor } from "../yardPrice.js"; // ISP-303 (AB#2286)
import { facilityUpgradeHtml, facilityUpgradeView, upgradePath, yardUpgradeHtml, yardUpgradeView } from "../upgradeControl.js"; // ISP-103 (AB#795), ISP-102 (AB#794)
import { renderMissions } from "./assignments.js";
import { formatSystemLabel, getCurrentStationInfo, pushFeedback, revealUnderHeader, setTab, showTradeConfirmation, updateAllViews } from "./shared.js";
// AB#743: what each committing action did, from the server's answer. The view redraws after an action, so focus goes
// back to the control that was pressed if it is still there, otherwise to the one the flow continues from.
import { showActionReceipt } from "./receiptModal.js";
import { renderDevelopmentBank } from "./developmentBank.js"; // ISP-151 (AB#845)
import { renderStockExchange } from "./stockExchange.js"; // ISP-161 (AB#855)
import { openConglomerateStation, renderConglomerateBureau } from "./conglomerateBureau.js"; // ISP-200 (AB#894); ISP-213 (AB#908)
import { dockedAtOwnStationHtml } from "../conglomerateStation.js"; // ISP-213 (AB#908)
import { renderArbitrationCouncil } from "./arbitrationCouncil.js"; // ISP-243 (AB#939)
import { renderPatentOffice } from "./patentOffice.js"; // ISP-237 (AB#932)
import { renderLobbyingOffice } from "./lobbyingOffice.js"; // ISP-240 (AB#935)
const firstPresent = (...selectors) => () => selectors.map((sel) => document.querySelector(sel)).find(Boolean) || null;

// ISP-78 (AB#767): where the corporation is docked, as a line under a building's name.
function dockedHtml(station) {
  if (!station) return "";
  return `<p class="ui-screen__meta">Docked at <strong>${escapeHtml(station.name)}</strong> &mdash; ${escapeHtml(station.body)}, ${escapeHtml(formatSystemLabel(station.systemId || "sol"))}</p>`;
}

export function showStationOverview() {
  const overviewEl = document.getElementById("station-overview-view");
  const detailEl = document.getElementById("station-building-view");
  const contentEl = document.getElementById("station-building-content");
  if (overviewEl) overviewEl.hidden = false;
  if (detailEl) detailEl.hidden = true;
  if (contentEl) contentEl.classList.remove("station__art--ge", "station__art--icl", "station__art--oes");
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

/**
 * ISP-103 (AB#795), ISP-102 (AB#794): post an upgrade the player has confirmed, draw the page from the account that
 * comes back (no reload), and show the receipt. One path for a yard's row and a facility's card; the server checks
 * everything again and a refusal is shown in the control's status line.
 */
async function postUpgrade(buildingId, btn, statusEl, { redraw = () => {}, focus } = {}) {
  btn.disabled = true;
  if (statusEl) statusEl.textContent = "Upgrading...";
  try {
    const response = await apiFetch(upgradePath(appState.accountId, buildingId), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const account = await parseJsonResponse(response);
    appState.data = deepClone(account.state);
    appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
    updateAllViews();
    redraw();
    showActionReceipt(account, { returnFocusTo: focus });
  } catch (error) {
    btn.disabled = false;
    if (statusEl) statusEl.textContent = error?.message || "The upgrade was refused.";
  }
}

/** ISP-102 (AB#794): a facility card's Upgrade: confirm with the tier's before and after, then postUpgrade. */
async function upgradeFacility(buildingId) {
  const building = (appState.data?.corp?.buildings || []).find((b) => b.id === buildingId);
  const view = building ? facilityUpgradeView(building, appState.data.corp, appState.economy, appState.playerBuildings || []) : null;
  if (!view?.next || view.locked || view.blocked || !appState.accountId) return;
  const btn = document.querySelector(`[data-role="yard-upgrade"][data-upgrade-for="${CSS.escape(buildingId)}"] button`);
  const statusEl = document.querySelector(`[data-role="yard-upgrade-status"][data-for="${CSS.escape(buildingId)}"]`);
  // ISP-192 (AB#886): a tier that also takes goods says so in the cost, not only in what changes
  const goods = (view.next.goods || []).map((g) => `${Number(g.quantity).toLocaleString("en-US")} ${g.item}`).join(", ");
  const confirmed = await showTradeConfirmation({
    heading: `Upgrade ${building.name}`,
    title: `Upgrade the ${building.name} to tier ${view.next.tier}?`,
    confirmLabel: `Upgrade (${toCurrency(view.next.cost)}${goods ? ` + ${goods}` : ""})`,
    rows: [
      { label: "Cost", value: `${toCurrency(view.next.cost)}${goods ? ` and ${goods} from this station's stock` : ""}` },
      { label: "What changes", value: view.change.replace(/&times;/g, "×").replace(/&rarr;/g, "→").replace(/&middot;/g, "·") }
    ]
  });
  if (!confirmed || !btn) return;
  await postUpgrade(buildingId, btn, statusEl, { focus: firstPresent(`[data-role="yard-upgrade"][data-upgrade-for="${CSS.escape(buildingId)}"] button`, ".nav-tab[data-tab='station']") });
}

export function renderBuildingDetail(building, data) {
  const contentEl = document.getElementById("station-building-content");
  if (!contentEl) return;

  // Apply building-specific background classes
  contentEl.classList.remove("station__art--ge", "station__art--icl", "station__art--oes");
  if (building.id === "orbital-executive-suites") {
    contentEl.classList.add("station__art--oes");
  } else if (building.id === "isa-claims-leases") {
    contentEl.classList.add("station__art--icl");
  } else if (building.id === "galactic-exchange") {
    contentEl.classList.add("station__art--ge");
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
  } else if (building.id === "deep-space-development-bank") {
    const station = getCurrentStationInfo(data);
    renderDevelopmentBank(contentEl, data, `
      <div class="station__building-header">
        <span class="ui-badge">${escapeHtml(building.factionCode)}</span>
        <h2 class="station__building-title">${codeSlotHtml(`building-${building.id}`)}${escapeHtml(building.name)}</h2>
      </div>
      ${dockedHtml(station)}
      <p class="ui-screen__lede">${escapeHtml(building.description)}</p>
      <p class="station__flavor">${escapeHtml(building.flavor)}</p>`);
  } else if (building.id === "intergalactic-stock-exchange") {
    const station = getCurrentStationInfo(data);
    renderStockExchange(contentEl, `
      <div class="station__building-header">
        <span class="ui-badge">${escapeHtml(building.factionCode)}</span>
        <h2 class="station__building-title">${codeSlotHtml(`building-${building.id}`)}${escapeHtml(building.name)}</h2>
      </div>
      ${dockedHtml(station)}
      <p class="ui-screen__lede">${escapeHtml(building.description)}</p>`);
  } else if (building.id === "corporate-registry-charters") {
    // ISP-237 (AB#932): the Registry's patent office
    const station = getCurrentStationInfo(data);
    renderPatentOffice(contentEl, `
      <div class="station__building-header">
        <span class="ui-badge">${escapeHtml(building.factionCode)}</span>
        <h2 class="station__building-title">${codeSlotHtml(`building-${building.id}`)}${escapeHtml(building.name)}</h2>
      </div>
      ${dockedHtml(station)}
      <p class="ui-screen__lede">Patents are filed here: the first corporation to complete a research node or refinery chain may patent it, and every other corporation that uses it pays a royalty while the patent runs.</p>`);
  } else if (building.id === "earth-assembly" || building.id === "interplanetary-trade-commission") {
    // ISP-240 (AB#935): the faction's lobbying office: standing, the rules in force, campaigns and pledges
    const station = getCurrentStationInfo(data);
    renderLobbyingOffice(contentEl, building.id, `
      <div class="station__building-header">
        <span class="ui-badge">${escapeHtml(building.factionCode)}</span>
        <h2 class="station__building-title">${codeSlotHtml(`building-${building.id}`)}${escapeHtml(building.name)}</h2>
      </div>
      ${dockedHtml(station)}
      <p class="ui-screen__lede">${escapeHtml(building.description)}</p>
      <p class="station__flavor">${escapeHtml(building.flavor)}</p>`);
  } else if (building.id === "galactic-arbitration-council") {
    // ISP-243 (AB#939): the Council's chambers: filing, your cases and the docket
    const station = getCurrentStationInfo(data);
    renderArbitrationCouncil(contentEl, `
      <div class="station__building-header">
        <span class="ui-badge">${escapeHtml(building.factionCode)}</span>
        <h2 class="station__building-title">${codeSlotHtml(`building-${building.id}`)}${escapeHtml(building.name)}</h2>
      </div>
      ${dockedHtml(station)}
      <p class="ui-screen__lede">${escapeHtml(building.description)}</p>
      <p class="station__flavor">${escapeHtml(building.flavor)}</p>`);
  } else if (building.id === "conglomerate-affairs-bureau") {
    const station = getCurrentStationInfo(data);
    renderConglomerateBureau(contentEl, data, `
      <div class="station__building-header">
        <span class="ui-badge">${escapeHtml(building.factionCode)}</span>
        <h2 class="station__building-title">${codeSlotHtml(`building-${building.id}`)}${escapeHtml(building.name)}</h2>
      </div>
      ${dockedHtml(station)}
      <p class="ui-screen__lede">${escapeHtml(building.description)}</p>`);
  } else {
    const station = getCurrentStationInfo(data);
    contentEl.innerHTML = `
      <div class="station__building-header">
        <span class="ui-badge">${escapeHtml(building.factionCode)}</span>
        <h2 class="station__building-title">${codeSlotHtml(`building-${building.id}`)}${escapeHtml(building.name)}</h2>
      </div>
      ${dockedHtml(station)}
      <p class="ui-screen__lede">${escapeHtml(building.description)}</p>
      <p class="station__flavor">${escapeHtml(building.flavor)}</p>
      <p class="station__note">This office is not yet operational. Check back in a future update.</p>
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
  // ISP-212 (AB#907): at its own conglomerate's station a member pays the member rate, which the server charges too
  const memberStation = appState.conglomerate?.station || null;
  const rate = (cost) => memberOfficeCost(cost, memberStation, stationId);
  const memberNote = isMemberStation(memberStation, stationId)
    ? `<p class="station__note station__member-rate">Member rate: your conglomerate's station, so the rent is ${memberStation.officeRentPct}% of the standard ${toCurrency(officeLeaseCost(1))} a day.</p>`
    : "";

  const headerHtml = `
    <div class="station__building-header">
      <span class="ui-badge">${escapeHtml(building.factionCode)}</span>
      <h2 class="station__building-title">${codeSlotHtml(`building-${building.id}`)}${escapeHtml(building.name)}</h2>
    </div>
    ${dockedHtml(station)}
    <p class="ui-screen__lede">${escapeHtml(building.description)}</p>
    <p class="station__flavor">${escapeHtml(building.flavor)}</p>
  `;

  if (!existingOffice) {
    return `
      ${headerHtml}
      <section id="lease-suite-box" class="ui-panel station__panel">
        <h3>${codeSlotHtml("suites-lease")}Lease an Office Suite</h3>
        <p class="station__note">Establish a registered corporate presence at ${escapeHtml(station?.name || "this station")} by leasing a suite. This is required before your corporation can hire personnel or engage with station services.</p>
        <dl class="ui-kv">
          <dt>Lease Cost</dt><dd>${toCurrency(rate(officeLeaseCost(1)))} a day</dd>
          <dt>Station</dt><dd>${escapeHtml(station?.name || stationId)}</dd>
          <dt>Location</dt><dd>${escapeHtml(currentBody)}, ${escapeHtml(formatSystemLabel(station?.systemId || "sol"))}</dd>
        </dl>
        ${memberNote}
        <p class="station__note">The lease runs for the term you choose and can be extended from this office before or after it ends. Without an active office you cannot start a mining cycle.</p>
        <div class="station__form">
          <label>
            Term
            <select class="ui-select" id="rent-office-duration">
              ${OFFICE_TERMS_DAYS.map((days) => `<option value="${days}">${days} days — ${toCurrency(rate(officeLeaseCost(days)))}</option>`).join("")}
            </select>
          </label>
          <button id="rent-office-btn" class="ui-button ui-button--primary" type="button">Execute Lease Agreement</button>
        </div>
        <p id="rent-office-status" class="station__hint"></p>
      </section>
    `;
  }

  const rentedDate = utcDate(existingOffice.rentedAt); // ISP-249 (AB#945)
  const availableStaffCapacity = Math.max(1, corp.employeeCap - corp.employeeCount);

  const now = Date.now();
  const rentedUntil = existingOffice.rentedUntil || 0;
  const leaseExpired = rentedUntil <= now;
  const msRemaining = Math.max(0, rentedUntil - now);
  const daysRemaining = msRemaining / 86_400_000;
  const fullDays = Math.floor(daysRemaining);
  const hoursRemaining = Math.floor((msRemaining % 86_400_000) / 3_600_000);
  const expiryDate = utcTime(rentedUntil, { withDate: true });
  const leaseStatusBadge = leaseExpired
    ? `<span class="ui-badge ui-badge--danger">Expired</span>`
    : `<span class="ui-badge ui-badge--success">Active Lease</span>`;
  const timeRemainingText = leaseExpired
    ? `<span class="station__danger">Lease expired</span>`
    : `${fullDays}d ${hoursRemaining}h remaining`;

  return `
    ${headerHtml}

    <section class="ui-panel station__panel">
      <h3>${codeSlotHtml("suites-status")}Office Status</h3>
      <dl class="ui-kv">
        <dt>Status</dt><dd>${leaseStatusBadge}</dd>
        <dt>Station</dt><dd>${escapeHtml(existingOffice.name)}</dd>
        <dt>Location</dt><dd>${escapeHtml(existingOffice.body)}, ${escapeHtml(formatSystemLabel(existingOffice.systemId || "sol"))}</dd>
        <dt>Lease Commenced</dt><dd>${rentedDate}</dd>
        <dt>Lease Expires</dt><dd>${expiryDate}</dd>
        <dt>Time Remaining</dt><dd>${timeRemainingText}</dd>
      </dl>
    </section>

    <section class="ui-panel station__panel">
      <h3>${codeSlotHtml("suites-extend")}${leaseExpired ? "Renew Expired Lease" : "Extend Lease"}</h3>
      <p class="station__note">${leaseExpired ? "Your office lease has expired. Renew to restore access to station services." : "Extend your current lease term. The additional days will be added to your existing expiry date."}</p>
      <form id="renew-office-form" class="station__form">
        <label>
          Duration
          <select class="ui-select" id="renew-office-duration">
            ${[7, 14, 21, 28].map((days) => `<option value="${days}"${days === 28 ? " selected" : ""}>${days} days — ${toCurrency(rate(officeRenewalCost(corp.completedInsights, days)))}</option>`).join("")}
          </select>
        </label>
        <button class="ui-button ui-button--primary" type="submit">${leaseExpired ? "Renew Lease" : "Extend Lease"}</button>
      </form>
      <p id="renew-office-status" class="station__hint"></p>
    </section>

    <section class="ui-panel station__panel">
      <h3>${codeSlotHtml("suites-workforce")}Workforce — Hire Personnel</h3>
      <p class="station__note">Recruit employees through your registered office. Each hire costs ${toCurrency(clientPrices(appState.economy).hireCost)} and adds ${toCurrency(clientPrices(appState.economy).payrollPerDay)}/day to operational payroll.</p>
      <form id="office-hire-form" class="station__form">
        <label>
          Head Count
          <input class="ui-input" id="office-hire-count" type="number" min="1" max="${availableStaffCapacity}" value="1" required />
        </label>
        <button class="ui-button ui-button--primary" type="submit">Hire Personnel</button>
      </form>
      <p id="office-hire-hint" class="station__hint">Available headroom: ${corp.employeeCap - corp.employeeCount} position(s). Staffing: ${numberMarkup("station:staffing", corp.employeeCount)} / ${corp.employeeCap}.</p>
      <p id="office-hire-status" class="station__note"></p>
    </section>

    <section class="ui-panel station__panel">
      <h3>${codeSlotHtml("suites-services")}Station Services</h3>
      <p class="station__note">Visit the ISA Claims &amp; Leases Division to file extraction rights applications. Each station's claims office files leases on the body it orbits.</p>
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
          revealUnderHeader(document.getElementById("office-hire-form")?.closest(".ui-panel"));
          showActionReceipt(account, { returnFocusTo: firstPresent("#rent-office-btn", "#office-hire-count") });
        } else {
          const cost = officeLeaseCost(durationDays);
          if ((appState.data.corp.finances.credits || 0) < cost) {
            throw new Error(`Leasing requires ${toCurrency(cost)}. Current reserves: ${toCurrency(appState.data.corp.finances.credits)}.`);
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
          showActionReceipt(account, { returnFocusTo: firstPresent("#renew-office-form button[type=submit]") });
        } else {
          const renewalCost = officeRenewalCost(corp.completedInsights, durationDays);
          if ((corp.finances.credits || 0) < renewalCost) {
            throw new Error(`Renewal requires ${toCurrency(renewalCost)}. Current reserves: ${toCurrency(corp.finances.credits)}.`);
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
      // AB#2058: what was typed, not Math.max(1, Number(x || 1)), which hired one employee from a cleared box (the
      // clamp AB#1164 removed from the Exchange). The server refuses anything but a whole number of at least 1.
      const typed = countInput?.value ?? "";
      const count = Number(typed);
      const submitBtn = hireForm.querySelector("button[type=submit]");

      if (submitBtn) submitBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Processing hire order...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/hire`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: typed }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          showStationBuilding(building.id);
          showActionReceipt(account, { returnFocusTo: firstPresent("#office-hire-form button[type=submit]", "#office-hire-count") });
        } else {
          // No server to ask: the same rule, and the same words, as gameplayInput.js gives a count it refuses.
          if (!Number.isInteger(count) || count < 1 || typed === "") throw new Error("Enter the number of employees to hire.");
          const corp = appState.data.corp;
          const available = Math.max(0, corp.employeeCap - corp.employeeCount);
          const hired = Math.min(count, available);
          const { hireCost, payrollPerDay } = clientPrices(appState.economy);
          const cost = hired * hireCost;
          if (hired <= 0) throw new Error("No available headroom to hire additional personnel.");
          if (corp.finances.credits < cost) throw new Error(`Hiring requires ${toCurrency(cost)}.`);
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
import { bodyProfile, cycleItemsText, leaseTypeLabel, profileText } from "../bodyYield.js"; // AB#829, Bug #2354
import { codeSlotHtml } from "../sectionCodes.js"; // ISP-248 (AB#944)
import { utcDate, utcTime } from "../timeFormat.js"; // ISP-249 (AB#945)

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
    <div class="station__building-header">
      <span class="ui-badge">${escapeHtml(building.factionCode)}</span>
      <h2 class="station__building-title">${codeSlotHtml(`building-${building.id}`)}${escapeHtml(building.name)}</h2>
    </div>
    ${dockedHtml(station)}
    <p class="ui-screen__lede">${escapeHtml(building.description)}</p>
    <p class="station__flavor">${escapeHtml(building.flavor)}</p>
  `;

  const currentStationId = station?.id || "earth-station-prime";
  const hasOffice = Boolean(activeOfficeAt(corp, currentStationId, Date.now()));
  const requiredForNext = employeesForNextLease(allLeases.length);
  const currentEmployees = corp?.employeeCount || 0;

  // Active leases section
  let leasesHtml = "";
  if (leases.length === 0) {
    leasesHtml = `<p class="station__note">${escapeHtml(claimsNoLeasesText(hasOffice))}</p>`; // Bug #1060
  } else {
    leasesHtml = `<div class="ui-grid">`;
    for (const lease of leases) {
      const extractorCount = leaseSlotsUsed(lease); // ISP-98 (AB#788): extractors and the other buildings on the lease
      const issuedDate = utcDate(lease.issuedAt || Date.now()); // ISP-249 (AB#945)
      leasesHtml += `
        <div class="ui-card station__card" data-role="lease-card">
          <div class="station__card-header">
            <span class="ui-badge" data-role="lease-body">${escapeHtml(lease.body)}</span>
            <span class="ui-badge" data-role="lease-type">${escapeHtml(leaseTypeLabel(bodyProfile(appState.systemsCatalog, lease.body)))}</span>
          </div>
          <dl class="ui-kv">
            <dt>Claim ID</dt><dd><code>${escapeHtml(lease.id)}</code></dd>
            <dt>Yields</dt><dd data-role="lease-yield">${escapeHtml(profileText(bodyProfile(appState.systemsCatalog, lease.body)))}</dd>
            <dt>Issued</dt><dd>${issuedDate}</dd>
            <dt>Building Slots</dt><dd>${extractorCount} / ${lease.buildingSlots || 2} used</dd>
          </dl>
          <button class="ui-button ui-button--secondary" data-action="manage-lease" data-lease-id="${escapeHtml(lease.id)}" type="button">
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
    purchaseHtml = `<p class="station__note">An office at ${escapeHtml(station?.name || "this station")} is required before the ISA will process lease applications here. Visit the Orbital Executive Suites to lease one.</p>`;
  } else if (!hasLocalBodies) {
    purchaseHtml = `<p class="station__note">No extraction zones are available at ${escapeHtml(station?.name || "this station")}. Travel to a station orbiting a resource-bearing body to file new lease applications.</p>`;
  } else if (availableBodies.length === 0) {
    // Bug #1060: say where the other leases are filed, by station name from the registry.
    purchaseHtml = `<p class="station__note">${escapeHtml(claimsAllTakenText({
      offeredBodies: LEASE_BODIES.map((b) => b.body),
      ownedBodies: allLeases.map((l) => l.body), // every lease held, not only this station's
      stations: appState.stationRegistry || []
    }))}</p>`;
  } else {
    purchaseHtml = availableBodies.map((entry) => {
      const canAfford = (corp?.finances?.credits || 0) >= entry.cost;
      const hasEnoughStaff = currentEmployees >= requiredForNext;
      return `
        <div class="station__lease-purchase">
          <h4>${escapeHtml(entry.body)} — Extraction Lease</h4>
          <p class="station__note">${escapeHtml(entry.description)}</p>
          <dl class="ui-kv">
            <dt>Yields</dt><dd data-role="lease-yield">${escapeHtml(profileText(bodyProfile(appState.systemsCatalog, entry.body)))}</dd>
            <dt>Lease Cost</dt><dd>${toCurrency(entry.cost)} (one-time)</dd>
            <dt>Employee Requirement</dt><dd>${requiredForNext} on payroll (current: ${currentEmployees})</dd>
            <dt>Building Slots Granted</dt><dd>2 on-surface slots</dd>
          </dl>
          ${!hasEnoughStaff ? `<p class="station__hint station__warn">Hire at least ${requiredForNext - currentEmployees} more employee(s) before filing this application.</p>` : ""}
          <button class="ui-button ui-button--secondary" data-action="purchase-lease" type="button" data-body="${escapeHtml(entry.body)}" ${!hasEnoughStaff || !canAfford ? "disabled" : ""}>
            File Lease Application — ${escapeHtml(entry.body)}
          </button>
        </div>
      `;
    }).join("");
  }

  return `
    ${headerHtml}
    <section class="ui-panel station__panel">
      <h3>${codeSlotHtml("claims-active")}Active Mining Claims</h3>
      ${leasesHtml}
    </section>
    <section class="ui-panel station__panel">
      <h3>${codeSlotHtml("claims-apply")}File Extraction Lease Application</h3>
      ${purchaseHtml}
    </section>
  `;
}

export function bindISAClaimsLeasesActions(building, data) {
  const contentEl = document.getElementById("station-building-content");
  if (!contentEl) return;

  // Purchase lease buttons (one per available body)
  contentEl.querySelectorAll('[data-action="purchase-lease"]').forEach((btn) => {
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
          showActionReceipt(account, { returnFocusTo: firstPresent(`[data-action="purchase-lease"][data-body="${CSS.escape(body)}"]`, '[data-action="manage-lease"]') });
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
  contentEl.querySelectorAll('[data-action="manage-lease"]').forEach((btn) => {
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
    const figures = activeCycleFigures(ex);
    const { hrs, mins, mined } = figures;
    const set = (key, text) => { const el = row.querySelector(`[data-live="${key}"]`); if (el) el.textContent = text; };
    set("pct", figures.pctText);
    set("left", `${hrs}h ${mins}m left`);
    set("remaining", `${hrs}h ${mins}m`);
    set("mined", `${mined.toLocaleString()} t`);
    set("mined-items", cycleItemsText(ex)); // AB#829
    set("spent", spentText(figures, toCurrency));
    const fill = row.querySelector('[data-live="fill"]');
    if (fill) fill.style.width = `${figures.fill.toFixed(2)}%`;
  }
}

export function renderLeaseManagement(building, lease, data) {
  const corp = data.corp;
  const extractors = (corp?.mining?.silicateExtractors || []).filter((ex) => ex.leaseId === lease.id);
  // ISP-98 (AB#788): the lease's other buildings (a Cryo-vapor Extractor Array) take its slots too.
  const facilities = leaseFacilities(lease);
  const usedSlots = extractors.length + facilities.length;
  const totalSlots = lease.buildingSlots || 2;
  const hasSlotAvailable = usedSlots < totalSlots;
  const buildCost = nextYardPriceFor(corp, appState.economy?.buildings); // AB#2286: the next yard's price, discount included
  const canAffordBuild = (corp?.finances?.credits || 0) >= buildCost;

  const issuedDate = utcDate(lease.issuedAt || Date.now()); // ISP-249 (AB#945)

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

      cycleInfo = `<span class="extractor__cycle-status is-downtime">Equipment Offline &mdash; Down for ${dtHrs}h ${dtMins}m</span>`;
      progressBarHtml = `
        <div class="extractor__progress">
          <div class="extractor__progress-header">
            <span class="extractor__pct">${cyclePct}% (paused)</span>
            <span class="extractor__time">${cycleRemaining}</span>
          </div>
          <div class="extractor__track">
            <div class="extractor__fill is-downtime" style="width:${cyclePct}%"></div>
          </div>
          <div class="extractor__stats">
            <span class="extractor__stat"><span class="extractor__stat-label">Cycle progress</span><span class="extractor__stat-value">${cycleElapsed}</span></span>
            <span class="extractor__stat"><span class="extractor__stat-label">Downtime elapsed</span><span class="extractor__stat-value">${dtHrs}h ${dtMins}m</span></span>
            <span class="extractor__stat"><span class="extractor__stat-label">Mined before halt</span><span class="extractor__stat-value">${(ex.minedThisCycle || 0).toLocaleString()}</span></span>
          </div>
          <p class="extractor__yield"><span class="extractor__stat-label">This cycle, by resource</span> <span>${escapeHtml(cycleItemsText(ex))}</span></p>
        </div>
      `;
    } else if (ex.active && ex.endsAt && ex.startedAt) {
      // Bug #1091: the figures come from public/scripts/leaseLive.js, and carry data-live so mining:updated can refresh
      // them in place while the view stays open.
      const figures = activeCycleFigures(ex);
      const { hrs, mins, mined } = figures;

      cycleInfo = `<span class="extractor__cycle-status">${ex.throughputPerHour} t/h &mdash; <span data-live="remaining">${hrs}h ${mins}m</span> remaining</span>`;
      progressBarHtml = `
        <div class="extractor__progress">
          <div class="extractor__progress-header">
            <span class="extractor__pct" data-live="pct">${figures.pctText}</span>
            <span class="extractor__time" data-live="left">${hrs}h ${mins}m left</span>
          </div>
          <div class="extractor__track">
            <div class="extractor__fill" data-live="fill" style="width:${figures.fill.toFixed(2)}%"></div>
          </div>
          <div class="extractor__stats">
            <span class="extractor__stat"><span class="extractor__stat-label">Mined this cycle</span><span class="extractor__stat-value" data-live="mined">${mined.toLocaleString()} t</span></span>
            <span class="extractor__stat"><span class="extractor__stat-label">Spent this cycle</span><span class="extractor__stat-value" data-live="spent">${spentText(figures, toCurrency)}</span></span>
            <span class="extractor__stat"><span class="extractor__stat-label">Rate</span><span class="extractor__stat-value">${ex.throughputPerHour} t/h</span></span>
          </div>
          <p class="extractor__yield"><span class="extractor__stat-label">This cycle, by resource</span> <span data-live="mined-items">${escapeHtml(cycleItemsText(ex))}</span></p>
        </div>
      `;
    } else if (ex.totalMined > 0) {
      cycleInfo = `<span class="extractor__cycle-status is-idle">Idle &mdash; ${ex.totalMined.toLocaleString()} t extracted lifetime</span>`;
    } else {
      cycleInfo = `<span class="extractor__cycle-status is-idle">Idle &mdash; no cycle history</span>`;
    }

    const mineFormId = `mine-form-${ex.id}`;
    // AB#2480: the control opens at the rate the economy model finds best for this yard, its research and the prices.
    const startRate = mineBestRate(ex.id);
    const mineFormHtml = !ex.active
      ? `<form class="station__form" data-form="mine" id="${escapeHtml(mineFormId)}" data-extractor-id="${escapeHtml(ex.id)}">
          <label>Throughput (t/h)<input type="number" name="amount" min="10" max="${yardTierFor(ex.tier, appState.economy?.operations, appState.economy?.buildings).throughputCap}" value="${startRate}" class="ui-input station__input--narrow" /></label>
          <label>Duration (hrs)<input type="number" name="hours" min="1" max="72" value="24" class="ui-input station__input--narrow" /></label>
          <button class="ui-button ui-button--primary" type="submit">Start Cycle</button>
        </form>
        <p class="station__hint" data-role="mine-projection" data-for="${escapeHtml(ex.id)}">${escapeHtml(mineProjectionText(startRate, ex.id))}</p>
        <p class="station__hint" data-role="mine-status" data-for="${escapeHtml(ex.id)}"></p>`
      : "";

    // AB#1052: a Stop control on a running cycle (including one paused in downtime, since that is still
    // extractor.active — see server/game/mining.js). It ends the cycle now, keeping what has been mined.
    const stopButtonHtml = ex.active
      ? `<button type="button" class="ui-button ui-button--secondary" data-action="stop-mining" data-extractor-id="${escapeHtml(ex.id)}" data-extractor-name="${escapeHtml(ex.name)}">Stop Cycle</button>
        <p class="station__hint" data-role="stop-status" data-for="${escapeHtml(ex.id)}"></p>`
      : "";

    // ISP-103 (AB#795): a yard being upgraded is offline; the upgrade control says until when.
    const upgrading = Number(ex.upgradingUntil) > Date.now();
    const mineFormVisible = !ex.active && !ex.downtimeActive && !upgrading;
    const upgradeHtml = yardUpgradeHtml(yardUpgradeView(ex, data.corp, appState.economy, { efficiency: extractorEfficiency(data.corp, ex) }), ex.id);
    extractorRows += `
      <div class="ui-card extractor is-${statusClass}" data-live-ex="${escapeHtml(ex.id)}" data-live-state="${extractorState(ex)}">
        <div class="extractor__header">
          <strong>${escapeHtml(ex.name)}</strong>
          <span class="ui-badge station__status--${statusClass}" data-role="yard-status">${ex.downtimeActive ? "Downtime" : (ex.active ? "Active" : (upgrading ? "Upgrading" : "Idle"))}</span>
        </div>
        ${ex.downtimeActive ? cycleInfo : (ex.active ? "" : cycleInfo)}
        ${progressBarHtml}
        ${mineFormVisible ? mineFormHtml : ""}
        ${ex.active ? stopButtonHtml : ""}
        ${upgradeHtml}
      </div>
    `;
  }

  const extractorSection = extractors.length === 0
    ? `<p class="station__note">No extraction facilities on this claim yet. Commission a yard below to begin operations.</p>`
    : `<div class="extractor__list">${extractorRows}</div>`;

  const buildSection = hasSlotAvailable
    ? `<div class="station__lease-purchase">
        <h4>Commission Basic Extractor Yard</h4>
        <p class="station__note">Deploys an extraction facility to this lease's surface allocation. Slot usage: ${usedSlots}/${totalSlots}.</p>
        <dl class="ui-kv">
          <dt>Construction Cost</dt><dd>${toCurrency(buildCost)}</dd>
          <dt>Asset Value</dt><dd>${toCurrency(clientPrices(appState.economy).extractorYardAssetValue)}</dd>
        </dl>
        <button id="lease-build-extractor-btn" class="ui-button ui-button--primary" type="button" ${!canAffordBuild ? "disabled" : ""}>
          Commission Extractor Yard
        </button>
        <p id="lease-build-extractor-status" class="station__hint"></p>
      </div>`
    : `<p class="station__note">This lease's building slots are fully allocated (${usedSlots}/${totalSlots}). ${escapeHtml(leaseFullAdvice(corp, lease, unleasedBodiesForPage(corp)))}</p>`;

  const station = getCurrentStationInfo(data);

  return `
    <div class="station__building-header">
      <span class="ui-badge">${escapeHtml(building.factionCode)}</span>
      <h2 class="station__building-title">${codeSlotHtml("building-lease")}Mining Lease — ${escapeHtml(lease.body)}</h2>
    </div>
    ${dockedHtml(station)}
    <button id="lease-back-btn" class="ui-button ui-button--secondary" type="button">&#8592; Back to Claims &amp; Leases</button>

    <section class="ui-panel station__panel">
      <h3>Lease Details</h3>
      <dl class="ui-kv">
        <dt>Claim ID</dt><dd><code>${escapeHtml(lease.id)}</code></dd>
        <dt>Body</dt><dd>${escapeHtml(lease.body)}</dd>
        <dt>Yields</dt><dd data-role="lease-yield">${escapeHtml(profileText(bodyProfile(appState.systemsCatalog, lease.body)))}</dd>
        <dt>Lease Type</dt><dd data-role="lease-type">${escapeHtml(leaseTypeLabel(bodyProfile(appState.systemsCatalog, lease.body)))}</dd>
        <dt>Issued</dt><dd>${issuedDate}</dd>
        <dt>Building Slots</dt><dd>${usedSlots} / ${totalSlots} used</dd>
      </dl>
    </section>

    <section class="ui-panel station__panel">
      <h3>Extraction Facilities</h3>
      ${extractorSection}
      ${facilities.map((name) => `<p class="station__hint"><strong>${escapeHtml(name)}</strong> <span class="station__note">&middot; operational, one building slot</span></p>`).join("")}
    </section>

    <section class="ui-panel station__panel">
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
          showActionReceipt(account, { returnFocusTo: firstPresent("#lease-build-extractor-btn", '[data-form="mine"] button[type=submit]') });
        } else {
          // Demo account fallback
          const corp = appState.data.corp;
          const { extractorYardAssetValue } = clientPrices(appState.economy);
          const cost = nextYardPriceFor(corp, appState.economy?.buildings); // AB#2286
          if ((corp.finances.credits || 0) < cost) throw new Error(`Construction requires ${toCurrency(cost)}.`);
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
    const line = form.parentElement?.querySelector(`[data-role="mine-projection"][data-for="${CSS.escape(form.getAttribute("data-extractor-id") || "")}"]`);
    if (!line) return;
    const cap = Number(form.querySelector('[name="amount"]')?.max) || 250; // AB#793: the yard's tier cap
    const rate = Math.max(10, Math.min(cap, Number(form.querySelector('[name="amount"]')?.value) || mineBestRate(form.getAttribute("data-extractor-id"))));
    line.textContent = mineProjectionText(rate, form.getAttribute("data-extractor-id"));
  };

  // Mining cycle forms
  document.querySelectorAll('[data-form="mine"]').forEach((form) => {
    showMineProjection(form);
    form.querySelector('[name="amount"]')?.addEventListener("input", () => showMineProjection(form));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const extractorId = form.getAttribute("data-extractor-id");
      const amount = Number(form.querySelector('[name="amount"]')?.value) || mineBestRate(extractorId);
      const hours = Number(form.querySelector('[name="hours"]')?.value || 24);
      const statusEl = document.querySelector(`[data-role="mine-status"][data-for="${CSS.escape(extractorId)}"]`);
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
          showActionReceipt(account, { returnFocusTo: firstPresent(`[data-form="mine"][data-extractor-id="${CSS.escape(extractorId)}"] button[type=submit]`, '[data-action="stop-mining"]') });
        } else {
          // Demo fallback
          const corp = appState.data.corp;
          // ISP-86: the same curve the server charges, from the server's own constants; AB#793: at the yard's tier.
          const tierEx = corp.mining.silicateExtractors.find((e) => e.id === extractorId);
          const tierOf = yardTierFor(tierEx?.tier, appState.economy?.operations, appState.economy?.buildings);
          const throughputPerHour = Math.max(10, Math.min(tierOf.throughputCap, amount));
          const operations = operationsForTier(tierOf.tier, appState.economy?.operations, appState.economy?.buildings);
          const baseCostPerHour = costPerHourFor(throughputPerHour, operations);
          const startupCost = clientStartupCostFor(baseCostPerHour, operations);
          // AB#2284: upkeep for yards past the free ones (the first two since AB#2304), by the hour only, as the server charges it.
          const operationCostPerHour = baseCostPerHour + yardUpkeepPerHourFor(yardIndexOf(corp, extractorId), appState.economy?.buildings);
          if ((corp.finances.credits || 0) < startupCost) throw new Error(`Startup requires ${toCurrency(startupCost)}.`);
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
  // ISP-103 (AB#795): upgrade a yard by one tier. The control was drawn from the server's tier table; the server checks
  // everything again, and the page draws itself from the account that comes back.
  document.querySelectorAll('[data-action="upgrade"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const extractorId = btn.getAttribute("data-extractor-id");
      const buildingId = btn.getAttribute("data-upgrade-building");
      const ex = (appState.data?.corp?.mining?.silicateExtractors || []).find((e) => e.id === extractorId);
      const view = ex ? yardUpgradeView(ex, appState.data.corp, appState.economy, { efficiency: extractorEfficiency(appState.data.corp, ex) }) : null;
      const statusEl = document.querySelector(`[data-role="yard-upgrade-status"][data-for="${CSS.escape(extractorId)}"]`);
      if (!view?.next || view.locked || view.blocked || !appState.accountId) return;
      const { next } = view;
      const confirmed = await showTradeConfirmation({
        heading: "Upgrade Extractor Yard",
        title: `Upgrade ${ex.name} to tier ${next.tier}?`,
        confirmLabel: `Upgrade (${toCurrency(next.cost)})`,
        rows: [
          { label: "Cost", value: `${toCurrency(next.cost)}` },
          { label: "Cap", value: `${next.before.cap} → ${next.after.cap} t/h` },
          { label: "Best rate", value: `${next.before.rate} → ${next.after.rate} t/h, netting ${toCurrency(next.before.netPerHour)} → ${toCurrency(next.after.netPerHour)}/h` },
          { label: "Offline", value: `${next.offlineHours} hours while it upgrades: no cycle can run` }
        ]
      });
      if (!confirmed) return;
      await postUpgrade(buildingId, btn, statusEl, {
        redraw: () => renderBuildingDetail(building, appState.data),
        focus: firstPresent(`[data-role="yard-upgrade"][data-upgrade-for="${CSS.escape(extractorId)}"] button`, '[data-form="mine"] button[type=submit]')
      });
    });
  });

  document.querySelectorAll('[data-action="stop-mining"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const extractorId = btn.getAttribute("data-extractor-id");
      const extractorName = btn.getAttribute("data-extractor-name") || "This extractor";
      const statusEl = document.querySelector(`[data-role="stop-status"][data-for="${CSS.escape(extractorId)}"]`);

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
      <p class="station__overline">IN OPEN SPACE</p>
      <h2 class="ui-screen__title">${codeSlotHtml("station")}${escapeHtml(formatSystemLabel(systemId))} System</h2>
      <p class="ui-screen__lede">You are not docked at any station. Use the Travel tab or Starmap to dock at a station in this system.</p>
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
    header.innerHTML = `<h2 class="ui-screen__title">${codeSlotHtml("station")}Station</h2><p class="station__note">No station data available for your current location.</p>`;
    return;
  }

  // ISP-78 (AB#767): the body the station orbits beside its name, so a screenshot says which station this is.
  const systems = data.world?.systems || appState.data?.world?.systems || [];
  // ISP-213 (AB#908): docked at the member's own conglomerate's station, say what membership gets here
  const ownStation = appState.conglomerate?.station?.id === station.id ? appState.conglomerate.station : null;
  header.innerHTML = `
    <div class="station__hero">
      ${stationArtHtml(station, systems)}
      <div class="station__identity">
        <p class="station__overline">${escapeHtml(station.designation)} &#47;&#47; ${escapeHtml(station.systemId.toUpperCase())}</p>
        <h2 class="ui-screen__title">${codeSlotHtml("station")}${escapeHtml(station.name)}</h2>
        <p class="ui-screen__meta">In orbit of ${escapeHtml(station.body)}, ${escapeHtml(formatSystemLabel(station.systemId))} system</p>
        <p class="ui-screen__lede">${escapeHtml(station.description)}</p>
      </div>
    </div>
    ${ownStation ? dockedAtOwnStationHtml(station, { memberStation: ownStation, standardRent: officeLeaseCost(1), systems }) : ""}
  `;
  paintStationArt(header, systems);
  header.querySelector('[data-role="own-station-open"]')?.addEventListener("click", openConglomerateStation);

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
      showActionReceipt(account, { returnFocusTo: firstPresent('[data-corp-building="Assembly Facility"]', ".nav-tab[data-tab='station']") }); // AB#744
    },
    onError: (error) => pushFeedback(error.message || "Construction failed.", "warn"),
    onUpgrade: (buildingId) => upgradeFacility(buildingId) // ISP-102 (AB#794)
  }, clientPrices(appState.economy).assemblyFacilityCost,
  (b) => facilityUpgradeHtml(facilityUpgradeView(b, data.corp, appState.economy, appState.playerBuildings || [])));

  // ── Construction (ISP-95, AB#785): every catalogue building, with Build or the first thing in the way ──
  renderConstructionPanel(document, appState.playerBuildings || [], data.corp || {}, {
    accountId: () => appState.accountId,
    request: async (path, init) => parseJsonResponse(await apiFetch(path, init)),
    onBuilt: (account) => {
      appState.data = deepClone(account.state);
      updateAllViews();
      pushFeedback(account.receipt?.title || "Construction complete.", "ok");
      showActionReceipt(account, { returnFocusTo: firstPresent("#station-construction-section h3", ".nav-tab[data-tab='station']") }); // AB#744
    },
    onError: (error) => pushFeedback(error.message || "Construction failed.", "warn")
  }, {
    researchName: (id) => techTree.find((t) => t.id === id)?.name || id,
    economy: appState.economy
  });

  // ISP-175 (AB#869): the shipyard and troop training moved to the Fleet tab (views/fleet.js)

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
    playerGrid.innerHTML = `<p class="station__note">No extractor yards deployed at ${escapeHtml(station.name)}. Yards are linked to mining leases on ${escapeHtml(stationBody)}.</p>`;
  } else {
    playerGrid.innerHTML = displayExtractors
      .map(
        (ex) => {
          const statusText = ex.active ? "Active" : "Idle";
          const statusClass = ex.active ? "operational" : "idle";
          return `
            <article class="ui-card station__card">
              <header class="station__card-header">
                <span class="ui-badge ui-badge--accent">CORP</span>
                <h3>${escapeHtml(ex.name || "Basic Extractor Yard")}</h3>
              </header>
              <p class="station__note">Tier ${ex.tier || 1} &mdash; <span class="ui-badge station__status--${statusClass}">${statusText}</span></p>
              <footer class="station__card-footer"></footer>
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
  contentEl.classList.remove("station__art--ge", "station__art--icl", "station__art--oes");

  const am = data.corp?.asteroidMining || {};
  const probeCount = am.probeCount || 0;
  const fleet = data.corp?.fleet || { cap: 2, vessels: probeCount, full: probeCount >= 2, raiseText: "" }; // Bug #586
  const hasProspecting = (data.corp?.unlockedTech || []).includes("tt-asteroid-prospecting");
  const station = getCurrentStationInfo(data);

  let probeSection = "";
  if (!hasProspecting) {
    probeSection = `<p class="station__note">Research <em>Asteroid Prospecting Arrays</em> to unlock Mining Probe fabrication.</p>`;
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
        <div class="station__fab-progress">
          <p class="station__note station__hint">Fabricating Mining Probe &mdash; ${formatDuration(remainMs)} remaining</p>
          <div class="progress-wrap"><div class="progress-bar" id="fab-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
        </div>
      `;
    }

    probeSection = `
      <div class="station__probe-status">
        <img src="/images/mining_probe.png" alt="Mining Probe" class="station__probe-img" />
        <div>
          <p>Mining Probes: <strong>${fleet.vessels} / ${fleet.cap}</strong> Fleet Cap <span class="station__note">(${probeCount} in hangar${deployedCount > 0 ? `, ${deployedCount} on expedition` : ""}${pendingCount > 0 ? `, ${pendingCount} in fabrication` : ""})</span></p>
          ${canBuild
            ? `<button id="build-probe-btn" class="ui-button ui-button--primary">Fabricate Mining Probe (¤${clientPrices(appState.economy).probeBuildCost.toLocaleString("en-US")})</button>`
            : activeFab
              ? ""
              : `<p class="station__note">Your fleet is at its Fleet Cap. ${fleet.raiseText}</p>`
          }
          ${fabProgressHtml}
        </div>
      </div>
    `;
  }

  contentEl.innerHTML = `
    <div class="station__building-header">
      <span class="ui-badge ui-badge--accent">CORP</span>
      <h2 class="station__building-title">${codeSlotHtml("building-assembly-facility")}Assembly Facility</h2>
    </div>
    ${dockedHtml(station)}
    <p class="ui-screen__lede">A modular manufacturing bay capable of fabricating autonomous mining probes and other deployable units.</p>
    ${probeSection}
  `;

  const buildProbeBtn = contentEl.querySelector("#build-probe-btn");
  if (buildProbeBtn) {
    buildProbeBtn.addEventListener("click", async () => {
      if (!appState.accountId) return;
      try {
        const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
        const res = await apiFetch(
          `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/build-mining-probe`,
          { method: "POST", headers: { "Content-Type": "application/json" } }
        );
        const account = await parseJsonResponse(res);
        appState.data = deepClone(account.state);
        updateAllViews();
        showActionReceipt(account, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
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

  // AB#2463: the first-action prompt that opened the Suites is gone (Board review item 9); the walkthrough leads there.
}

/**
 * ISP-86: what an hour at this rate earns after its running cost, and what the best rate would be. Rendered into
 * the extractor row itself, because the row is rewritten whenever a cycle ticks and anything written to it
 * afterwards is wiped by the next rewrite.
 */
/** "two" for the yards that pay no upkeep, from the economy (extractorYardsInStartingKit; ISP-308, AB#2304). */
export function freeYardsText(buildings) {
  const free = Number(buildings?.extractorYardsInStartingKit) || 1;
  return ["", "one", "two", "three", "four", "five"][free] || String(free);
}

/**
 * AB#2480: what one of this corporation's yards needs to price a rate: its tier's curve and cap, the research and
 * lease efficiency, its upkeep, and the prices. null before the economy has loaded.
 */
function yardPricing(extractorId) {
  const economy = appState.economy;
  if (!economy?.operations) return null;
  const ex = (appState.data?.corp?.mining?.silicateExtractors || []).find((e) => e.id === extractorId);
  const lease = (appState.data?.corp?.miningLeases || []).find((l) => l.id === ex?.leaseId);
  const tierOf = yardTierFor(ex?.tier, economy.operations, economy.buildings);
  return {
    operations: operationsForTier(tierOf.tier, economy.operations, economy.buildings),
    efficiency: miningEfficiency(appState.data?.corp, lease, economy.buildings),
    upkeepPerHour: yardUpkeepPerHourFor(yardIndexOf(appState.data?.corp, extractorId), economy.buildings),
    cap: tierOf.throughputCap,
    taxPct: economy.salesTaxPct,
    // AB#2334's model sells along the bid from its base price; without the bid's rules (an older server) it is today's.
    alongBid: Boolean(economy.npcBid && economy.silicateBasePrice),
    basePrice: economy.silicateBasePrice,
    npcBid: economy.npcBid,
    unitPrice: economy.silicateUnitPrice
  };
}

/** AB#2480: the best rate for this yard, as the economy model computes it (public/scripts/standingBid.js); 40 until the economy loads. */
export function mineBestRate(extractorId) {
  const p = yardPricing(extractorId);
  if (!p) return 40;
  return p.alongBid
    ? bestRateAlongBid({ operations: p.operations, basePrice: p.basePrice, taxPct: p.taxPct, npcBid: p.npcBid, efficiency: p.efficiency, upkeepPerHour: p.upkeepPerHour, max: p.cap }).throughputPerHour
    : bestThroughput({ operations: p.operations, unitPrice: p.unitPrice, taxPct: p.taxPct, efficiency: p.efficiency, upkeepPerHour: p.upkeepPerHour, max: p.cap }).throughputPerHour;
}

export function mineProjectionText(rate, extractorId) {
  const economy = appState.economy;
  if (!economy?.operations) return "";
  const p = yardPricing(extractorId);
  if (p.alongBid) {
    // AB#2480: an hour as a day of it sells along the standing bid, and the best rate by the same walk (AB#2334).
    const along = { operations: p.operations, basePrice: p.basePrice, taxPct: p.taxPct, npcBid: p.npcBid, efficiency: p.efficiency, upkeepPerHour: p.upkeepPerHour };
    const at = hourAlongBid(rate, along);
    const best = bestRateAlongBid({ ...along, max: p.cap });
    const profit = Math.round(at.profitPerHour);
    const net = profit >= 0 ? `nets ${toCurrency(profit)}/hour` : `loses ${toCurrency(Math.abs(profit))}/hour`;
    const upkeep = p.upkeepPerHour > 0 ? ` (including ¤${p.upkeepPerHour.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hour upkeep, paid by every yard after your first ${freeYardsText(economy.buildings)})` : "";
    return `At ${rate} t/h: earns ${toCurrency(Math.round(at.revenuePerHour))}/hour, costs ${toCurrency(Math.round(at.costPerHour))}/hour${upkeep}, ${net}, with a day's ore averaging ${at.avgBid.toFixed(2)} a tonne on the standing bid. `
      + (best.throughputPerHour === rate
        ? "That is the best rate for your research and today's prices."
        : `Best for your research and today's prices: ${best.throughputPerHour} t/h, netting ${toCurrency(best.profitPerHour)}/hour.`);
  }
  // ISP-101 (AB#793): the yard's tier sets its curve and its cap, so the projection and the best rate follow it.
  const ex = (appState.data?.corp?.mining?.silicateExtractors || []).find((e) => e.id === extractorId);
  // ISP-98 (AB#788): the same efficiency the server's tick applies, the lease's Cryo-vapor Extractor Array included.
  const lease = (appState.data?.corp?.miningLeases || []).find((l) => l.id === ex?.leaseId);
  const efficiency = miningEfficiency(appState.data?.corp, lease, economy.buildings);
  // ISP-301 (AB#2284): a yard past the corporation's free ones (its first two since ISP-308, AB#2304) pays upkeep while
  // it runs, and the line says so.
  const upkeepPerHour = yardUpkeepPerHourFor(yardIndexOf(appState.data?.corp, extractorId), economy.buildings);
  const tierOf = yardTierFor(ex?.tier, economy.operations, economy.buildings);
  const operations = operationsForTier(tierOf.tier, economy.operations, economy.buildings);
  const at = miningProjection(rate, { operations, unitPrice: economy.silicateUnitPrice, taxPct: economy.salesTaxPct, efficiency, upkeepPerHour });
  const best = bestThroughput({ operations, unitPrice: economy.silicateUnitPrice, taxPct: economy.salesTaxPct, efficiency, upkeepPerHour, max: tierOf.throughputCap });
  const net = at.profitPerHour >= 0 ? `nets ${toCurrency(at.profitPerHour)}/hour` : `loses ${toCurrency(Math.abs(at.profitPerHour))}/hour`;
  const upkeep = upkeepPerHour > 0 ? ` (including ¤${upkeepPerHour.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hour upkeep, paid by every yard after your first ${freeYardsText(economy.buildings)})` : "";
  return `At ${rate} t/h: earns ${toCurrency(at.revenuePerHour)}/hour, costs ${toCurrency(at.costPerHour)}/hour${upkeep}, ${net}. `
    + (best.throughputPerHour === rate
      ? "That is the best rate for your research."
      : `Best for your research: ${best.throughputPerHour} t/h, netting ${toCurrency(best.profitPerHour)}/hour.`);
}

/** What an hour on this extractor's lease is multiplied by: research and the lease's Cryo-vapor Extractor Array (ISP-98). */
export function extractorEfficiency(corp, ex) {
  return miningEfficiency(corp, (corp?.miningLeases || []).find((l) => l.id === ex?.leaseId), appState.economy?.buildings);
}

/** An extractor's place among the corporation's yards, in build order: 0 is its first, -1 when it is not found. */
export function yardIndexOf(corp, extractorId) {
  return (corp?.mining?.silicateExtractors || []).findIndex((e) => e.id === extractorId);
}
