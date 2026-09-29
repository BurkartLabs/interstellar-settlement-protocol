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
//   - a sink: `sink:fee`, a named total in the global state that credits go into and never come out of (fee);
//   - a tap: `tap:dsdb`, an NPC lender's account (ISP-149, AB#843): paying out of it creates credits, paying into it
//     destroys them, and its total counts what it has created net (docs/design/v0.9-debt.md, section 9).
// So corporations + escrows + sinks - taps is conserved by every transfer, a fee is counted, not lost, and what an NPC
// lender puts into the money supply is counted too.
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
  "loan-disbursal", "loan-repayment", "bond-subscription", "coupon", "dividend", "share-purchase", "escrow-hold", "escrow-release", "fee",
  "loan-interest", // ISP-150 (AB#844): a loan's interest, apart from its principal (docs/design/v0.9-debt.md, sections 2 and 9)
  "bond-redemption", // ISP-155 (AB#849): a bond's face repaid to its holder at maturity
  "bond-sale", // Bug #2574: a bond holding sold, in default recovery to the NPC underwriter at 90% of face
  "arbitration-award", // ISP-242 (AB#938): an upheld or cured case's award, from the respondent or the contract's escrow
  "arbitration-fee", // ISP-242 (AB#938): a dismissed case's filing fee, from its escrow to the fee sink
  "bounty", // ISP-284 (AB#991): the ISA's bounty for a won Rat hunt, from its tap
  "repair" // ISP-287 (AB#994): repairing a building a raid damaged, paid into the fee sink
]);

/** The named sinks: credits paid into one leave the money supply, counted. */
export const SINKS = Object.freeze(["fee", "loan-interest"]);
/** Which sink each reason may pay into: a fee is never booked as interest, nor interest as a fee (AB#844). */
const SINK_FOR = { fee: "fee", "loan-interest": "loan-interest", "arbitration-fee": "fee", repair: "fee" };

/** The named taps: an NPC lender's account, which creates what it pays out (AB#843: the Development Bank). */
export const TAPS = Object.freeze(["dsdb", "igsx", "isa"]); // igsx: the Stock Exchange's market maker (ISP-158, AB#852); isa: the ISA's Rat bounties (ISP-284, AB#991)

/**
 * How a transfer is booked on each corporation's statement (finances.js CREDIT_CATEGORIES): the payer's expense is
 * `<reason>-paid`, the payee's income `<reason>-received`. Income and expense names never overlap.
 */
export const categoryPaid = (reason) => `${reason}-paid`;
export const categoryReceived = (reason) => `${reason}-received`;

/** Which kinds of party each reason moves between: a reason that names the wrong kind of party is refused. */
const SHAPES = {
  "escrow-hold": [["corp", "escrow"]],
  "escrow-release": [["escrow", "corp"]],
  fee: [["corp", "sink"]],
  // AB#843: a loan is disbursed by a player lender or by an NPC lender's tap, and repaid to the one that lent it
  "loan-disbursal": [["corp", "corp"], ["tap", "corp"]],
  "loan-repayment": [["corp", "corp"], ["corp", "tap"]],
  // AB#844: an NPC loan's interest is destroyed, counted in its sink; a player lender's is paid to the lender
  "loan-interest": [["corp", "sink"], ["corp", "corp"]],
  // AB#848: a player subscribes to a bond at face, or the NPC underwriter does from its tap when the window closes
  "bond-subscription": [["corp", "corp"], ["tap", "corp"]],
  // AB#849: coupons and redemption go to each holder; what the underwriter holds is paid to its tap, and destroyed
  coupon: [["corp", "corp"], ["corp", "tap"]],
  "bond-redemption": [["corp", "corp"], ["corp", "tap"]],
  // Bug #2574: the NPC underwriter buys a debtor's bonds from its tap; a player-to-player sale is corp to corp
  "bond-sale": [["tap", "corp"], ["corp", "corp"]],
  // AB#852: a corporation buys another's new shares, or the IGSX market maker does from its tap at an offering's close
  "share-purchase": [["corp", "corp"], ["tap", "corp"]],
  // AB#853: a dividend goes to each holder; the market maker's part goes to its tap, and is destroyed
  dividend: [["corp", "corp"], ["corp", "tap"]],
  // ISP-242 (AB#938): a cure is paid by the respondent, a readiness refund from the contract's escrow; a forfeited fee is destroyed
  "arbitration-award": [["corp", "corp"], ["escrow", "corp"]],
  "arbitration-fee": [["escrow", "sink"]],
  // ISP-284 (AB#991): a hunt's bounty is paid by the ISA from its tap, creating the credits (docs/design/rats.md section 5)
  bounty: [["tap", "corp"]],
  // ISP-287 (AB#994): a repair's price leaves the money supply (docs/design/v0.10-raids-mercenaries.md, section 3)
  repair: [["corp", "sink"]]
};
const shapesOf = (reason) => SHAPES[reason] ?? [["corp", "corp"]];

