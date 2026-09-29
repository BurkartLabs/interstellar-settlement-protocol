// The Fleet tab (ISP-175, AB#869): units with their upkeep and readiness, the shipyard and training queues, the fleets and
// where they are, and the orders a fleet takes. The markup is public/scripts/fleetView.js; the shipyard and training
// panels are ISP-171's and ISP-172's. Every order goes to the server and the tab is drawn again from its answer.
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { deepClone } from "../helpers.js";
import { FLEET_TYPES, destinationsHtml, fleetCardHtml, forcesSummaryHtml, formFleetHtml, unitsTableHtml } from "../fleetView.js";
import { durationText, renderShipyardPanel } from "../shipyardPanel.js"; // ISP-171 (AB#865)
import { renderTrainingPanel } from "../trainingPanel.js"; // ISP-172 (AB#866)
import { appState, techTree } from "../state.js";
import { pushFeedback, showTradeConfirmation, updateAllViews } from "./shared.js";
import { escapeHtml } from "../html.js";
import { protocolLineHtml, refusalMeaning } from "../protocol.js"; // ISP-254 (AB#4810)
import { showActionReceipt } from "./receiptModal.js";
import { utcTime } from "../timeFormat.js";

const stationName = (id) => (appState.stationRegistry || []).find((s) => s.id === id)?.name || "a station";
const firstPresent = (...selectors) => () => selectors.map((sel) => document.querySelector(sel)).find(Boolean) || null;
const accountPath = (rest) => `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay${rest}`;
const post = async (path, body) => parseJsonResponse(await apiFetch(accountPath(path), {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {})
}));
// ISP-254 (AB#4810): `meaning` is the guide's phrase for what the order did (protocol.js), drawn after the plain words
function redraw(account, message, meaning) {
  appState.data = deepClone(account.state);
  updateAllViews();
  if (message) pushFeedback(message, "ok", meaning ? { meaning, screen: "fleet" } : null);
}
/** A refusal in an order's status line: the server's words, then Denied or Unfunded and the Fleet code. */
export function refusalStatusHtml(message) {
  return `${escapeHtml(message)} ${protocolLineHtml({ meaning: refusalMeaning(message), screen: "fleet" })}`;
}

export function renderFleet(data) {
  const summary = document.getElementById("fleet-summary");
  if (!summary) return;
  const corp = data.corp || {};
  const catalog = appState.units || [];
  summary.innerHTML = forcesSummaryHtml(corp, catalog);
  document.getElementById("fleet-units").innerHTML = unitsTableHtml(corp, catalog);
  const fleets = corp.military?.fleets || [];
  const list = document.getElementById("fleet-list");
  list.innerHTML = [formFleetHtml(corp, catalog, stationName), ...fleets.map((f) => fleetCardHtml(f, corp, catalog, { stationName }))].join("");
  bindFleetList(list);

  // ISP-171 and ISP-172: production, moved here from the Station page
  renderShipyardPanel(document, catalog, corp, {
    queue: (unitId, quantity) => queueShips(unitId, quantity),
    cancel: (jobId) => cancelShipJob(jobId)
  }, { fleet: corp.fleet || null, researchName: (id) => techTree.find((t) => t.id === id)?.name || id });
  renderTrainingPanel(document, catalog, corp, {
    train: (unitId, quantity) => trainTroops(unitId, quantity),
    cancel: (jobId) => cancelTroopJob(jobId)
  }, { researchName: (id) => techTree.find((t) => t.id === id)?.name || id, stationName });
}

const countsFrom = (root, prefix) => Object.fromEntries(FLEET_TYPES.map((id) => [id, Math.max(0, Math.floor(Number(root.querySelector(`[data-${prefix}-count="${id}"]`)?.value) || 0))]).filter(([, n]) => n > 0));

