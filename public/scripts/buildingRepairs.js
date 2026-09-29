// ISP-287 (AB#994; docs/design/v0.10-raids-mercenaries.md, section 3): the Station's Damaged Buildings: each building a
// raid damaged, the output it runs at, the repair price and a Repair button. Every figure is the server's
// (GET /gameplay/building-repairs, server/buildingRepair.js); this module only words them. Pure: it loads in node.
import { escapeHtml } from "./html.js";
import { toCurrency } from "./helpers.js";

export function repairPath(accountId, buildingId) {
  return `/api/accounts/${encodeURIComponent(accountId)}/gameplay/buildings/${encodeURIComponent(buildingId)}/repair`;
}
export function repairsListPath(accountId) {
  return `/api/accounts/${encodeURIComponent(accountId)}/gameplay/building-repairs`;
}

/** Whether any of the corporation's buildings is damaged (the section shows only then). */
export const anyDamaged = (corp) => (corp?.buildings || []).some((b) => Number.isFinite(Number(b?.condition)) && Number(b.condition) < 100);

/** Why a repair cannot be paid now, or "" when it can. */
export function repairBlocker(building, credits) {
  const have = Math.floor(Number(credits) || 0);
  return have < building.repairCost ? `Needs ${toCurrency(building.repairCost)}; you have ${toCurrency(have)}.` : "";
}

/** One card per damaged building, from the server's list. */
export function repairCardsHtml(buildings = [], credits = 0) {
  return buildings.map((b) => {
    const blocked = repairBlocker(b, credits);
    return `<article class="ui-card station__card" data-role="repair-card" data-building-id="${escapeHtml(b.id)}">
        <header class="station__card-header">
          <span class="ui-badge ui-badge--warn">DAMAGED</span>
          <h3>${escapeHtml(b.name)}</h3>
        </header>
        <dl class="ui-kv">
          <dt>Where</dt><dd>${escapeHtml(b.where)}</dd>
          <dt>Condition</dt><dd data-role="repair-condition">${Math.round(b.condition)} of 100</dd>
          <dt>Output</dt><dd data-role="repair-output">${Math.round(b.outputPct)}% until repaired</dd>
          <dt>Repair</dt><dd data-role="repair-cost">${toCurrency(b.repairCost)}</dd>
        </dl>
        ${blocked ? `<p class="station__blocked">${escapeHtml(blocked)}</p>` : ""}
        <p class="station__note" data-role="repair-status" aria-live="polite"></p>
        <footer class="station__card-footer"><button class="ui-button ui-button--primary" type="button" data-repair-building="${escapeHtml(b.id)}"${blocked ? " disabled" : ""}>Repair (${toCurrency(b.repairCost)})</button></footer>
      </article>`;
  }).join("");
}
