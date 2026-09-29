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

// Bug #4853: every deduction a sale can carry (server/marketSettlement.js, server/routes/market.js), in the order the
// settlement takes them. The Trade History total and the NPC sale's status line both build their note from this, so a
// tariff or a withholding is never taken without a line saying where it went.
const SALE_DEDUCTIONS = [
  ["taxAmount", "tax"],
  ["tariffAmount", "tariff"],
  ["dutyWithheld", "withheld for ITC duty"],
  ["councilWithheld", "withheld toward an Arbitration Council award"],
  ["royaltyWithheld", "withheld toward patent royalties owed"]
];

/** What a sale took, one "N label" phrase per deduction it carries; [] when it took nothing. */
export function saleDeductions(t) {
  return SALE_DEDUCTIONS.filter(([key]) => Number(t?.[key]) > 0).map(([key, label]) => `${toCurrency(t[key])} ${label}`);
}

export function tradeTotalCell(t) {
  if (TRADE_TYPES[t.type]?.movedMoney === false) return "-";
  const taken = saleDeductions(t);
  return taken.length && typeof t.proceeds === "number"
    ? `${toCurrency(t.proceeds)} <span class="exchange__tax">(${taken.join(", ")})</span>`
    : toCurrency(t.total || 0);
}
