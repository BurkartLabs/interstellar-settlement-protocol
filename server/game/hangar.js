// server/game/hangar.js: a conglomerate's pooled goods hangar (ISP-205, AB#899; docs/design/CONGLOMERATES.md, "Pooling:
// the treasury and the hangar"). The same shape as the treasury (server/game/treasury.js), for goods:
//
// - The hangar is at the conglomerate's home station: homeStationId (Earth Station Prime) until it owns a station.
//   A member moves goods between its own inventory at that station and the hangar; nothing travels, so no fee applies.
//   It must be docked there or already hold goods there (the design's rule): the goods are at the station either way.
// - Any member deposits. Withdrawals are capped per role, per item, per UTC day from 00:00: the founder
//   founderWithdrawPct (20%), a director directorWithdrawPct (5%), a member memberGoodsWithdrawPct (2%) of the stock of
//   that item at 00:00 UTC (or, for an item first deposited today, its first row today), so splitting gains nothing.
// - moveHangar is the only way stock changes, and it writes one frozen row to the hangar's own ledger, so each item's
//   rows sum to its stock. The credit ledger is the treasury's; this one is goods only.
// - Items are names from data/items.json (an id is read as its item's name); stations are ids from data/stations.json.
//   Every check runs before anything moves, and a check that cannot run refuses with nothing written (fails closed).

import { CONGLOMERATE_CATALOG, can } from "../conglomerates.js";
import { STATIONS_RAW } from "./catalog.js";
import { ITEMS } from "./items.js";
import { saveAccountsNow } from "./store.js";
import { dayStartOf, ensureHangar, moveHangar } from "./conglomerates.js";

export { ensureHangar, moveHangar };
import { NOT_FOUND, context, corpName, no, roomEvent } from "./membership.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The most units one movement may carry: far above any stock the game makes, and exact in a double. */
export const MAX_HANGAR_QUANTITY = 1_000_000_000;
const STATION_IDS = new Set((STATIONS_RAW.stations || []).map((s) => s.id));
const STATION_NAMES = Object.fromEntries((STATIONS_RAW.stations || []).map((s) => [s.id, s.name]));
const ITEM_BY_KEY = new Map(ITEMS.flatMap((i) => [[i.name, i.name], [i.id, i.name]]));
const plain = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");

/** The item's inventory name for a catalog id or name, or null for anything else. */
export function hangarItem(value) {
  return typeof value === "string" ? ITEM_BY_KEY.get(value.trim()) ?? null : null;
}

/** A whole number of units from 1 to MAX_HANGAR_QUANTITY, or null. */
export function hangarQuantity(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_HANGAR_QUANTITY ? value : null;
}

/** The stock of `item` at 00:00 UTC: its last row before then, or, for an item first deposited today, its first row. */
function openingStock(h, item, now) {
  const start = dayStartOf(now);
  for (let i = h.ledger.length - 1; i >= 0; i -= 1) if (h.ledger[i].item === item && h.ledger[i].at < start) return h.ledger[i].balanceAfter;
  return h.ledger.find((r) => r.item === item && r.at >= start)?.balanceAfter ?? Math.floor(Number(h.items[item]) || 0);
}

/** What `corpId`, holding `role`, may still withdraw of `item` today: { cap, used, remaining, opening, resetsAt }. */
export function goodsAllowance(c, role, corpId, item, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const h = ensureHangar(c, catalog);
  const pct = { founder: catalog.founderWithdrawPct, director: catalog.directorWithdrawPct, member: catalog.memberGoodsWithdrawPct }[role] ?? 0;
  const opening = openingStock(h, item, now);
  const cap = Math.floor((opening * pct) / 100);
  const start = dayStartOf(now);
  const used = h.ledger.filter((r) => r.kind === "withdrawal" && r.corp === corpId && r.item === item && r.at >= start).reduce((s, r) => s - r.amount, 0);
  return { cap, used, remaining: Math.max(0, cap - used), opening, resetsAt: start + DAY_MS };
}

/** The request's station and item, checked: { stationId, item } or a refusal. The goods are at the hangar's station. */
function where(c, corp, stationId, rawItem) {
  if (typeof stationId !== "string" || !STATION_IDS.has(stationId)) return no(400, "unknown-station", "Choose a station from the game's list.");
  const item = hangarItem(rawItem);
  if (!item) return no(400, "unknown-item", "Choose an item from the game's list.");
  const h = ensureHangar(c);
  if (stationId !== h.stationId) return no(409, "wrong-station", `${c.name}'s hangar is at ${STATION_NAMES[h.stationId] || h.stationId}.`);
  const docked = corp.currentStationId === stationId;
  const holds = Object.values(corp.inventory?.[stationId] || {}).some((q) => Number(q) > 0);
  if (!docked && !holds) return no(409, "not-at-station", `Goods move between your own stock at ${STATION_NAMES[stationId] || stationId} and the hangar. Dock there, or ship goods there, first.`);
  return { stationId, item };
}

