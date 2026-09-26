// server/priceHistory.js
// Per-item daily price history for the Galactic Exchange (AB#715, ISP-30): every settled trade adds its price and
// volume to the day's bucket for that item, in global market state, and the last 90 days are kept. Global and
// non-personal: a bucket holds prices, volumes and a trade count, never who traded.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ITEM_NAMES } from "./game/items.js"; // ISP-130 (AB#824)

/** How many calendar days (UTC) of buckets are kept, today included. */
export const PRICE_HISTORY_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC calendar day a timestamp falls on, as YYYY-MM-DD. */
export function dayKey(t) {
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The items that can have a price history: every raw resource in data/refinery-chains.json's resourceCatalog and
 * every refinery output, since both can be listed and bought. Anything else is not an item.
 */
export function tradeableItems(refineryData) {
  const items = new Set(refineryData?.resourceCatalog || []);
  for (const chain of refineryData?.chains || []) {
    for (const input of chain?.inputs || []) if (input?.item) items.add(input.item); // AB#825
    for (const out of chain?.outputs || []) if (out?.item) items.add(out.item);
  }
  return items;
}

const dataFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "refinery-chains.json");
export const PRICE_HISTORY_ITEMS = tradeableItems(JSON.parse(fs.readFileSync(dataFile, "utf8")));
// ISP-130 (AB#824): what can be listed, bought or charted is only ever an item in data/items.json.
{
  const strays = [...PRICE_HISTORY_ITEMS].filter((item) => !ITEM_NAMES.has(item));
  if (strays.length) throw new Error(`Tradeable items missing from data/items.json (AB#824): ${strays.join(", ")}.`);
}

/**
 * Add one settled trade to `history` (an object keyed by item, each an array of daily buckets in day order):
 * open, high, low, close, volume and trades for the UTC day of `t`. Buckets older than PRICE_HISTORY_DAYS are dropped.
 * A trade with no positive price or quantity is ignored. Returns true when it was recorded.
 */
export function recordTrade(history, item, price, qty, t = Date.now()) {
  const unitPrice = Number(price);
  const quantity = Number(qty);
  if (!history || typeof history !== "object" || !item) return false;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isFinite(quantity) || quantity <= 0) return false;

  const day = dayKey(t);
  const buckets = Array.isArray(history[item]) ? history[item] : (history[item] = []);
  let bucket = buckets.find((b) => b.day === day);
  if (!bucket) {
    bucket = { day, open: unitPrice, high: unitPrice, low: unitPrice, close: unitPrice, volume: 0, trades: 0 };
    buckets.push(bucket);
    buckets.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  } else {
    bucket.high = Math.max(bucket.high, unitPrice);
    bucket.low = Math.min(bucket.low, unitPrice);
    bucket.close = unitPrice;
  }
  bucket.volume += quantity;
  bucket.trades += 1;

  const oldest = dayKey(t - (PRICE_HISTORY_DAYS - 1) * DAY_MS);
  history[item] = buckets.filter((b) => b.day >= oldest);
  return true;
}

/** A saved history, kept to known items and well-formed buckets; anything else in it is dropped. */
export function normalizePriceHistory(raw) {
  const clean = {};
  if (!raw || typeof raw !== "object") return clean;
  for (const [item, buckets] of Object.entries(raw)) {
    if (!PRICE_HISTORY_ITEMS.has(item) || !Array.isArray(buckets)) continue;
    const kept = buckets
      .filter((b) => b && /^\d{4}-\d{2}-\d{2}$/.test(b.day) && ["open", "high", "low", "close", "volume", "trades"].every((k) => Number.isFinite(b[k])))
      .map(({ day, open, high, low, close, volume, trades }) => ({ day, open, high, low, close, volume, trades }));
    if (kept.length) clean[item] = kept.sort((a, b) => (a.day < b.day ? -1 : 1));
  }
  return clean;
}

/** What GET /api/market/history/:item serves: the buckets for one item, copied, prices and volumes only. */
export function historyFor(history, item) {
  return (history?.[item] || []).map(({ day, open, high, low, close, volume, trades }) => ({ day, open, high, low, close, volume, trades }));
}
