// The construction panel (ISP-95, AB#785): every building in data/player-buildings.json, drawn from the catalogue
// GET /api/bootstrap sends, with what it does, what it costs and the slots it takes, and either a Build button or the
// first thing in the way. The checks are the server's (server/construction.js), in its order, so a row that offers
// Build is one the server will build, and a locked row says what to do next. Build posts POST /gameplay/build; the
// page draws the panel again from the account that comes back, and a refusal shows the server's own words in the row.
// Pure apart from renderConstructionPanel, so it loads in node without the page's state.
import { escapeHtml } from "./html.js";
import { protocolLineHtml, refusalMeaning } from "./protocol.js"; // ISP-254 (AB#4818)
import { nextYardPriceFor } from "./yardPrice.js";
import { leaseFacilities, leaseHasRoom, leaseSlotsUsed } from "./leaseSlots.js"; // ISP-98 (AB#788)
import { toCurrency } from "./helpers.js"; // Bug #2498: every screen's credits through the one formatter

const has = (corp, tech) => (corp.unlockedTech || []).includes(tech);
const onLease = (building) => building.slot === "corporation+lease";
const isUpgrade = (building) => building.slot === "upgrade";

/**
 * What the server charges this corporation for the building (server/construction.js CONSTRUCTIONS): the catalogue
 * price, less the Supply Forecast discount on an extractor yard. NaN when the price has not loaded.
 */
export function buildingCost(building, corp = {}, economy = {}) {
  const cost = Number(building?.cost);
  if (!Number.isFinite(cost)) return NaN;
  // AB#2286: a yard's price rises with each one built, with the Supply Forecast discount after (yardPrice.js).
  if (building.id === "basic-extractor-yard") return nextYardPriceFor(corp, economy?.buildings);
  return cost;
}

/** A lease on the body a building is limited to (ISP-98: `lease`, such as "luna"), or any lease when it is not limited. */
const onItsBody = (building, lease) => !building.lease || String(lease?.body || "").toLowerCase() === building.lease;
/** Whether a lease is below the building's per-lease cap. */
const belowLeaseCap = (building, lease) => building.cap?.perLease === undefined || leaseFacilities(lease).filter((n) => n === building.name).length < building.cap.perLease;

/** The mining leases a building on a lease can go on: on its body, below its cap there, with a free building slot. */
function leasesWithRoom(building, corp) {
  return (corp.miningLeases || []).filter((l) => onItsBody(building, l) && belowLeaseCap(building, l) && leaseHasRoom(l));
}

/**
 * One row's state: { building, cost, leases, reason }. `reason` is "" when the row offers Build, or the first unmet
 * condition in words: research, the cap, a lease with room, a corporation slot, the price.
 */
export function constructionRow(building, corp = {}, { researchName = (id) => id, economy = {}, catalogue = [] } = {}) {
  const cost = buildingCost(building, corp, economy);
  const leases = onLease(building) ? leasesWithRoom(building, corp) : [];
  const row = { building, cost, leases, reason: "" };
  const missing = (building.researchGates || []).find((id) => !has(corp, id));
  const cap = building.cap?.perCorporation;
  const built = (corp.buildings || []).filter((b) => b?.name === building.name).length;
  const used = (corp.buildings || []).length;
  const slots = corp.buildingSlots || 2;

  // ISP-97 (AB#787): an upgrade takes no slot; it needs a building of the kind it upgrades that does not carry it yet.
  if (isUpgrade(building)) {
    const baseName = catalogue.find((b) => b.id === building.upgrades)?.name || "building";
    const own = (corp.buildings || []).filter((b) => b?.name === baseName);
    const perBuilding = building.cap?.perBuilding ?? 1;
    row.upgrades = baseName;
    if (missing) row.reason = `Requires ${researchName(missing)} research.`;
    else if (!own.length) row.reason = `Needs a ${baseName} to upgrade: build one first.`;
    else if (!own.some((b) => (b.upgrades || []).filter((u) => u === building.name).length < perBuilding)) row.reason = `Every ${baseName} you have is already a ${building.name}.`;
    else if (!Number.isFinite(cost)) row.reason = "The price has not loaded; reload the page.";
    else if (Number(corp.finances?.credits || 0) < cost) row.reason = `Needs ${toCurrency(cost)}; you have ${toCurrency(Math.floor(Number(corp.finances?.credits || 0)))}.`;
    return row;
  }
  const level = Number(corp.level) || 0;
  // ISP-170 (AB#864): the level first, as server/playerBuildings.js catalogueRefusal refuses it first
  if (building.minLevel && level < building.minLevel) row.reason = `Requires Corporation Level ${building.minLevel} (you are level ${level}).`;
  else if (missing) row.reason = `Requires ${researchName(missing)} research.`;
  else if (cap !== undefined && built >= cap) row.reason = `Built: your corporation operates the most it may, ${cap}.`;
  else if (onLease(building) && !leases.length) row.reason = leaseReason(building, corp);
  else if (used >= slots) row.reason = `No free building slot: ${used} of ${slots} in use.`;
  else if (!Number.isFinite(cost)) row.reason = "The price has not loaded; reload the page."; // fail closed, never a guessed price
  else if (Number(corp.finances?.credits || 0) < cost) row.reason = `Needs ${toCurrency(cost)}; you have ${toCurrency(Math.floor(Number(corp.finances?.credits || 0)))}.`;
  return row;
}

