// ISP-146 (AB#840): the settlement ledger. The one audited way credits move between two parties.
//
// Every v0.9 and v0.10 instrument that moves value between players (loans, bonds, coupons, dividends, share purchases,
// escrow, fees: docs/design/v0.9-debt.md and v0.9-equity.md) calls settleTransfer, and nothing else. Before this, each
// cross-corporation transfer was written by hand inside its route, and ISP once shipped an endpoint that set any balance
// (AB#423). One primitive, validated here and written down here, keeps the currency un-forgeable (T-020).
//
// What moves: whole credits, from one party to another, for one of REASONS. A party is
//   - a corporation: its account id; its balance moves through applyCredits (AB#712), so both statements book it;
//   - an escrow: `escrow:<id>`, a balance held in the global state until it is released (escrow-hold, escrow-release);
//   - a sink: `sink:fee`, a named total in the global state that credits go into and never come out of (fee).
// So corporations + escrows + sinks is conserved by every transfer, and a fee is counted, not lost.
//
// It fails closed. Anything wrong with a request (an amount that is not a positive whole number, an unknown reason,
// party or key, a payer paying itself, a payer without the funds) returns { ok: false, error } and nothing moves.
//
// Each transfer is written to the ledger (settlement-ledger.jsonl in the data directory, one JSON line per entry,
// appended) and the accounts snapshot is saved at once, not on the usual 300 ms debounce, so the window in which a
// transfer is in one file and not the other is as short as a synchronous write. The idempotency key makes a retry safe:
// the same key with the same terms returns the first entry and moves nothing; with different terms it is refused.
//
// It is not reachable from an HTTP route: no file in server/routes/ or server/index.js imports it; instrument modules
// do (tests/unit/settlement.test.js checks this).

import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./game/catalog.js";
import { getAccountById, mutateAccountState, mutateState, getState, saveAccountsNow } from "./gameState.js";
import { saveStateNow } from "./game/store.js";
import { applyCredits } from "./finances.js";

/** Why credits may move. Anything else is refused. */
export const REASONS = Object.freeze([
  "loan-disbursal", "loan-repayment", "bond-subscription", "coupon", "dividend", "share-purchase", "escrow-hold", "escrow-release", "fee"
]);

/** The named sinks: credits paid into one leave the money supply, counted. */
export const SINKS = Object.freeze(["fee"]);

/**
 * How a transfer is booked on each corporation's statement (finances.js CREDIT_CATEGORIES): the payer's expense is
 * `<reason>-paid`, the payee's income `<reason>-received`. Income and expense names never overlap.
 */
export const categoryPaid = (reason) => `${reason}-paid`;
export const categoryReceived = (reason) => `${reason}-received`;

/** Which kinds of party each reason moves between: a reason that names the wrong kind of party is refused. */
const SHAPE = {
  "escrow-hold": ["corp", "escrow"],
  "escrow-release": ["escrow", "corp"],
  fee: ["corp", "sink"]
};
const shapeOf = (reason) => SHAPE[reason] ?? ["corp", "corp"];

const ESCROW = /^escrow:[\w.-]{1,80}$/;
const SINK = /^sink:([\w-]{1,40})$/;
const KEY = /^[\w.:\-]{1,200}$/;

/** The ledger file. Read at call time, so a test's data directory is the one used. */
export const ledgerPath = () => path.join(dataDir, "settlement-ledger.jsonl");

let index = null; // idempotencyKey -> entry, loaded from the file on first use

