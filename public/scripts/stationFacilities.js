// The Station's Operational Facilities: the Assembly Facility and Refinery cards, and the card that constructs the
// Assembly Facility. Bug #1253: the Construct button was rendered into this grid but its listener was looked up in the
// extractor grid, found nothing, and the button never did anything. The cards and their clicks now live together: one
// delegated handler on the grid they are rendered into, so a button cannot be drawn somewhere its handler is not.
import { escapeHtml } from "./html.js";
import { toCurrency } from "./helpers.js"; // Bug #2498: every screen's credits through the one formatter

// AB#1430: the Assembly Facility's price is the server's (data/economy.json, sent by GET /api/bootstrap), passed in
// by the caller as `cost`: this module loads in node, without the page's state, and holds no copy of it.

const DESCRIPTIONS = {
  "Assembly Facility": "Modular manufacturing bay for fabricating deployable units and equipment.",
  Refinery: "Industrial refinery complex for processing raw minerals into advanced materials."
};

export function assemblyBuildPath(accountId) {
  return `/api/accounts/${encodeURIComponent(accountId)}/gameplay/build-assembly-facility`;
}

/**
 * ISP-102 (AB#794): what a facility is doing, for the card that also shows its upgrade control (which says the tier).
 * "Upgrading" while the building, or the refinery it runs, is offline for an upgrade.
 */
export function facilityStatus(building, corp = {}, now = Date.now()) {
  let until = Number(building?.upgradingUntil) || 0;
  if (building?.name === "Refinery") {
    const own = (corp.buildings || []).filter((b) => b?.name === "Refinery");
    until = Math.max(until, Number((corp.refineries || [])[own.indexOf(building)]?.upgradingUntil) || 0);
  }
  return until > now ? "Upgrading" : String(building?.status || "Operational");
}

/** The facility cards for a corporation, and the Construct card while it has the research and no facility yet. */
export function facilityCardsHtml(corp = {}, cost = NaN, upgradeFor = null) {
  const operational = (corp.buildings || []).filter((b) => b.status === "Operational");
  const hasAssemblyTech = (corp.unlockedTech || []).includes("tt-assembly-fabrication");
  const hasAssembly = operational.some((b) => b.name === "Assembly Facility");

  const cards = operational
    .filter((b) => b.name in DESCRIPTIONS)
    .map((b) => `
        <article class="ui-card station__card">
          <header class="station__card-header">
            <span class="ui-badge ui-badge--accent">CORP</span>
            <h3>${escapeHtml(b.name)}</h3>
          </header>
          <p class="ui-card__body">${DESCRIPTIONS[b.name]}</p>
          <p class="ui-badge">${upgradeFor ? escapeHtml(facilityStatus(b, corp)) : `Tier ${b.tier || 1} &mdash; ${escapeHtml(b.status)}`}</p>
          ${upgradeFor ? upgradeFor(b) : ""}
          <footer class="station__card-footer"><button class="ui-button ui-button--primary" data-corp-building="${escapeHtml(b.name)}">Enter</button></footer>
        </article>
      `)
    .join("");

  let construct = "";
  if (hasAssemblyTech && !hasAssembly) {
    // The Station shows no feedback line (that is on Overview), so a refusal the player cannot see is the same dead
    // button as Bug #1253. Say why before the click, from the checks the server makes.
    const blocked = constructBlocker(corp, cost);
    construct = `<article class="ui-card station__card station__card--dashed">
         <header class="station__card-header"><span class="ui-badge ui-badge--accent">NEW</span><h3>Assembly Facility</h3></header>
         <p class="station__note">Modular manufacturing bay for fabricating deployable units.</p>
         ${blocked ? `<p class="station__blocked">${escapeHtml(blocked)}</p>` : ""}
         <footer class="station__card-footer"><button id="build-assembly-btn" class="ui-button ui-button--primary" data-facility-action="construct-assembly"${blocked ? " disabled" : ""}>Construct (${toCurrency(cost)})</button></footer>
       </article>`;
  }

  return cards + construct;
}

/** Why the Assembly Facility cannot be built right now, as the server would refuse it, or "" when it can. */
export function constructBlocker(corp = {}, cost = NaN) {
  const used = (corp.buildings || []).length;
  const slots = corp.buildingSlots || 2;
  if (used >= slots) return `Needs a free building slot: ${used} of ${slots} in use.`;
  if (!Number.isFinite(cost)) return "The price has not loaded; reload the page."; // fail closed, never a guessed price
  const credits = Number(corp.finances?.credits || 0);
  if (credits < cost) {
    return `Needs ${toCurrency(cost)}; you have ${toCurrency(Math.floor(credits))}.`;
  }
  return "";
}

/**
 * Draw the facilities into the Station page and bind their clicks to the same grid. Returns false when the page has no
 * facilities section. The section is hidden while there is nothing to show.
 */
export function renderStationFacilities(doc, corp, handlers, cost = NaN, upgradeFor = null) {
  const section = doc.getElementById("station-facilities-section");
  const grid = doc.getElementById("station-facility-buildings");
  if (!section || !grid) return false;
  const html = facilityCardsHtml(corp, cost, upgradeFor); // ISP-102 (AB#794): each card's upgrade control
  section.hidden = !html;
  grid.innerHTML = html;
  bindFacilityGrid(grid, handlers);
  return true;
}

/**
 * Handle clicks on the facility grid. Assigned as grid.onclick, so re-rendering never stacks a second handler.
 *   accountId()        the signed-in account, or nothing
 *   request(path, init) sends the request and resolves to the account, or throws with the server's message
 *   onEnter(name)      a facility's Enter button
 *   onBuilt(account)   the facility was built
 *   onError(error)     it was refused or the request failed
 *   onUpgrade(id)      a facility's Upgrade button (ISP-102, AB#794): the page confirms, posts and redraws
 * While a construction request is out the button is disabled, so a double click is one request, not two.
 */
export function bindFacilityGrid(grid, { accountId, request, onEnter, onBuilt, onError, onUpgrade }) {
  grid.onclick = async (event) => {
    const upgrade = event.target.closest("[data-upgrade-building]");
    if (upgrade && grid.contains(upgrade)) {
      if (!upgrade.disabled && onUpgrade) onUpgrade(upgrade.getAttribute("data-upgrade-building"));
      return;
    }

    const enter = event.target.closest("[data-corp-building]");
    if (enter && grid.contains(enter)) {
      onEnter(enter.getAttribute("data-corp-building"));
      return;
    }

    const build = event.target.closest('[data-facility-action="construct-assembly"]');
    if (!build || !grid.contains(build) || build.disabled) return;
    const id = accountId();
    if (!id) return;

    const label = build.textContent;
    build.disabled = true;
    build.textContent = "Constructing…";
    try {
      const account = await request(assemblyBuildPath(id), {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      onBuilt(account);
    } catch (error) {
      build.disabled = false;
      build.textContent = label;
      onError(error);
    }
  };
}