/** Why no lease will take the building: none on its body, each already has one, or every one is full. */
function leaseReason(building, corp) {
  const body = building.lease ? building.lease.replace(/^./, (c) => c.toUpperCase()) : "mining";
  const own = (corp.miningLeases || []).filter((l) => onItsBody(building, l));
  if (!own.length) return `Needs a ${body === "mining" ? "mining" : `${body}`} lease: file one at the ISA Claims & Leases Division.`;
  if (!own.some((l) => belowLeaseCap(building, l))) return `Your ${body} lease already has a ${building.name}.`;
  return `Every ${body} lease's building slots are in use.`;
}

export function slotCounterText(corp = {}) {
  return `Building slots: ${(corp.buildings || []).length} of ${corp.buildingSlots || 2} in use.`;
}

function rowHtml({ building, cost, leases, reason, upgrades }) {
  const id = escapeHtml(building.id);
  const slotUse = isUpgrade(building)
    ? `Uses no slot: upgrades a ${upgrades} in place.`
    : onLease(building) ? "Uses 1 corporation slot and 1 slot on a mining lease." : "Uses 1 corporation slot.";
  const leasePicker = leases.length
    ? `<label class="ui-select">On lease <select class="ui-select" data-build-lease>${leases
        .map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.body || l.id)} (${leaseSlotsUsed(l)} of ${l.buildingSlots} in use)</option>`)
        .join("")}</select></label>`
    : "";
  const action = reason
    ? `<p class="station__blocked">${escapeHtml(reason)}</p>`
    : `${leasePicker}<button class="ui-button ui-button--primary" data-build-id="${id}">Build (${toCurrency(cost)})</button>`;
  return `
        <article class="ui-card station__card" data-building-row="${id}" tabindex="-1">
          <header class="station__card-header"><h3>${escapeHtml(building.name)}</h3></header>
          <p class="ui-card__body">${escapeHtml(building.effect || "")}</p>
          <p class="station__note">${Number.isFinite(cost) ? toCurrency(cost) : "Price not loaded"} &middot; ${slotUse}</p>
          <footer class="station__card-footer">${action}</footer>
          <p class="station__hint" role="status" aria-live="polite"></p>
        </article>`;
}

/** Every catalogue building as a row, in the catalogue's order. */
export function constructionPanelHtml(catalogue = [], corp = {}, ctx = {}) {
  return catalogue.map((building) => rowHtml(constructionRow(building, corp, { catalogue, ...ctx }))).join("");
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
      // ISP-254 (AB#4818): the refusal, then its protocol line (Denied, or Unfunded from the server's code)
      if (status) status.innerHTML = `${escapeHtml(error?.message || "The build was refused.")} ${protocolLineHtml({ meaning: refusalMeaning(error), screen: "station" })}`;
      onError(error);
    }
  };
}
