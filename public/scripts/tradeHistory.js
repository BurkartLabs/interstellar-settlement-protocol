// AB#1168: how a Trade History row names its type and its total, in one place a test can check against every type the
// server writes (server/routes/market.js). `movedMoney: false` rows (a listing posted or taken down) show no total.
import { toCurrency } from "./helpers.js";
import { escapeHtml } from "./html.js";

export const TRADE_TYPES = {
  listed: { label: "Listed", cls: "trade-type-listed", movedMoney: false },
  cancelled: { label: "Cancelled", cls: "trade-type-cancelled", movedMoney: false },
  sold: { label: "Sold", cls: "trade-type-sold", movedMoney: true },
  "sold-npc": { label: "Sold (NPC)", cls: "trade-type-sold", movedMoney: true },
  bought: { label: "Bought", cls: "trade-type-bought", movedMoney: true }
};

export function tradeTypeBadge(t) {
  const known = TRADE_TYPES[t.type];
  return `<span class="trade-type-badge ${known ? known.cls : ""}">${known ? known.label : escapeHtml(t.type)}</span>`;
}

export function tradeTotalCell(t) {
  if (TRADE_TYPES[t.type]?.movedMoney === false) return "-";
  const hasTax = typeof t.taxAmount === "number" && t.taxAmount > 0;
  return hasTax
    ? `${toCurrency(t.proceeds)} <span class="trade-tax-note">(${toCurrency(t.taxAmount)} tax)</span>`
    : toCurrency(t.total || 0);
}
