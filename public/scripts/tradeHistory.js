// AB#1168: how a Trade History row names its type and its total, in one place a test can check against every type the
// server writes (server/routes/market.js). `movedMoney: false` rows (a listing posted or taken down) show no total.
import { toCurrency } from "./helpers.js";
import { escapeHtml } from "./html.js";

// ISP-80 (AB#769): each type is a design-system badge; `tone` is its ui-badge modifier, "" for the plain one.
export const TRADE_TYPES = {
  listed: { label: "Listed", tone: "", movedMoney: false },
  cancelled: { label: "Cancelled", tone: "warn", movedMoney: false },
  sold: { label: "Sold", tone: "success", movedMoney: true },
  "sold-npc": { label: "Sold (NPC)", tone: "success", movedMoney: true },
  bought: { label: "Bought", tone: "accent", movedMoney: true },
  bid: { label: "Buy order", tone: "", movedMoney: false } // AB#1054: credits held, nothing bought yet
};

export function tradeTypeBadge(t) {
  const known = TRADE_TYPES[t.type];
  return `<span class="ui-badge${known?.tone ? ` ui-badge--${known.tone}` : ""}" data-trade-type="${escapeHtml(t.type)}">${known ? known.label : escapeHtml(t.type)}</span>`;
}

export function tradeTotalCell(t) {
  if (TRADE_TYPES[t.type]?.movedMoney === false) return "-";
  const hasTax = typeof t.taxAmount === "number" && t.taxAmount > 0;
  return hasTax
    ? `${toCurrency(t.proceeds)} <span class="exchange__tax">(${toCurrency(t.taxAmount)} tax)</span>`
    : toCurrency(t.total || 0);
}
