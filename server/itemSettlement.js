// ISP-179 (AB#873): the one audited path goods take between parties, beside settleTransfer's for credits.
//
// docs/design/v0.10-raids-mercenaries.md, section 6: loot moves defender -> escrow at a raid's resolution and escrow ->
// attacker when the fleet is home, each through settleItems. A movement names its parties (a corporation's account at
// a station, or an escrow `escrow:<id>` in world state), the goods by item and whole quantity, a reason and an
// idempotency key. It moves all of the goods or none: a payer that does not hold every quantity is refused and nothing
// moves. A key already used for the same movement is a replay (nothing moves again); for a different one, a refusal.
// Every movement is a line in item-ledger.jsonl in the data directory.

import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./game/catalog.js";
import { getAccountById, getState, mutateAccountState, mutateState } from "./gameState.js";
import { saveAccountsNow, saveStateNow } from "./game/store.js";

export const ITEM_REASONS = Object.freeze(["raid-loot", "raid-loot-delivery"]);
const ESCROW = /^escrow:[\w.-]{1,80}$/;
const KEY = /^[\w.:-]{1,200}$/;

export const itemLedgerPath = () => path.join(dataDir, "item-ledger.jsonl");
let index = null;
function load() {
  index = new Map();
  let text = "";
  try { text = fs.readFileSync(itemLedgerPath(), "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  for (const line of text.split("\n")) if (line.trim()) { const e = JSON.parse(line); index.set(e.key, e); }
}
/** Every recorded movement, oldest first (for audits and tests). */
export function itemLedgerEntries() { if (!index) load(); return [...index.values()]; }

/** What an escrow holds now, by item. */
export const itemEscrowOf = (escrowId) => ({ ...(getState()?.settlement?.itemEscrow?.[escrowId] || {}) });

const whole = (n) => Number.isInteger(n) && n > 0;
const refuse = (error) => ({ ok: false, error });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Move `items` ({ item: quantity }) from one party to another for `reason`, once per `idempotencyKey`.
 * A corporation party is { accountId, stationId }; an escrow party is the string "escrow:<id>".
 * Returns { ok: true, entry, replayed? } or { ok: false, error }; never throws for a bad request.
 */
export function settleItems({ from, to, items, reason, idempotencyKey } = {}, now = Date.now()) {
  if (!ITEM_REASONS.includes(reason)) return refuse(`unknown reason: ${String(reason)}`);
  if (typeof idempotencyKey !== "string" || !KEY.test(idempotencyKey)) return refuse("a bad idempotency key");
  const goods = Object.fromEntries(Object.entries(items || {}).filter(([, q]) => q !== 0));
  if (!Object.keys(goods).length || !Object.values(goods).every(whole)) return refuse("items must be whole, positive quantities");
  const isEscrow = (p) => typeof p === "string" && ESCROW.test(p);
  const isCorp = (p) => p && typeof p === "object" && typeof p.accountId === "string" && typeof p.stationId === "string" && getAccountById(p.accountId);
  if (!(isEscrow(from) || isCorp(from)) || !(isEscrow(to) || isCorp(to))) return refuse("unknown party");
  if (!index) load();
  const seen = index.get(idempotencyKey);
  if (seen) return same(seen.items, goods) && same(seen.from, from) && same(seen.to, to) ? { ok: true, entry: seen, replayed: true } : refuse("idempotency key already used for a different movement");

  // take from the payer: all of it, or refuse with nothing moved
  let taken = false;
  if (isCorp(from)) {
    mutateAccountState(from.accountId, (state) => {
      const stock = state.corp.inventory?.[from.stationId] || {};
      if (!Object.entries(goods).every(([item, q]) => (Number(stock[item]) || 0) >= q)) return;
      for (const [item, q] of Object.entries(goods)) { stock[item] -= q; if (stock[item] === 0) delete stock[item]; }
      taken = true;
    }, { sanitize: false, settleMining: false });
  } else {
    mutateState((draft) => {
      const held = draft.settlement?.itemEscrow?.[from] || {};
      if (!Object.entries(goods).every(([item, q]) => (Number(held[item]) || 0) >= q)) return;
      for (const [item, q] of Object.entries(goods)) { held[item] -= q; if (held[item] === 0) delete held[item]; }
      if (!Object.keys(held).length) delete draft.settlement.itemEscrow[from];
      taken = true;
    });
  }
  if (!taken) return refuse("the payer does not hold those goods");

  if (isCorp(to)) {
    mutateAccountState(to.accountId, (state) => {
      if (!state.corp.inventory || typeof state.corp.inventory !== "object") state.corp.inventory = {};
      const stock = state.corp.inventory[to.stationId] || (state.corp.inventory[to.stationId] = {});
      for (const [item, q] of Object.entries(goods)) stock[item] = (Number(stock[item]) || 0) + q;
    }, { sanitize: false, settleMining: false });
  } else {
    mutateState((draft) => {
      if (!draft.settlement || typeof draft.settlement !== "object") draft.settlement = {};
      if (!draft.settlement.itemEscrow) draft.settlement.itemEscrow = {};
      const held = draft.settlement.itemEscrow[to] || (draft.settlement.itemEscrow[to] = {});
      for (const [item, q] of Object.entries(goods)) held[item] = (Number(held[item]) || 0) + q;
    });
  }
  const entry = { at: now, from, to, items: goods, reason, key: idempotencyKey };
  fs.mkdirSync(path.dirname(itemLedgerPath()), { recursive: true });
  fs.appendFileSync(itemLedgerPath(), JSON.stringify(entry) + "\n");
  index.set(idempotencyKey, entry);
  saveAccountsNow();
  saveStateNow();
  return { ok: true, entry };
}
