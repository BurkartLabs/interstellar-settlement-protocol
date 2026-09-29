// Troop training at Headquarters, on the Station page (ISP-172, AB#866): train Attack and Defense Troops from the unit
// catalog, see the jobs in training, and each station's garrison. The rules are the server's (server/training.js); this
// draws them and names the first thing in the way. Pure apart from renderTrainingPanel, so it loads in node.
import { escapeHtml } from "./html.js";
import { protocolLineHtml, refusalMeaning } from "./protocol.js"; // ISP-254 (AB#4810)
const refused = (message) => `${escapeHtml(message)} ${protocolLineHtml({ meaning: refusalMeaning(message), screen: "fleet" })}`;
import { durationText } from "./shipyardPanel.js"; // ISP-171 (AB#865): one way of writing a build time

const money = (n) => `¤${Math.floor(n).toLocaleString("en-US")}`;
const has = (corp, tech) => (corp.unlockedTech || []).includes(tech);
const squads = (n, name) => `${n} squad${n === 1 ? "" : "s"} of ${name}`;

/** The catalog's troops: the units trained at Headquarters. */
export const troopsOf = (units = []) => units.filter((u) => u.builtAt === "headquarters");

/** Each troop type with why it cannot be trained yet ("" when it can), its cost and its training time. */
export function troopOptions(units, corp, researchName = (id) => id) {
  return troopsOf(units).map((u) => {
    const missing = (u.research || []).find((id) => !has(corp, id));
    const goods = Object.entries(u.goods).map(([item, qty]) => `${qty} ${item}`).join(", ");
    return { unit: u, reason: missing ? `needs ${researchName(missing)}` : "", cost: `${money(u.credits)} and ${goods} a squad; ${durationText(u.buildMinutes * 60_000)} each` };
  });
}

/** Where the defense troops stand, a line a station: "Earth Station Prime: 10 squads". */
export function garrisonLines(corp, stationName = (id) => id) {
  return Object.entries(corp.military?.garrisons || {}).filter(([, n]) => n > 0)
    .map(([id, n]) => `${stationName(id)}: ${n} squad${n === 1 ? "" : "s"}`);
}

function jobRow(job, units, now) {
  const unit = units.find((u) => u.id === job.unitId);
  const started = now >= job.startsAt;
  const when = started ? `ready in ${durationText(job.completesAt - now)}` : `starts in ${durationText(job.startsAt - now)}, then ${durationText(job.completesAt - job.startsAt)}`;
  return `<li class="shipyard__job" data-troop-job="${escapeHtml(job.id)}">
      <span><strong>${escapeHtml(squads(job.quantity, unit?.name || job.unitId))}</strong> <span class="station__note">${escapeHtml(when)}</span></span>
      <button class="ui-button ui-button--secondary" data-troop-cancel="${escapeHtml(job.id)}" type="button">Cancel (returns ${started ? "half" : "all"})</button>
    </li>`;
}

/** The panel's markup. Every corporation has a Headquarters, so it is always drawn. */
export function trainingPanelHtml(units = [], corp = {}, { now = Date.now(), researchName, stationName } = {}) {
  const options = troopOptions(units, corp, researchName);
  const queue = corp.training?.queue || [];
  const first = options.find((o) => !o.reason);
  const choices = options.map((o) => `<option value="${escapeHtml(o.unit.id)}" data-cost="${escapeHtml(o.cost)}" ${o.reason ? "disabled" : ""}>${escapeHtml(o.unit.name)}${o.reason ? ` (${escapeHtml(o.reason)})` : ""}</option>`).join("");
  const garrison = garrisonLines(corp, stationName);
  return `
    <form class="shipyard__form ui-card" data-training-form>
      <label class="ui-select">Troops <select class="ui-select" name="unitId" data-troop-unit>${choices}</select></label>
      <p class="station__note" data-troop-cost>${escapeHtml(first?.cost || "")}</p>
      <label class="ui-field">Squads <input class="ui-input" name="quantity" type="number" min="1" max="100" step="1" value="1" data-troop-quantity></label>
      <button class="ui-button ui-button--primary" type="submit" data-troop-train>Train</button>
      <p class="station__note">Paid when you start, in credits and in goods from the station you are docked at. No employees are taken. Defense Troops join the garrison of this station.</p>
      <p class="station__hint" role="status" aria-live="polite"></p>
    </form>
    <div class="ui-card">
      <h4>In training</h4>
      ${queue.length ? `<ul class="shipyard__jobs">${queue.map((j) => jobRow(j, units, now)).join("")}</ul>` : `<p class="station__note">Nobody in training.</p>`}
      <h4>Garrisons</h4>
      ${garrison.length ? `<ul class="shipyard__jobs">${garrison.map((l) => `<li>${escapeHtml(l)} of Defense Troops</li>`).join("")}</ul>` : `<p class="station__note">No station has a garrison yet.</p>`}
    </div>`;
}

/**
 * Draw the panel into the Station page and bind it.
 *   handlers.train(unitId, quantity)  sends the training request; resolves when the page has redrawn
 *   handlers.cancel(jobId)            sends the cancel request
 */
export function renderTrainingPanel(doc, units, corp, handlers, ctx = {}) {
  const host = doc.getElementById("station-training");
  if (!host) return false;
  host.innerHTML = trainingPanelHtml(units, corp, ctx);
  const form = host.querySelector("[data-training-form]");
  const status = form.querySelector("[role=status]");
  const pick = form.querySelector("[data-troop-unit]"), costLine = form.querySelector("[data-troop-cost]");
  if (pick.selectedOptions[0]?.disabled) {
    const open = [...pick.options].find((o) => !o.disabled);
    if (open) { pick.value = open.value; costLine.textContent = open.dataset.cost || ""; }
  }
  pick.onchange = () => { costLine.textContent = pick.selectedOptions[0]?.dataset.cost || ""; };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector("[data-troop-train]");
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = "";
    try {
      await handlers.train(pick.value, Number(form.querySelector("[data-troop-quantity]").value));
    } catch (error) {
      status.innerHTML = refused(error?.message || "Headquarters refused that."); // ISP-254 (AB#4810)
      button.disabled = false;
    }
  };
  host.onclick = async (event) => {
    const cancel = event.target.closest("[data-troop-cancel]");
    if (!cancel || cancel.disabled) return;
    cancel.disabled = true;
    try { await handlers.cancel(cancel.getAttribute("data-troop-cancel")); } catch (error) { status.innerHTML = refused(error?.message || "Could not cancel."); cancel.disabled = false; }
  };
  return true;
}
