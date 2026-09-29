// The Orbital Shipyard's production panel on the Station page (ISP-171, AB#865): queue ships from the unit catalog and
// see the jobs on the slips. The rules are the server's (server/shipyard.js); this draws them and names the first thing
// in the way, so a form that offers Queue is one the server will take. The Fleet screen (ISP-175) will grow from it.
// Pure apart from renderShipyardPanel, so it loads in node without the page's state.
import { escapeHtml } from "./html.js";
import { protocolLineHtml, refusalMeaning } from "./protocol.js"; // ISP-254 (AB#4810)
const refused = (message) => `${escapeHtml(message)} ${protocolLineHtml({ meaning: refusalMeaning(message), screen: "fleet" })}`;

const money = (n) => `¤${Math.floor(n).toLocaleString("en-US")}`;
const has = (corp, tech) => (corp.unlockedTech || []).includes(tech);
const SHIPYARD = "Orbital Shipyard";

/** The catalog's ships: the units built at the Orbital Shipyard. */
export const shipsOf = (units = []) => units.filter((u) => u.builtAt === "orbital-shipyard");

/** How long, in words: "30 min", "2 h 30 min". */
export function durationText(ms) {
  // ISP-175 (AB#869): under a minute says its seconds (a dev server's 5-second trips), never "0 min"
  if (ms > 0 && ms < 60_000) return `${Math.ceil(ms / 1000)} s`;
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/** Each ship with why it cannot be queued yet ("" when it can), its cost and its build time. */
export function shipOptions(units, corp, researchName = (id) => id) {
  return shipsOf(units).map((u) => {
    const missing = (u.research || []).find((id) => !has(corp, id));
    const goods = Object.entries(u.goods).map(([item, qty]) => `${qty} ${item}`).join(", ");
    return { unit: u, reason: missing ? `needs ${researchName(missing)}` : "", cost: `${money(u.credits)} and ${goods} each`, time: durationText(u.buildMinutes * 60_000) };
  });
}

function jobRow(job, units, now) {
  const unit = units.find((u) => u.id === job.unitId);
  const name = `${job.quantity} ${unit?.name || job.unitId}${job.quantity === 1 ? "" : "s"}`;
  const started = now >= job.startsAt;
  const when = started ? `ready in ${durationText(job.completesAt - now)}` : `starts in ${durationText(job.startsAt - now)}, then ${durationText(job.completesAt - job.startsAt)}`;
  return `<li class="shipyard__job" data-ship-job="${escapeHtml(job.id)}">
      <span><strong>${escapeHtml(name)}</strong> <span class="station__note">${escapeHtml(when)}</span></span>
      <button class="ui-button ui-button--secondary" data-ship-cancel="${escapeHtml(job.id)}" type="button">Cancel (returns ${started ? "half" : "all"})</button>
    </li>`;
}

/**
 * The panel's markup, or "" when the corporation has no Orbital Shipyard. `fleet` is the sidebar's Fleet Cap figures
 * ({ vessels, cap }) from the account the server sent.
 */
export function shipyardPanelHtml(units = [], corp = {}, { fleet = null, now = Date.now(), researchName } = {}) {
  if (!(corp.buildings || []).some((b) => b?.name === SHIPYARD)) return "";
  const options = shipOptions(units, corp, researchName);
  const queue = corp.shipyard?.queue || [];
  const any = options.some((o) => !o.reason);
  const choices = options.map((o) => `<option value="${escapeHtml(o.unit.id)}" data-cost="${escapeHtml(`${o.cost}; ${o.time} each`)}" ${o.reason ? "disabled" : ""}>${escapeHtml(o.unit.name)}${o.reason ? ` (${escapeHtml(o.reason)})` : ""}</option>`).join("");
  const first = options.find((o) => !o.reason);
  const room = fleet ? `Fleet: ${fleet.vessels} of ${fleet.cap} vessels, ships in production included.` : "";
  return `
    <form class="shipyard__form ui-card" data-shipyard-form>
      <label class="ui-select">Ship <select class="ui-select" name="unitId" data-ship-unit ${any ? "" : "disabled"}>${choices}</select></label>
      <p class="station__note" data-ship-cost>${escapeHtml(first ? `${first.cost}; ${first.time} each` : "")}</p>
      <label class="ui-field">How many <input class="ui-input" name="quantity" type="number" min="1" max="100" step="1" value="1" data-ship-quantity ${any ? "" : "disabled"}></label>
      <button class="ui-button ui-button--primary" type="submit" data-ship-queue ${any ? "" : "disabled"}>Queue</button>
      <p class="station__note">${escapeHtml(room)} Paid when queued, in credits and in goods from the station you are docked at.</p>
      ${any ? "" : `<p class="station__blocked">${escapeHtml(`Every ship needs research first: ${options.map((o) => `${o.unit.name} ${o.reason}`).join("; ")}.`)}</p>`}
      <p class="station__hint" role="status" aria-live="polite"></p>
    </form>
    <div class="ui-card">
      <h4 class="station__subheading">On the slips</h4>
      ${queue.length ? `<ul class="shipyard__jobs">${queue.map((j) => jobRow(j, units, now)).join("")}</ul>` : `<p class="station__note">Nothing in production.</p>`}
    </div>`;
}

/**
 * Draw the panel into the Station page and bind it. Shows the section only when the corporation has a shipyard.
 *   handlers.queue(unitId, quantity)  sends the queue request; resolves when the page has redrawn
 *   handlers.cancel(jobId)            sends the cancel request
 */
export function renderShipyardPanel(doc, units, corp, handlers, ctx = {}) {
  const section = doc.getElementById("station-shipyard-section");
  const host = doc.getElementById("station-shipyard");
  if (!section || !host) return false;
  const html = shipyardPanelHtml(units, corp, ctx);
  section.hidden = !html;
  host.innerHTML = html;
  if (!html) return true;
  const form = host.querySelector("[data-shipyard-form]");
  const status = form.querySelector("[role=status]");
  const pick = form.querySelector("[data-ship-unit]"), costLine = form.querySelector("[data-ship-cost]");
  pick.onchange = () => { costLine.textContent = pick.selectedOptions[0]?.dataset.cost || ""; };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector("[data-ship-queue]");
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = "";
    try {
      await handlers.queue(form.querySelector("[data-ship-unit]").value, Number(form.querySelector("[data-ship-quantity]").value));
    } catch (error) {
      status.innerHTML = refused(error?.message || "The shipyard refused that."); // ISP-254 (AB#4810)
      button.disabled = false;
    }
  };
  host.onclick = async (event) => {
    const cancel = event.target.closest("[data-ship-cancel]");
    if (!cancel || cancel.disabled) return;
    cancel.disabled = true;
    try { await handlers.cancel(cancel.getAttribute("data-ship-cancel")); } catch (error) { status.innerHTML = refused(error?.message || "Could not cancel."); cancel.disabled = false; }
  };
  return true;
}