function bindFleetList(list) {
  list.onclick = async (event) => {
    const target = event.target.closest("button");
    if (!target || target.disabled) return;
    const card = target.closest("[data-fleet], [data-fleet-form]");
    const status = card?.querySelector("[role=status]");
    const fail = (error) => { if (status) status.innerHTML = refusalStatusHtml(error?.message || "The order was refused."); target.disabled = false; };
    try {
      if (target.matches("[data-fleet-form-submit]")) {
        target.disabled = true;
        const account = await post("/fleets/form", { ...countsFrom(card, "form"), name: card.querySelector("[data-form-name]")?.value });
        redraw(account, `${account.fleet.name} formed.`, "complete");
      } else if (target.matches("[data-fleet-split]")) {
        const id = target.getAttribute("data-fleet-split");
        target.disabled = true;
        const account = await post(`/fleets/${encodeURIComponent(id)}/split`, { ...countsFrom(card, `split-${id}`), name: card.querySelector(`[data-split-name="${CSS.escape(id)}"]`)?.value });
        redraw(account, `${account.part.name} split off.`, "complete");
      } else if (target.matches("[data-fleet-merge]")) {
        const id = target.getAttribute("data-fleet-merge");
        target.disabled = true;
        const into = card.querySelector(`[data-fleet-merge-into="${CSS.escape(id)}"]`).value;
        const account = await post(`/fleets/${encodeURIComponent(id)}/merge`, { intoFleetId: into });
        redraw(account, `Merged into ${account.fleet.name}.`, "complete");
      } else if (target.matches("[data-fleet-disband]")) {
        const id = target.getAttribute("data-fleet-disband");
        const ok = await showTradeConfirmation({ heading: "Fleet Orders", title: "Disband this fleet?", confirmLabel: "Disband",
          rows: [{ label: "Its units", value: "return to your reserve here" }, { label: "Cost", value: "nothing" }] });
        if (!ok) return;
        target.disabled = true;
        redraw(await post(`/fleets/${encodeURIComponent(id)}/disband`), "Fleet disbanded.", "complete");
      } else if (target.matches("[data-fleet-deploy]")) {
        const id = target.getAttribute("data-fleet-deploy");
        const picker = card.querySelector(`[data-fleet-picker="${CSS.escape(id)}"]`);
        target.disabled = true;
        const res = await parseJsonResponse(await apiFetch(accountPath(`/fleets/${encodeURIComponent(id)}/destinations`)));
        picker.innerHTML = destinationsHtml(id, res.destinations);
        picker.hidden = false;
        target.disabled = false;
        picker.querySelector("button:not([disabled])")?.focus();
      } else if (target.matches("[data-deploy-close]")) {
        const picker = card.querySelector("[data-fleet-picker]");
        picker.hidden = true; picker.innerHTML = "";
      } else if (target.matches("[data-deploy-to]")) {
        const id = target.getAttribute("data-deploy-fleet"), to = target.getAttribute("data-deploy-to");
        const ms = Number(target.getAttribute("data-deploy-ms"));
        const ok = await showTradeConfirmation({ heading: "Fleet Orders", title: `Deploy ${card.querySelector("h4")?.textContent || "this fleet"}?`, confirmLabel: "Send",
          rows: [{ label: "Destination", value: target.getAttribute("data-deploy-name") },
            { label: "Travel time", value: durationText(ms) },
            { label: "Arrives", value: utcTime(Date.now() + ms) }, // ISP-249 (AB#945)
            { label: "While in transit", value: "it takes no orders", muted: true }] });
        if (!ok) return;
        target.disabled = true;
        const account = await post(`/fleets/${encodeURIComponent(id)}/deploy`, { toStationId: to });
        redraw(account, `${account.fleet.name} is on its way.`, "active");
      }
    } catch (error) { fail(error); }
  };
}

// ISP-171 (AB#865): the shipyard's two actions. The server takes a ship and a quantity and nothing else.
async function queueShips(unitId, quantity) {
  const account = await parseJsonResponse(await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/shipyard/queue`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unitId, quantity })
  }));
  redraw(account, account.receipt?.title || "Ships queued.", "queued");
  showActionReceipt(account, { returnFocusTo: firstPresent("#station-shipyard [data-ship-queue]", ".nav-tab[data-tab='fleet']") });
}

async function cancelShipJob(jobId) {
  const account = await parseJsonResponse(await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/shipyard/cancel`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId })
  }));
  redraw(account, account.receipt?.title || "Production cancelled.", "cancelled");
  showActionReceipt(account, { returnFocusTo: firstPresent("#station-shipyard [data-ship-queue]", ".nav-tab[data-tab='fleet']") });
}

// ISP-172 (AB#866): troop training's two actions. The server takes the troops and a number of squads, nothing else.
async function trainTroops(unitId, quantity) {
  const account = await parseJsonResponse(await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/training/queue`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unitId, quantity })
  }));
  redraw(account, account.receipt?.title || "Training started.", "queued");
  showActionReceipt(account, { returnFocusTo: firstPresent("#station-training [data-troop-train]", ".nav-tab[data-tab='fleet']") });
}

async function cancelTroopJob(jobId) {
  const account = await parseJsonResponse(await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/training/cancel`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId })
  }));
  redraw(account, account.receipt?.title || "Training cancelled.", "cancelled");
  showActionReceipt(account, { returnFocusTo: firstPresent("#station-training [data-troop-train]", ".nav-tab[data-tab='fleet']") });
}