/** Deposit `quantity` of `item` from the caller's own stock at the hangar's station. Any member; no fee. */
export function depositGoods(accountId, conglomerateId, { stationId, item: rawItem, quantity } = {}, now = Date.now()) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  if (!can(role, "contribute")) return no(403, "not-permitted", "Your role cannot contribute to the hangar.");
  const at = where(c, corp, stationId, rawItem);
  if (at.refused) return at;
  if (hangarQuantity(quantity) === null) return no(400, "invalid-quantity", "Enter a whole number of units, at least 1.");
  const stock = corp.inventory?.[at.stationId] || {};
  const held = Math.floor(Number(stock[at.item]) || 0);
  if (held < quantity) return no(409, "insufficient-stock", `Your corporation holds ${plain(held)} ${at.item} at ${STATION_NAMES[at.stationId]}; it cannot deposit ${plain(quantity)}.`);
  // One step: out of the corporation's stock, into the hangar, one row.
  if (held === quantity) delete stock[at.item];
  else stock[at.item] = held - quantity;
  moveHangar(c, { at: now, kind: "deposit", corp: corp.publicId, item: at.item, quantity, by: corp.publicId });
  saveAccountsNow();
  roomEvent(c, "conglomerate:hangar", { kind: "deposit", corp: corp.publicId, corpName: corp.corporationName, item: at.item, quantity, stock: c.hangar.items[at.item] || 0 });
  return { deposited: { item: at.item, quantity }, hangar: { stationId: c.hangar.stationId, items: { ...c.hangar.items } } };
}

/** Withdraw `quantity` of `item` into the caller's own stock at the hangar's station, within its role's daily cap. */
export function withdrawGoods(accountId, conglomerateId, { stationId, item: rawItem, quantity } = {}, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  let at, allowance;
  try {
    if (!can(role, "withdraw-goods")) return no(403, "not-permitted", "Your role cannot withdraw goods.");
    at = where(c, corp, stationId, rawItem);
    if (at.refused) return at;
    if (hangarQuantity(quantity) === null) return no(400, "invalid-quantity", "Enter a whole number of units, at least 1.");
    allowance = goodsAllowance(c, role, corp.publicId, at.item, now, catalog);
    if (![allowance.cap, allowance.used, allowance.remaining].every(Number.isSafeInteger)) throw new Error("the cap could not be read");
    if (quantity > allowance.remaining) {
      const pct = { founder: catalog.founderWithdrawPct, director: catalog.directorWithdrawPct, member: catalog.memberGoodsWithdrawPct }[role];
      return no(409, "over-daily-cap", `Your role may take ${plain(allowance.cap)} ${at.item} today (${pct}% of the ${plain(allowance.opening)} the hangar held at 00:00 UTC); ${plain(allowance.remaining)} remain. The cap resets at 00:00 UTC.`);
    }
    if (quantity > (c.hangar.items[at.item] || 0)) return no(409, "insufficient-hangar", `The hangar holds ${plain(c.hangar.items[at.item] || 0)} ${at.item}.`);
  } catch (error) {
    console.error("[hangar] a withdrawal check could not run:", error?.message || error);
    return no(503, "hangar-unavailable", "The Bureau cannot check this withdrawal just now; nothing was moved.");
  }
  moveHangar(c, { at: now, kind: "withdrawal", corp: corp.publicId, item: at.item, quantity: -quantity, by: corp.publicId });
  const stock = ((corp.inventory ||= {})[at.stationId] ||= {});
  stock[at.item] = Math.floor(Number(stock[at.item]) || 0) + quantity;
  saveAccountsNow();
  roomEvent(c, "conglomerate:hangar", { kind: "withdrawal", corp: corp.publicId, corpName: corp.corporationName, item: at.item, quantity, stock: c.hangar.items[at.item] || 0 });
  return { withdrawn: { item: at.item, quantity }, hangar: { stationId: c.hangar.stationId, items: { ...c.hangar.items } } };
}

/**
 * The hangar as the caller may see it: its station and holdings for every member, and today's allowance per item for
 * the caller; the whole ledger for the founder and directors, a member's own rows for a member.
 */
export function hangarView(accountId, conglomerateId, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role || !can(role, "view")) return NOT_FOUND.conglomerate();
  const h = ensureHangar(c, catalog);
  const full = can(role, "withdraw-credits"); // the roles that see the whole treasury ledger see the whole hangar's
  const rows = full ? h.ledger : h.ledger.filter((r) => r.corp === corp.publicId);
  return {
    stationId: h.stationId,
    stationName: STATION_NAMES[h.stationId] || h.stationId,
    items: { ...h.items },
    allowance: Object.fromEntries(Object.keys(h.items).map((item) => [item, goodsAllowance(c, role, corp.publicId, item, now, catalog)])),
    ledger: { scope: full ? "all" : "own", rows: rows.slice(-200).reverse().map((r) => ({ ...r, corpName: r.corp ? corpName(r.corp) : "" })), total: rows.length }
  };
}
