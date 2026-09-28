// How the viewer has chosen to see the Galactic Exchange: which resource, which kind of order, and in what order
// (AB#402). Client-side only: it sorts and filters what the client already has, and the choice is remembered per
// viewer in localStorage. Storage can be missing, blocked or hold anything, so every read is validated and every
// access is wrapped: the worst case is the defaults.

import { escapeHtml } from "./html.js";
import { wholeNumber } from "./wholeNumber.js";

/**
 * AB#1164: the numbers typed into an Exchange form, read the way the server's input check reads them. `ok` is true
 * when every value is a whole number of at least 1, which is when a confirmation is worth showing; otherwise the form
 * sends what was typed and shows the server's refusal. It never turns a blank or a 0 into 1.
 */
export function tradeNumbers(raw) {
  const values = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const n = wholeNumber(typeof value === "string" ? value : value ?? "");
    values[key] = n !== null && n >= 1 ? n : null;
  }
  return { ok: Object.values(values).every((n) => n !== null), values };
}

export const EXCHANGE_VIEW_KEY = "isp.exchangeView";

/**
 * AB#2472: the Exchange's subpages, the first the default. They replaced the "Show" filter (AB#402), whose choice an
 * older saved view may still hold: LEGACY_TYPE_PAGE reads it as the page with those orders.
 */
export const EXCHANGE_PAGES = ["standing", "players", "mine", "mercs", "history"];
const LEGACY_TYPE_PAGE = { sell: "players", bids: "players", standing: "standing", mine: "mine" };
/** The pages that show the price chart and the filters: the ones with orders to filter. */
export const ORDER_PAGES = new Set(["standing", "players", "mine"]);

/** Sort orders, as the value of the sort control. */
export const SORTS = ["newest", "oldest", "price-asc", "price-desc", "qty-desc", "qty-asc"];

/** ISP-208 (AB#903): whose player listings to show: everyone's, or only the viewer's conglomerate partners'. */
export const SELLERS = ["all", "conglomerate"];

/** AB#884: which item tier to show: every tier ("") or one (the catalog's tier, data/items.json). */
export const TIERS = ["", "1", "2", "3", "4"];

export const DEFAULT_EXCHANGE_VIEW = Object.freeze({ resource: "", page: "standing", sort: "newest", sellers: "all", tier: "" });

/** Longer than any resource name, short enough that nothing unbounded is kept. */
const RESOURCE_MAX_LENGTH = 40;

/** A valid view from anything: each field that is not valid falls back to its default on its own. */
export function normalizeExchangeView(raw) {
  const view = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const resource = typeof view.resource === "string" && view.resource.length <= RESOURCE_MAX_LENGTH ? view.resource : "";
  return {
    resource,
    page: EXCHANGE_PAGES.includes(view.page) ? view.page : LEGACY_TYPE_PAGE[view.type] ?? DEFAULT_EXCHANGE_VIEW.page,
    sort: SORTS.includes(view.sort) ? view.sort : DEFAULT_EXCHANGE_VIEW.sort,
    sellers: SELLERS.includes(view.sellers) ? view.sellers : DEFAULT_EXCHANGE_VIEW.sellers,
    tier: TIERS.includes(view.tier) ? view.tier : DEFAULT_EXCHANGE_VIEW.tier
  };
}

/** The viewer's saved view, or the defaults if there is none or storage cannot be read. */
export function loadExchangeView(storage) {
  try {
    const stored = storage?.getItem(EXCHANGE_VIEW_KEY);
    return normalizeExchangeView(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_EXCHANGE_VIEW };
  }
}

/** Remember the view; if storage refuses, the page carries on with the view in memory. */
export function saveExchangeView(storage, view) {
  try {
    storage?.setItem(EXCHANGE_VIEW_KEY, JSON.stringify(normalizeExchangeView(view)));
  } catch {
    // Blocked or full storage only means the choice is not remembered.
  }
}

const price = (o) => Number(o?.unitPrice) || 0;
const quantity = (o) => Number(o?.quantity ?? o?.remainingQty) || 0;
const age = (o) => {
  const t = Number(o?.createdAt);
  return Number.isFinite(t) && t > 0 ? t : null;
};