const ESCROW = /^escrow:[\w.-]{1,80}$/;
const SINK = /^sink:([\w-]{1,40})$/;
const TAP = /^tap:([\w-]{1,40})$/;
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
  if (!draft.settlement.taps || typeof draft.settlement.taps !== "object") draft.settlement.taps = {};
  return draft.settlement;
}

/** What `id` names: { kind: "corp" | "escrow" | "sink", id }, or null for nothing this ledger knows. */
function party(id) {
  if (typeof id !== "string" || !id) return null;
  if (ESCROW.test(id)) return { kind: "escrow", id };
  const sink = id.match(SINK);
  if (sink) return SINKS.includes(sink[1]) ? { kind: "sink", id, name: sink[1] } : null;
  const tap = id.match(TAP);
  if (tap) return TAPS.includes(tap[1]) ? { kind: "tap", id, name: tap[1] } : null;
  return getAccountById(id)?.state?.corp ? { kind: "corp", id } : null;
}

/** A party's balance now: a corporation's credits, or an escrow's held amount. */
function balanceOf(p) {
  if (p.kind === "corp") return Math.round(Number(getAccountById(p.id)?.state?.corp?.finances?.credits) || 0);
  if (p.kind === "escrow") return Math.round(Number(getState()?.settlement?.escrow?.[p.id]) || 0);
  if (p.kind === "tap") return Number.MAX_SAFE_INTEGER; // a tap creates what it pays; its caps are the instrument's
  return 0;
}

const refuse = (error) => ({ ok: false, error });

/**
 * Move `credits` from one party to another for `reason`, once per `idempotencyKey`.
 * Returns { ok: true, entry, replayed? } or { ok: false, error }; it never throws for a bad request.
 * AB#852: `withPayer(state)` and `withPayee(state)`, for a corporation party, change that corporation's record in the
 * same mutation as its credits (a share purchase: the shares move with the money). They run only when the credits
 * move, never on a replay or a refusal, and must not throw.
 */
export function settleTransfer({ fromAccountId, toAccountId, credits, reason, idempotencyKey, withPayer = null, withPayee = null } = {}, now = Date.now()) {
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
  const shapes = shapesOf(reason);
  if (!shapes.some(([f, t]) => from.kind === f && to.kind === t)) {
    return refuse(`${reason} moves credits ${shapes.map(([f, t]) => `from a ${f} to a ${t}`).join(" or ")}`);
  }
  if (to.kind === "sink" && SINK_FOR[reason] !== to.name) return refuse(`${reason} is not paid into sink:${to.name}`);
  if (balanceOf(from) < credits) return refuse("the payer does not have the credits");

  // The debit, checked again inside the mutation: settling a corporation's mining first can change its balance.
  let debited = false;
  if (from.kind === "corp") {
    mutateAccountState(from.id, (state) => {
      if (Math.round(Number(state.corp.finances?.credits) || 0) < credits) return;
      applyCredits(state.corp, -credits, categoryPaid(reason), now);
      if (withPayer) withPayer(state);
      debited = true;
    }, { sanitize: false });
  } else if (from.kind === "tap") {
    mutateState((draft) => { const t = totals(draft); t.taps[from.name] = (Number(t.taps[from.name]) || 0) + credits; debited = true; });
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
    mutateAccountState(to.id, (state) => { applyCredits(state.corp, credits, categoryReceived(reason), now); if (withPayee) withPayee(state); }, { sanitize: false });
  } else {
    mutateState((draft) => {
      const t = totals(draft);
      if (to.kind === "escrow") t.escrow[to.id] = (Number(t.escrow[to.id]) || 0) + credits;
      else if (to.kind === "tap") t.taps[to.name] = (Number(t.taps[to.name]) || 0) - credits; // repaid: destroyed
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

/** Escrow balances, sink totals and what each tap has created net, now (for audits, tests and the conservation check). */
export function settlementTotals() {
  const s = getState()?.settlement ?? {};
  return { escrow: { ...(s.escrow ?? {}) }, sinks: { ...(s.sinks ?? {}) }, taps: { ...(s.taps ?? {}) } };
}