/** (Re)read the ledger from disk: at first use, and in a test that restarts. Returns the number of entries. */
export function loadLedger() {
  index = new Map();
  let text = "";
  try { text = fs.readFileSync(ledgerPath(), "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { const entry = JSON.parse(line); if (entry?.key) index.set(entry.key, entry); } catch { /* a torn last line from a crash is skipped */ }
  }
  return index.size;
}

/** Every entry, oldest first (for audits and tests). */
export function ledgerEntries() {
  if (!index) loadLedger();
  return [...index.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** The settlement totals in the global state: escrow balances and sink totals. */
function totals(draft) {
  if (!draft.settlement || typeof draft.settlement !== "object") draft.settlement = {};
  if (!draft.settlement.escrow || typeof draft.settlement.escrow !== "object") draft.settlement.escrow = {};
  if (!draft.settlement.sinks || typeof draft.settlement.sinks !== "object") draft.settlement.sinks = {};
  return draft.settlement;
}

/** What `id` names: { kind: "corp" | "escrow" | "sink", id }, or null for nothing this ledger knows. */
function party(id) {
  if (typeof id !== "string" || !id) return null;
  if (ESCROW.test(id)) return { kind: "escrow", id };
  const sink = id.match(SINK);
  if (sink) return SINKS.includes(sink[1]) ? { kind: "sink", id, name: sink[1] } : null;
  return getAccountById(id)?.state?.corp ? { kind: "corp", id } : null;
}

/** A party's balance now: a corporation's credits, or an escrow's held amount. */
function balanceOf(p) {
  if (p.kind === "corp") return Math.round(Number(getAccountById(p.id)?.state?.corp?.finances?.credits) || 0);
  if (p.kind === "escrow") return Math.round(Number(getState()?.settlement?.escrow?.[p.id]) || 0);
  return 0;
}

const refuse = (error) => ({ ok: false, error });

/**
 * Move `credits` from one party to another for `reason`, once per `idempotencyKey`.
 * Returns { ok: true, entry, replayed? } or { ok: false, error }; it never throws for a bad request.
 */
export function settleTransfer({ fromAccountId, toAccountId, credits, reason, idempotencyKey } = {}, now = Date.now()) {
  if (typeof credits !== "number" || !Number.isInteger(credits) || credits <= 0 || credits > Number.MAX_SAFE_INTEGER) {
    return refuse("credits must be a positive whole number");
  }
  if (!REASONS.includes(reason)) return refuse(`unknown reason: ${String(reason)}`);
  if (typeof idempotencyKey !== "string" || !KEY.test(idempotencyKey)) return refuse("idempotencyKey must be 1 to 200 letters, digits, dots, colons, dashes or underscores");
  if (!index) loadLedger();

  const seen = index.get(idempotencyKey);
  if (seen) {
    const same = seen.from === fromAccountId && seen.to === toAccountId && seen.credits === credits && seen.reason === reason;
    return same ? { ok: true, entry: seen, replayed: true } : refuse("idempotencyKey was already used for a different transfer");
  }

  if (fromAccountId === toAccountId) return refuse("a party cannot pay itself");
  const from = party(fromAccountId), to = party(toAccountId);
  if (!from) return refuse("unknown payer");
  if (!to) return refuse("unknown payee");
  const [fromKind, toKind] = shapeOf(reason);
  if (from.kind !== fromKind || to.kind !== toKind) return refuse(`${reason} moves credits from a ${fromKind} to a ${toKind}`);
  if (balanceOf(from) < credits) return refuse("the payer does not have the credits");

  // The debit, checked again inside the mutation: settling a corporation's mining first can change its balance.
  let debited = false;
  if (from.kind === "corp") {
    mutateAccountState(from.id, (state) => {
      if (Math.round(Number(state.corp.finances?.credits) || 0) < credits) return;
      applyCredits(state.corp, -credits, categoryPaid(reason), now);
      debited = true;
    }, { sanitize: false });
  } else {
    mutateState((draft) => {
      const t = totals(draft);
      if ((Number(t.escrow[from.id]) || 0) < credits) return;
      t.escrow[from.id] -= credits;
      if (t.escrow[from.id] === 0) delete t.escrow[from.id];
      debited = true;
    });
  }
  if (!debited) return refuse("the payer does not have the credits");

  if (to.kind === "corp") {
    mutateAccountState(to.id, (state) => { applyCredits(state.corp, credits, categoryReceived(reason), now); }, { sanitize: false });
  } else {
    mutateState((draft) => {
      const t = totals(draft);
      if (to.kind === "escrow") t.escrow[to.id] = (Number(t.escrow[to.id]) || 0) + credits;
      else t.sinks[to.name] = (Number(t.sinks[to.name]) || 0) + credits;
    });
  }

  const entry = { id: `st-${now.toString(36)}-${index.size.toString(36)}`, at: now, from: fromAccountId, to: toAccountId, credits, reason, key: idempotencyKey };
  fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
  fs.appendFileSync(ledgerPath(), JSON.stringify(entry) + "\n");
  index.set(idempotencyKey, entry);
  saveAccountsNow();
  if (from.kind !== "corp" || to.kind !== "corp") saveStateNow();
  return { ok: true, entry };
}

/** Escrow balances and sink totals now (for audits, tests and the conservation check). */
export function settlementTotals() {
  const s = getState()?.settlement ?? {};
  return { escrow: { ...(s.escrow ?? {}) }, sinks: { ...(s.sinks ?? {}) } };
}