/**
 * A comparator for Array.prototype.sort, which is stable: orders the sort cannot tell apart keep the order they came
 * in (the server lists newest first). An order with no readable age goes last whichever way age is sorted.
 */
export function orderComparator(sort) {
  switch (sort) {
    case "price-asc": return (a, b) => price(a) - price(b);
    case "price-desc": return (a, b) => price(b) - price(a);
    case "qty-asc": return (a, b) => quantity(a) - quantity(b);
    case "qty-desc": return (a, b) => quantity(b) - quantity(a);
    case "oldest":
    case "newest":
    default: {
      const direction = sort === "oldest" ? 1 : -1;
      return (a, b) => {
        const ta = age(a);
        const tb = age(b);
        if (ta === null || tb === null) return (ta === null) - (tb === null);
        return direction * (ta - tb);
      };
    }
  }
}

/**
 * The orders of one resource (or all), sorted; a new array, so the caller's list is never reordered. ISP-208 (AB#903):
 * with `sellers: "conglomerate"` and a `partners` set, only listings whose seller is a current partner. AB#884: with a
 * `tier` and the items' tiers (`tierOf`, the market's itemTiers), only that tier's items.
 */
export function viewOrders(orders, { resource = "", sort = DEFAULT_EXCHANGE_VIEW.sort, sellers = "all", tier = "" } = {}, { partners = null, tierOf = null } = {}) {
  const list = Array.isArray(orders) ? orders : [];
  const partnerOnly = sellers === "conglomerate" && partners;
  return list
    .filter((o) => !resource || o?.item === resource)
    .filter((o) => !tier || !tierOf || String(tierOf[o?.item]) === tier)
    .filter((o) => !partnerOnly || partners.has(sellerKey(o?.seller)))
    .sort(orderComparator(sort));
}

/** A seller's name as the partner set holds it: corporation names are unique however they are cased or spaced. */
export const sellerKey = (name) => String(name || "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * ISP-208 (AB#903): the names of the viewer's current conglomerate partners (every member but the viewer), from the
 * server's last read of its conglomerate (appState.conglomerate). An empty set outside a conglomerate.
 */
export function partnerNames(conglomerate, myCorpId) {
  return new Set((conglomerate?.members || []).filter((m) => m.corp !== myCorpId && m.corpName).map((m) => sellerKey(m.corpName)));
}

/** ISP-208 (AB#903): what the sell table says when the Sellers filter hides every listing. */
export function partnersEmptyHtml(hiddenCount, resource = "") {
  const noun = hiddenCount === 1 ? "listing" : "listings";
  return `<p class="ui-state__why">No player sell orders from your conglomerate's members${resource ? ` for <strong>${escapeHtml(resource)}</strong>` : ""}. The Sellers filter is hiding ${Number(hiddenCount) || 0} ${noun} from other corporations.</p>
    <button class="ui-button ui-button--secondary" type="button" data-clear-filters>Clear filters</button>`;
}

// AB#1169: how many rows the Sell Orders and My Active Listings tables draw, and what they say when that drops some.
export const SELL_ORDERS_SHOWN = 30;
export const MY_LISTINGS_SHOWN = 50;

/** Plain text, for textContent: "" when every order fits. */
export function cappedNote(shown, total, label) {
  if (!(total > shown)) return "";
  return `Showing ${shown} of ${total} ${label}. Sort by price or filter by resource to see the rest.`;
}

/**
 * What a table says when its orders exist but the resource filter hides them all: which filter did it, how many it
 * hides, and a way out. Kept apart from the "nothing listed yet" line, which is plain muted text.
 */
export function filteredEmptyHtml(label, resource, hiddenCount, filter = "resource") {
  const noun = hiddenCount === 1 ? "order" : "orders";
  // ISP-80 (AB#769): a design-system empty state; the button is found by its data attribute.
  return `<p class="ui-state__why">No ${escapeHtml(label)} for <strong>${escapeHtml(resource)}</strong>: the ${escapeHtml(filter)} filter is hiding ${Number(hiddenCount) || 0} other ${noun}.</p>
    <button class="ui-button ui-button--secondary" type="button" data-clear-filters>Clear filters</button>`;
}
