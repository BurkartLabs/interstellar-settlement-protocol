// The Fleet tab's markup (ISP-175, AB#869): the units, what they cost to keep and how ready they are, the fleets and
// where they are, the destination picker. Text first: every figure is a word or a number in a table or a sentence,
// readable with graphics off (the design goal). Pure, so it loads in node; public/scripts/views/fleet.js draws it and
// sends the orders. The rules are the server's: the upkeep here is public/scripts/militaryUpkeep.js, the rule the
// ticker charges by, and a destination's trip length comes from the server (GET /fleets/:id/destinations).
import { escapeHtml } from "./html.js";
import { durationText } from "./shipyardPanel.js";
import { shipyardTierOf, upkeepBreakdown } from "./militaryUpkeep.js";
import { utcTime } from "./timeFormat.js";

export const FLEET_TYPES = ["lf", "ds", "se", "at"];
export const FLEET_NAMES = ["Vanguard", "Aegis", "Bastion", "Corsair", "Halberd", "Lancer", "Meridian", "Nomad",
  "Paladin", "Rampart", "Sentinel", "Talon", "Tempest", "Valkyrie", "Warden", "Zenith"]; // server/fleets.js's list
const money = (n) => `¤${Math.round(n).toLocaleString("en-US")}`;
const plural = (n, name) => `${n} ${name}${n === 1 ? "" : "s"}`;
const count = (units, id) => Math.max(0, Math.floor(Number(units?.[id]) || 0));
const utc = (ms, now) => utcTime(ms, { now }); // ISP-249 (AB#945): dated unless it falls on the screen's today

/** How many of each type the fleets hold, and the reserve: what no fleet holds. */
export function fleetTotals(corp) {
  const fleets = corp?.military?.fleets || [];
  const inFleets = Object.fromEntries(FLEET_TYPES.map((id) => [id, fleets.reduce((s, f) => s + count(f.units, id), 0)]));
  const reserve = Object.fromEntries(FLEET_TYPES.map((id) => [id, count(corp?.military?.units, id) - inFleets[id]]));
  return { inFleets, reserve };
}

/** A fleet's units in words: "6 Light Fighters, 2 Destroyers". */
export function unitsText(units, catalog) {
  const names = Object.fromEntries((catalog || []).map((u) => [u.id, u.name]));
  const parts = FLEET_TYPES.filter((id) => count(units, id) > 0).map((id) => id === "at" ? `${count(units, id)} squad${count(units, id) === 1 ? "" : "s"} of Attack Troops` : plural(count(units, id), names[id] || id));
  return parts.join(", ") || "no units";
}

/** Where a fleet is, in words, with its arrival when it is on its way. */
export function locationText(fleet, stationName, now = Date.now()) {
  if (fleet.transit && now < fleet.transit.arrivesAt) {
    return `In transit to ${stationName(fleet.transit.toStationId)}, arrives in ${durationText(fleet.transit.arrivesAt - now)} (${utc(fleet.transit.arrivesAt, now)})`;
  }
  return `Stationed at ${stationName(fleet.transit?.toStationId || fleet.stationId)}`;
}

/** The forces summary: readiness and why, the day's upkeep and what it rests on, and the Fleet Cap. */
export function forcesSummaryHtml(corp, catalog) {
  const m = corp?.military || {};
  const readiness = Math.round(Number(m.readiness ?? 100));
  const up = upkeepBreakdown(catalog, m.units, shipyardTierOf(corp?.buildings));
  const why = m.upkeep?.short ? "Upkeep is unpaid: readiness falls 10 points a day, to 40, until it is paid; paying restores 20 a day." : "Upkeep is paid.";
  const fleet = corp?.fleet;
  return `<dl class="fleet__summary">
      <div><dt>Readiness</dt><dd><strong data-fleet-readiness>${readiness}%</strong> <span class="station__note">scales attack and accuracy in battle. ${escapeHtml(why)}</span></dd></div>
      <div><dt>Upkeep</dt><dd><strong data-fleet-upkeep>${money(up.total)} a day</strong> <span class="station__note">supply ${up.supply} against a capacity of ${up.capacity}: each unit costs ${up.factor.toFixed(2)}x its base upkeep. A bigger shipyard raises the capacity.</span></dd></div>
      ${fleet ? `<div><dt>Fleet Cap</dt><dd><strong>${fleet.vessels} of ${fleet.cap}</strong> <span class="station__note">vessels: probes and ships, in production included.</span></dd></div>` : ""}
    </dl>`;
}

