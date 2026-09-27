// ISP-191 (AB#885): the Refinery screen's Resource catalog, grouped by the item catalog's tiers.

import { escapeHtml } from "./html.js";

/** AB#885: the tier labels of docs/design/v0.11-tier4.md section 2. */
const TIER_LABELS = { 1: "Tier 1: common raw", 2: "Tier 2: scarce raw", 3: "Tier 3: refined", 4: "Tier 4: exotic" };

/**
 * The Resource catalog, grouped by the catalog's tiers (the market view's itemTiers, AB#884), each group in the data's
 * order. Without tiers (an older server), one list as before.
 */
export function resourceCatalogHtml(names, tiers) {
  const badge = (res) => `<li class="ui-badge">${escapeHtml(res)}</li>`;
  if (!tiers || typeof tiers !== "object") return names.map(badge).join("");
  const groups = new Map();
  for (const res of names) {
    const tier = Number(tiers[res]) || 0;
    groups.set(tier, [...(groups.get(tier) || []), res]);
  }
  return [...groups.keys()].sort((a, b) => a - b).map((tier) => `<li class="refinery__tier" data-tier="${tier}">
    <span class="refinery__tier-label">${escapeHtml(TIER_LABELS[tier] || "Other")}</span>
    <ul class="refinery__catalog">${groups.get(tier).map(badge).join("")}</ul>
  </li>`).join("");
}
