// public/scripts/logistics.js
// Transfers between stations (AB#717, ISP-32): the rules the server enforces and the client shows, in one module so
// they cannot disagree. The server imports it as it does ceoEffects.js. Pure: no DOM, no state of its own.

/** Credits per unit moved. The fee is transferFee(), and nothing else computes it (v0.5-s07 changes it here). */
export const LOGISTICS_FEE_PER_UNIT = 2;
/** Resource lines one request may carry. */
export const MAX_TRANSFER_LINES = 10;
/** Completed transfers kept in corp.logisticsHistory, newest first. */
export const LOGISTICS_HISTORY_LIMIT = 100;
/** Longer than any resource name; anything longer is not an item. */
const ITEM_MAX_LENGTH = 40;

/** The fee for moving these lines, in credits. */
export function transferFee(lines) {
  return (lines || []).reduce((sum, l) => sum + LOGISTICS_FEE_PER_UNIT * Number(l.quantity || 0), 0);
}

/** A quantity from a request: a whole number of at least 1; null for anything else ("abc", NaN, -5, 0, 2.5, missing). AB#731 refuses fractions on every gameplay route. */
export function transferQuantity(value) {
  if (value === undefined || value === null || value === "" || typeof value === "object" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Read a transfer request body: { fromStationId, lines: [{ item, quantity }] }, or the older single-line
 * { fromStationId, item, quantity }. Returns { ok: true, fromStationId, lines } with duplicate items merged, or
 * { ok: false, error } naming the fix. Never repeats the request's text back.
 */
export function parseTransferRequest(body) {
  const fromStationId = typeof body?.fromStationId === "string" ? body.fromStationId.trim() : "";
  if (!fromStationId) return { ok: false, error: "Choose the station to move goods from." };
  const raw = Array.isArray(body?.lines) ? body.lines : body && "item" in body ? [{ item: body.item, quantity: body.quantity }] : null;
  if (!raw || raw.length === 0) return { ok: false, error: "Add at least one item to move." };
  if (raw.length > MAX_TRANSFER_LINES) {
    return { ok: false, error: `A transfer carries at most ${MAX_TRANSFER_LINES} lines; you sent ${raw.length}. Split it into two transfers.` };
  }
  const merged = new Map();
  for (let i = 0; i < raw.length; i += 1) {
    const item = typeof raw[i]?.item === "string" ? raw[i].item.trim() : "";
    if (!item || item.length > ITEM_MAX_LENGTH) return { ok: false, error: `Line ${i + 1} has no item. Pick one from the station's list.` };
    const quantity = transferQuantity(raw[i]?.quantity);
    if (quantity === null) return { ok: false, error: `Line ${i + 1}: enter a whole number of at least 1 to move.` };
    merged.set(item, (merged.get(item) || 0) + quantity);
  }
  return { ok: true, fromStationId, lines: [...merged].map(([item, quantity]) => ({ item, quantity })) };
}

/**
 * Check a parsed request against the corporation before anything moves: all of it can happen, or none of it does.
 * `stations` maps id to { name }; `inventory` is corp.inventory. Returns { ok: true, fee } or { ok: false, error }.
 */
export function planTransfer({ fromStationId, toStationId, lines, inventory, credits, stations }) {
  // Own keys only: a plain object answers "__proto__" and "constructor" too.
  const station = (id) => (typeof id === "string" && Object.hasOwn(stations || {}, id) ? stations[id] : null);
  const from = station(fromStationId);
  if (!from) return { ok: false, error: "That source station does not exist. Choose one from the Logistics tab." };
  if (!toStationId) return { ok: false, error: "You are in transit. Dock at a station, then move goods to it." };
  const to = station(toStationId);
  if (fromStationId === toStationId) {
    return { ok: false, error: `You are docked at ${to?.name || "that station"}, the source. Move goods from another station, or travel first.` };
  }
  const held = inventory && Object.hasOwn(inventory, fromStationId) ? inventory[fromStationId] : {};
  for (const { item, quantity } of lines) {
    const have = Object.hasOwn(held || {}, item) ? Number(held[item] || 0) : 0;
    if (have <= 0) return { ok: false, error: `${from.name} holds none of that item. Pick one from its list.` };
    if (have < quantity) {
      return { ok: false, error: `${from.name} holds ${have.toLocaleString()} ${item}; you asked to move ${quantity.toLocaleString()}. Move ${have.toLocaleString()} or fewer.` };
    }
  }
  const fee = transferFee(lines);
  const units = lines.reduce((s, l) => s + l.quantity, 0);
  if (Number(credits || 0) < fee) {
    return { ok: false, error: `The fee is ${fee.toLocaleString()} credits (${LOGISTICS_FEE_PER_UNIT} per unit for ${units.toLocaleString()} units); you have ${Math.floor(Number(credits || 0)).toLocaleString()}. Move fewer units or sell goods first.` };
  }
  return { ok: true, fee };
}

/** Add a completed transfer to the front of the history, keeping the last LOGISTICS_HISTORY_LIMIT. Returns the history. */
export function recordTransfer(history, { time, from, to, lines, fee }) {
  const next = [{ time, from, to, lines: lines.map(({ item, quantity }) => ({ item, quantity })), fee }, ...(Array.isArray(history) ? history : [])];
  return next.slice(0, LOGISTICS_HISTORY_LIMIT);
}

/** "120 Silicates, 40 Nickel": a transfer's lines in words. */
export function describeLines(lines) {
  return (lines || []).map((l) => `${Number(l.quantity || 0).toLocaleString()} ${l.item}`).join(", ");
}