/** The units table: count, stats and each type's share of the day's upkeep, with a total row. */
export function unitsTableHtml(corp, catalog) {
  const m = corp?.military || {};
  const up = upkeepBreakdown(catalog, m.units, shipyardTierOf(corp?.buildings));
  const { inFleets } = fleetTotals(corp);
  const garrisoned = Object.values(m.garrisons || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  const rows = (catalog || []).map((u) => {
    const n = count(m.units, u.id);
    const where = u.id === "dt" ? `${garrisoned} in garrisons` : `${inFleets[u.id] || 0} in fleets, ${n - (inFleets[u.id] || 0)} in reserve`;
    // data-label: on a phone each row is a card and each cell names its column (the design system's .ui-table)
    const cell = (label, value, num = true) => `<td class="${num ? "num ui-table__num" : ""}" data-label="${label}">${value}</td>`;
    return `<tr data-unit-row="${escapeHtml(u.id)}"><th scope="row">${escapeHtml(u.name)}</th>${cell("Count", n)}${cell("Where", escapeHtml(where), false)}
      ${cell("Attack", u.attack)}${cell("Defense", u.hp)}${cell("Accuracy", u.accuracy)}${cell("Evasion", u.evasion)}${cell("Upkeep a day", money(up.perType[u.id] || 0))}</tr>`;
  }).join("");
  const total = (catalog || []).reduce((s, u) => s + count(m.units, u.id), 0);
  return `<div class="fleet__table-wrap"><table class="ui-table fleet__units">
      <caption class="sr-only">Units by type</caption>
      <thead><tr><th scope="col">Type</th><th scope="col">Count</th><th scope="col">Where</th><th scope="col">Attack</th><th scope="col">Defense</th><th scope="col">Accuracy</th><th scope="col">Evasion</th><th scope="col">Upkeep a day</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th scope="row">Total</th><td class="num ui-table__num" data-label="Count">${total}</td><td class="fleet__spacer" colspan="5"></td><td class="num ui-table__num" data-label="Upkeep a day" data-upkeep-total>${money(up.total)}</td></tr></tfoot>
    </table></div>`;
}

/** The count inputs a form or split order takes, one a fleet type, each at most `max`. */
function countInputs(prefix, max, catalog) {
  const names = Object.fromEntries((catalog || []).map((u) => [u.id, u.name]));
  return FLEET_TYPES.map((id) => `<label class="ui-field fleet__count">${escapeHtml(id === "at" ? "Attack Troops" : `${names[id] || id}s`)} <span class="station__note">(${max[id] || 0})</span>
      <input class="ui-input" type="number" min="0" max="${max[id] || 0}" step="1" value="0" data-${prefix}-count="${id}" ${max[id] ? "" : "disabled"}></label>`).join("");
}
const nameSelect = (attr, taken) => `<label class="ui-select">Name <select class="ui-select" ${attr}>${FLEET_NAMES.filter((n) => !taken.has(n)).map((n) => `<option>${escapeHtml(n)}</option>`).join("")}</select></label>`;

/** One fleet: name, units, where it is, readiness, and the orders it can take now. */
export function fleetCardHtml(fleet, corp, catalog, { stationName, now = Date.now() }) {
  const moving = Boolean(fleet.transit && now < fleet.transit.arrivesAt);
  const here = !moving && (fleet.transit?.toStationId || fleet.stationId) === corp.currentStationId;
  const others = (corp.military?.fleets || []).filter((f) => f.id !== fleet.id && !(f.transit && now < f.transit.arrivesAt) && (f.transit?.toStationId || f.stationId) === (fleet.transit?.toStationId || fleet.stationId));
  const taken = new Set((corp.military?.fleets || []).map((f) => f.name));
  const readiness = Math.round(Number(corp.military?.readiness ?? 100));
  const orders = moving ? `<p class="station__note">In transit: it takes no orders until it arrives.</p>` : `
      <div class="fleet__orders">
        <button class="ui-button ui-button--primary" type="button" data-fleet-deploy="${escapeHtml(fleet.id)}">Deploy…</button>
        ${others.length ? `<label class="ui-select">Merge into <select class="ui-select" data-fleet-merge-into="${escapeHtml(fleet.id)}">${others.map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join("")}</select></label>
        <button class="ui-button ui-button--secondary" type="button" data-fleet-merge="${escapeHtml(fleet.id)}">Merge</button>` : ""}
        ${here ? `<button class="ui-button ui-button--secondary" type="button" data-fleet-disband="${escapeHtml(fleet.id)}">Disband</button>` : ""}
      </div>
      <details class="fleet__split"><summary>Split off part of this fleet</summary>
        <div class="fleet__counts">${countInputs(`split-${fleet.id}`, fleet.units, catalog)}</div>
        ${nameSelect(`data-split-name="${escapeHtml(fleet.id)}"`, taken)}
        <button class="ui-button ui-button--secondary" type="button" data-fleet-split="${escapeHtml(fleet.id)}">Split</button>
      </details>
      <div class="fleet__picker" data-fleet-picker="${escapeHtml(fleet.id)}" hidden></div>`;
  return `<article class="ui-card fleet__card" data-fleet="${escapeHtml(fleet.id)}">
      <header class="station__card-header"><h4>${escapeHtml(fleet.name)}</h4><span class="ui-badge">${moving ? "In transit" : "Stationed"}</span></header>
      <p class="ui-card__body">${escapeHtml(unitsText(fleet.units, catalog))}</p>
      <p data-fleet-location>${escapeHtml(locationText(fleet, stationName, now))}</p>
      <p class="station__note">Readiness ${readiness}%</p>
      ${orders}
      <p class="station__hint" role="status" aria-live="polite"></p>
    </article>`;
}

/** The form-a-fleet card: counts from the reserve, a name from the list. */
export function formFleetHtml(corp, catalog, stationName) {
  const { reserve } = fleetTotals(corp);
  const any = FLEET_TYPES.some((id) => reserve[id] > 0);
  const taken = new Set((corp.military?.fleets || []).map((f) => f.name));
  if (!any) return `<article class="ui-card"><h4>Form a fleet</h4><p class="station__note">Nothing in reserve: every ship and squad of Attack Troops is in a fleet, or none has been built. Queue ships and train troops below.</p></article>`;
  return `<article class="ui-card" data-fleet-form>
      <h4>Form a fleet</h4>
      <p class="station__note">From your reserve, at ${escapeHtml(corp.currentStationId ? stationName(corp.currentStationId) : "the station you dock at")}.</p>
      <div class="fleet__counts">${countInputs("form", reserve, catalog)}</div>
      ${nameSelect("data-form-name", taken)}
      <button class="ui-button ui-button--primary" type="button" data-fleet-form-submit ${corp.currentStationId ? "" : "disabled"}>Form fleet</button>
      <p class="station__hint" role="status" aria-live="polite"></p>
    </article>`;
}

/** The destination picker: each station with its trip length, the ones out of reach saying why. */
export function destinationsHtml(fleetId, destinations) {
  const rows = destinations.map((d) => `<li class="fleet__destination">
      <span><strong>${escapeHtml(d.name)}</strong> <span class="station__note">${escapeHtml(d.systemName)} · ${escapeHtml(durationText(d.travelMs))}</span>${d.reachable ? "" : ` <span class="station__blocked">${escapeHtml(d.why || "Out of reach.")}</span>`}</span>
      <button class="ui-button ui-button--secondary" type="button" data-deploy-to="${escapeHtml(d.stationId)}" data-deploy-fleet="${escapeHtml(fleetId)}" data-deploy-ms="${d.travelMs}" data-deploy-name="${escapeHtml(d.name)}" ${d.reachable ? "" : "disabled"}>Send here</button>
    </li>`).join("");
  return `<h5>Choose a destination</h5><ul class="fleet__destinations">${rows}</ul>
    <button class="ui-button ui-button--secondary" type="button" data-deploy-close="${escapeHtml(fleetId)}">Close</button>`;
}
