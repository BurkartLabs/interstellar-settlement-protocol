// The Mercenary Rentals panel's markup (ISP-177, AB#871): open fleet offers with their units, combat totals and terms;
// the form to offer one of your own fleets, with what it earns and what a renter must post; and your contracts, both
// sides, with time left or how they settled. Pure, so it loads in node; public/scripts/views/mercenaries.js fetches the
// data (GET /gameplay/mercenaries and /mercenaries/mine) and sends the orders. The rules are server/mercenaries.js.
import { escapeHtml } from "./html.js";
import { durationText } from "./shipyardPanel.js";
import { unitsText } from "./fleetView.js";

export const TERMS_HOURS = [12, 24, 72, 168];
export const USES = [["defense", "Defense only"], ["pve", "PvE and defense"], ["raids", "Raids, PvE and defense"]];
const useLabel = (u) => USES.find(([id]) => id === u)?.[1] || u;
const power = (o) => `${Number(o.attack || 0).toLocaleString("en-US")} ATK / ${Number(o.defense || 0).toLocaleString("en-US")} DEF`; // a number keeps its unit
const money = (n) => `¤${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
const termText = (h) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hours`);

/** The open offers as a table: units, combat totals, term, price, collateral, allowed use and Hire (not for your own). */
export function offersTableHtml(offers = [], catalog = []) {
  if (!offers.length) return `<div class="ui-state"><p class="ui-state__title">No fleets for hire</p><p class="ui-state__why">No corporation has a fleet on offer right now. Offer one of yours below.</p></div>`;
  const rows = offers.map((o) => `<tr data-merc-offer="${escapeHtml(o.id)}">
      <td data-label="Fleet"><span class="mercs__who"><strong>${escapeHtml(o.fleetName)}</strong><span class="station__note">${escapeHtml(o.ownerName)}</span></span></td>
      <td data-label="Units">${escapeHtml(unitsText(o.units, catalog))}</td>
      <td class="ui-table__num" data-label="Attack / defense">${power(o)}</td>
      <td data-label="Term">${escapeHtml(termText(o.termHours))}</td>
      <td class="ui-table__num" data-label="Price">${money(o.price)}</td>
      <td class="ui-table__num" data-label="Collateral">${money(o.collateral)}</td>
      <td data-label="Allowed use">${escapeHtml(useLabel(o.allowedUse))}</td>
      <td data-label="Action">${o.mine ? `<span class="station__note">Your offer</span>` : `<button class="ui-button ui-button--primary" type="button" data-merc-hire="${escapeHtml(o.id)}">Hire</button>`}</td>
    </tr>`).join("");
  return `<div class="ui-table-wrap"><table class="ui-table mercs__offers">
      <thead><tr><th>Fleet</th><th>Units</th><th class="ui-table__num">Attack / defense</th><th>Term</th><th class="ui-table__num">Price</th><th class="ui-table__num">Collateral</th><th>Allowed use</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

/** What an offer earns and what a renter must post, for the form's preview. */
export function offerPreview({ termHours, price, collateral, value }) {
  const p = Math.max(0, Math.floor(Number(price) || 0)), c = Math.max(0, Math.floor(Number(collateral) || 0));
  const days = (Number(termHours) || 24) / 24;
  return {
    income: p, perDay: Math.round(p / days), renterPosts: p + c,
    text: `You earn ${money(p)} when the term ends (${money(Math.round(p / days))} a day). A renter posts ${money(p + c)}: the price, and ${money(c)} of collateral that pays for any of your units lost${Number.isFinite(value) ? `, up to the fleet's value of ${money(value)}` : ""}.`
  };
}

/** The offer form: one of your fleets that is stationed and free, a term, a price, a collateral and an allowed use. */
export function offerFormHtml(fleets = [], valueOf = () => 0, catalog = [], now = Date.now()) {
  const free = fleets.filter((f) => !f.contract && !(f.transit && now < f.transit.arrivesAt));
  if (!free.length) return `<p class="station__note">None of your fleets can be offered: form a fleet on the Fleet tab, and it must be stationed and not already under contract.</p>`;
  const cap = valueOf(free[0]), start = Math.min(10000, cap);
  return `<form class="mercs__form ui-stack" data-merc-form>
      <label class="ui-field"><span class="ui-field__label">Fleet</span><select class="ui-select" data-merc-fleet>${free.map((f) => `<option value="${escapeHtml(f.id)}" data-value="${valueOf(f)}">${escapeHtml(f.name)}: ${escapeHtml(unitsText(f.units, catalog))}</option>`).join("")}</select></label>
      <div class="mercs__terms">
        <label class="ui-field"><span class="ui-field__label">Term</span><select class="ui-select" data-merc-term>${TERMS_HOURS.map((h) => `<option value="${h}" ${h === 24 ? "selected" : ""}>${escapeHtml(termText(h))}</option>`).join("")}</select></label>
        <label class="ui-field"><span class="ui-field__label">Price (credits)</span><input class="ui-input" type="number" min="100" max="10000000" step="1" value="5000" data-merc-price></label>
        <label class="ui-field"><span class="ui-field__label">Collateral (credits)</span><input class="ui-input" type="number" min="1" max="${cap}" step="1" value="${start}" data-merc-collateral></label>
        <label class="ui-field"><span class="ui-field__label">Allowed use</span><select class="ui-select" data-merc-use>${USES.map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join("")}</select></label>
      </div>
      <p class="station__note" data-merc-preview>${escapeHtml(offerPreview({ termHours: 24, price: 5000, collateral: start, value: cap }).text)}</p>
      <button class="ui-button ui-button--primary" type="submit" data-merc-offer-submit>Offer for hire</button>
      <p class="station__hint" role="status" aria-live="polite"></p>
    </form>`;
}

/** One contract, from either side: state, the other party, time left or how it settled. */
export function contractRowHtml(c, side, catalog = [], now = Date.now()) {
  const other = side === "offered" ? (c.renterName ? `Hired by ${c.renterName}` : "Not hired yet") : `From ${c.ownerName}`;
  let status;
  if (c.state === "open") status = `On offer, closes in ${durationText(c.expiresAt - now)}.`;
  else if (c.state === "hired") status = `Under contract: ${durationText(Math.max(0, c.endsAt - now))} left. Escrow holds ${money(c.escrow)}.`;
  else if (c.state === "completed") {
    const s = c.settlement || {};
    const lost = c.lost ? `Lost: ${unitsText(c.lost, catalog)}. ` : "No units lost. ";
    status = `Ended. ${lost}Price ${money(s.price)} paid to the owner; collateral ${money(s.compensation)} paid for losses, ${money(s.refund)} returned to the renter.`;
  } else status = c.state === "expired" ? "Closed unhired." : c.state;
  return `<li class="mercs__contract" data-merc-contract="${escapeHtml(c.id)}">
      <p><strong>${escapeHtml(c.fleetName)}</strong> <span class="ui-badge">${escapeHtml(c.state === "hired" ? "Hired" : c.state === "open" ? "On offer" : c.state === "completed" ? "Ended" : c.state)}</span></p>
      <p class="station__note">${escapeHtml(unitsText(c.units, catalog))} · ${power(c)} · ${escapeHtml(termText(c.termHours))} · ${money(c.price)} · collateral ${money(c.collateral)} · ${escapeHtml(useLabel(c.allowedUse))}</p>
      <p>${escapeHtml(other)}. ${escapeHtml(status)}</p>
      ${side === "offered" && c.state === "open" ? `<button class="ui-button ui-button--secondary" type="button" data-merc-withdraw="${escapeHtml(c.id)}">Withdraw offer</button>` : ""}
    </li>`;
}

/** My contracts, both sides. */
export function myContractsHtml(mine = { offered: [], hired: [] }, catalog = [], now = Date.now()) {
  const list = (items, side, empty) => (items.length ? `<ul class="mercs__contracts">${items.map((c) => contractRowHtml(c, side, catalog, now)).join("")}</ul>` : `<p class="station__note">${empty}</p>`);
  return `<div class="mercs__mine">
      <div><h4>Your fleets on offer or hired out</h4>${list(mine.offered || [], "offered", "None of your fleets is on offer.")}</div>
      <div><h4>Fleets you have hired</h4>${list(mine.hired || [], "hired", "You have not hired a fleet.")}</div>
    </div>`;
}
