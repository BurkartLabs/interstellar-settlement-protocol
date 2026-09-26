// The construction panel (ISP-95, AB#785): every building in data/player-buildings.json, drawn from the catalogue
// GET /api/bootstrap sends, with what it does, what it costs and the slots it takes, and either a Build button or the
// first thing in the way. The checks are the server's (server/construction.js), in its order, so a row that offers
// Build is one the server will build, and a locked row says what to do next. Build posts POST /gameplay/build; the
// page draws the panel again from the account that comes back, and a refusal shows the server's own words in the row.
// Pure apart from renderConstructionPanel, so it loads in node without the page's state.
import { escapeHtml } from "./html.js";

const money = (n) => `¤${Math.floor(n).toLocaleString("en-US")}`;
const has = (corp, tech) => (corp.unlockedTech || []).includes(tech);
const onLease = (building) => building.slot === "corporation+lease";

/**
 * What the server charges this corporation for the building (server/construction.js CONSTRUCTIONS): the catalogue
 * price, less the Supply Forecast discount on an extractor yard. NaN when the price has not loaded.
 */
export function buildingCost(building, corp = {}, economy = {}) {
  const cost = Number(building?.cost);
  if (!Number.isFinite(cost)) return NaN;
  if (building.id === "basic-extractor-yard" && has(corp, "tt-supply-forecast")) {
    const multiplier = Number(economy?.buildings?.supplyForecastCostMultiplier);
    return Number.isFinite(multiplier) ? Math.round(cost * multiplier) : NaN;
  }
  return cost;
}

/** The mining leases a building on a lease can go on: those with a free building slot. */
function leasesWithRoom(corp) {
  return (corp.miningLeases || []).filter((l) => (l.extractorIds || []).length < (l.buildingSlots || 0));
}

/**
 * One row's state: { building, cost, leases, reason }. `reason` is "" when the row offers Build, or the first unmet
 * condition in words: research, the cap, a lease with room, a corporation slot, the price.
 */
export function constructionRow(building, corp = {}, { researchName = (id) => id, economy = {} } = {}) {
  const cost = buildingCost(building, corp, economy);
  const leases = onLease(building) ? leasesWithRoom(corp) : [];
  const row = { building, cost, leases, reason: "" };
  const missing = (building.researchGates || []).find((id) => !has(corp, id));
  const cap = building.cap?.perCorporation;
  const built = (corp.buildings || []).filter((b) => b?.name === building.name).length;
  const used = (corp.buildings || []).length;
  const slots = corp.buildingSlots || 2;

  if (missing) row.reason = `Requires ${researchName(missing)} research.`;
  else if (cap !== undefined && built >= cap) row.reason = `Built: your corporation operates the most it may, ${cap}.`;
  else if (onLease(building) && !(corp.miningLeases || []).length) row.reason = "Needs a mining lease: file one at the ISA Claims & Leases Division.";
  else if (onLease(building) && !leases.length) row.reason = "Every mining lease's building slots are in use.";
  else if (used >= slots) row.reason = `No free building slot: ${used} of ${slots} in use.`;
  else if (!Number.isFinite(cost)) row.reason = "The price has not loaded; reload the page."; // fail closed, never a guessed price
  else if (Number(corp.finances?.credits || 0) < cost) row.reason = `Needs ${money(cost)}; you have ${money(Number(corp.finances?.credits || 0))}.`;
  return row;
}

export function slotCounterText(corp = {}) {
  return `Building slots: ${(corp.buildings || []).length} of ${corp.buildingSlots || 2} in use.`;
}

function rowHtml({ building, cost, leases, reason }) {
  const id = escapeHtml(building.id);
  const slotUse = onLease(building) ? "Uses 1 corporation slot and 1 slot on a mining lease." : "Uses 1 corporation slot.";
  const leasePicker = leases.length
    ? `<label class="construction-lease">On lease <select data-build-lease>${leases
        .map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.body || l.id)} (${(l.extractorIds || []).length} of ${l.buildingSlots} in use)</option>`)
        .join("")}</select></label>`
    : "";
  const action = reason
    ? `<p class="facility-blocked">${escapeHtml(reason)}</p>`
    : `${leasePicker}<button class="btn btn-accent" data-build-id="${id}">Build (${money(cost)})</button>`;
  return `
        <article class="facility-card data-card construction-row" data-building-row="${id}">
          <header class="facility-card-header"><h3>${escapeHtml(building.name)}</h3></header>
          <p class="muted facility-desc">${escapeHtml(building.effect || "")}</p>
          <p class="muted">${Number.isFinite(cost) ? money(cost) : "Price not loaded"} &middot; ${slotUse}</p>
          <footer class="facility-card-footer">${action}</footer>
          <p class="construction-status" role="status" aria-live="polite"></p>
        </article>`;
}

/** Every catalogue building as a row, in the catalogue's order. */
export function constructionPanelHtml(catalogue = [], corp = {}, ctx = {}) {
  return catalogue.map((building) => rowHtml(constructionRow(building, corp, ctx))).join("");
}

export function buildPath(accountId) {
  return `/api/accounts/${encodeURIComponent(accountId)}/gameplay/build`;
}

/**
 * Draw the panel and the slot counter into the Station page and bind Build. Returns false when the page has no panel.
 *   handlers.accountId()          the signed-in account, or nothing
 *   handlers.request(path, init)  sends the request; resolves to the account, or throws with the server's message
 *   handlers.onBuilt(account)     built: the page draws everything again from the account
 *   handlers.onError(error)       refused or failed; the row already shows the message
 */
export function renderConstructionPanel(doc, catalogue, corp, handlers, ctx = {}) {
  const grid = doc.getElementById("station-construction");
  const counter = doc.getElementById("construction-slots");
  if (!grid) return false;
  if (counter) counter.textContent = slotCounterText(corp);
  grid.innerHTML = constructionPanelHtml(catalogue, corp, ctx);
  bindConstructionPanel(grid, handlers);
  return true;
}

/** Assigned as grid.onclick, so drawing again never stacks a second handler. A button is disabled while its request is out. */
export function bindConstructionPanel(grid, { accountId, request, onBuilt, onError }) {
  grid.onclick = async (event) => {
    const button = event.target.closest("[data-build-id]");
    if (!button || !grid.contains(button) || button.disabled) return;
    const id = accountId();
    if (!id) return;
    const row = button.closest("[data-building-row]");
    const status = row?.querySelector("[role=status]");
    const lease = row?.querySelector("[data-build-lease]")?.value;
    const body = { buildingId: button.getAttribute("data-build-id"), ...(lease ? { leaseId: lease } : {}) };

    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Building…";
    if (status) status.textContent = "";
    try {
      const account = await request(buildPath(id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      onBuilt(account);
    } catch (error) {
      button.disabled = false;
      button.textContent = label;
      if (status) status.textContent = error?.message || "The build was refused.";
      onError(error);
    }
  };
}
