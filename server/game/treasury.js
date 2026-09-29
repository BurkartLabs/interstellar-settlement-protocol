// server/game/treasury.js: a conglomerate's credit treasury (ISP-204, AB#898; docs/design/CONGLOMERATES.md, "Pooling:
// the treasury and the hangar"). Any member deposits; a founder or director withdraws within a daily cap; a large
// withdrawal is announced and waits, and others may block it. The ledger and upkeep are server/game/conglomerates.js
// (moveTreasury, settleTreasury), which every read here goes through.
//
// A treasury is the largest theft target in the game (EVE's EBank, 2009), so the limits are the feature:
// - The cap is per role and per UTC day, from 00:00 UTC, measured against the balance at the start of that day, so
//   splitting a withdrawal gains nothing: the founder founderWithdrawPct (20%), a director directorWithdrawPct (5%)
//   and never more than directorWithdrawMax (50,000), a member nothing.
// - Anything above withdrawalNoticePct (10%) of the balance is announced to every member and completes after
//   withdrawalDelayHours (24). Two directors may block it, or the founder when a director made it.
// - Every check runs before anything changes: a refusal, or an error in a check, writes no ledger row (fails closed).
// Each step is synchronous, so two requests at once are decided one after the other, the second seeing the first.

import { CONGLOMERATE_CATALOG, can } from "../conglomerates.js";
import { applyCredits } from "../finances.js";
import { createId } from "./catalog.js";
import { pushSystemNotification } from "./progression.js";
import { saveAccountsNow } from "./store.js";
import { dailyUpkeep, dayStartOf, moveTreasury, noteTreasury, payArrears } from "./conglomerates.js";
import { NOT_FOUND, accountByCorp, context, corpName, no, roomEvent } from "./membership.js";
import { utcTime } from "../../public/scripts/timeFormat.js"; // ISP-249 (AB#945): one format for every timestamp

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** The largest single movement: far above any balance the game makes, and exact in a double. */
export const MAX_TREASURY_AMOUNT = 1_000_000_000_000;
const plain = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");

/** A whole number of credits from 1 to MAX_TREASURY_AMOUNT, or null. Strings, fractions, NaN and negatives are null. */
export function treasuryAmount(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_TREASURY_AMOUNT ? value : null;
}

/** The balance at 00:00 UTC today: the last ledger row before it, or, for a treasury opened today, its first row. */
function openingBalance(c, now) {
  const start = dayStartOf(now);
  for (let i = c.ledger.length - 1; i >= 0; i -= 1) if (c.ledger[i].at < start) return c.ledger[i].balanceAfter;
  return c.ledger.find((r) => r.at >= start)?.balanceAfter ?? Math.floor(Number(c.treasury.credits) || 0);
}

/** What `corpId`, holding `role`, may still withdraw today: { cap, used, remaining, opening, resetsAt }. */
export function withdrawalAllowance(c, role, corpId, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const opening = openingBalance(c, now);
  const pct = role === "founder" ? catalog.founderWithdrawPct : role === "director" ? catalog.directorWithdrawPct : 0;
  let cap = Math.floor((opening * pct) / 100);
  if (role === "director") cap = Math.min(cap, catalog.directorWithdrawMax);
  const start = dayStartOf(now);
  const used = c.withdrawals.filter((w) => w.corp === corpId && w.at >= start && (w.state === "paid" || w.state === "pending")).reduce((s, w) => s + w.amount, 0);
  return { cap, used, remaining: Math.max(0, cap - used), opening, resetsAt: start + DAY_MS };
}

/** Deposit `amount` credits from the caller's corporation. Any member. The custody fee (poolingFeePct) is a sink. */
export function depositToTreasury(accountId, conglomerateId, amount, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  if (!can(role, "contribute")) return no(403, "not-permitted", "Your role cannot contribute to the treasury.");
  if (treasuryAmount(amount) === null) return no(400, "invalid-amount", "Enter a whole number of credits, at least 1.");
  const held = Number(corp.finances?.credits);
  if (!Number.isFinite(held)) return no(503, "treasury-unavailable", "The Bureau cannot read your corporation's credits just now; nothing was moved. Try again later."); // AB#4821 (ISP-6)
  if (held < amount) return no(409, "insufficient-credits", `Your corporation holds ${plain(held)} credits; it cannot deposit ${plain(amount)}. Deposit ${plain(held)} or less.`); // AB#4821 (ISP-6)
  const fee = Math.round((amount * catalog.poolingFeePct) / 100);
  applyCredits(corp, -amount, "conglomerate-contribution", now);
  moveTreasury(c, { at: now, kind: "deposit", corp: corp.publicId, amount, by: corp.publicId });
  if (fee > 0) moveTreasury(c, { at: now, kind: "custody-fee", corp: corp.publicId, amount: -fee, by: "bureau", note: `${catalog.poolingFeePct}% of ${plain(amount)}` });
  const cleared = payArrears(c, now);
  saveAccountsNow();
  roomEvent(c, "conglomerate:treasury", { kind: "deposit", corp: corp.publicId, corpName: corp.corporationName, amount, fee, balance: c.treasury.credits, arrearsCleared: cleared });
  return { deposited: amount, fee, treasury: { credits: c.treasury.credits }, account: { credits: corp.finances.credits } };
}

/** Withdraw `amount` credits to the caller's corporation, within its role's daily cap; announced and delayed when large. */
export function withdrawFromTreasury(accountId, conglomerateId, amount, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  let allowance, announce;
  try {
    if (!can(role, "withdraw-credits")) return no(403, "not-permitted", "Members cannot withdraw credits; the founder and directors can, within a daily cap.");
    if (treasuryAmount(amount) === null) return no(400, "invalid-amount", "Enter a whole number of credits, at least 1.");
    allowance = withdrawalAllowance(c, role, corp.publicId, now, catalog);
    if (![allowance.cap, allowance.used, allowance.remaining].every(Number.isSafeInteger)) throw new Error("the cap could not be read");
    if (amount > allowance.remaining) {
      return no(409, "over-daily-cap", `Your role may withdraw ${plain(allowance.cap)} credits today (${role === "founder" ? catalog.founderWithdrawPct : catalog.directorWithdrawPct}% of the ${plain(allowance.opening)} the treasury held at 00:00 UTC${role === "director" ? `, at most ${plain(catalog.directorWithdrawMax)}` : ""}); ${plain(allowance.remaining)} remain. The cap resets at 00:00 UTC.`);
    }
    if (amount > c.treasury.credits) return no(409, "insufficient-treasury", `The treasury holds ${plain(c.treasury.credits)} credits. Withdraw ${plain(c.treasury.credits)} or less.`); // AB#4821 (ISP-6)
    announce = amount > (c.treasury.credits * catalog.withdrawalNoticePct) / 100;
  } catch (error) {
    // Fails closed: a check that cannot run refuses the withdrawal, and nothing is written.
    console.error("[treasury] a withdrawal check could not run:", error?.message || error);
    return no(503, "treasury-unavailable", "The Bureau cannot check this withdrawal just now; nothing was moved. Try again later."); // AB#4821 (ISP-6)
  }
  const w = { id: createId("cwd"), corp: corp.publicId, amount, at: now, state: announce ? "pending" : "paid", completesAt: announce ? now + catalog.withdrawalDelayHours * HOUR_MS : now, blockedBy: [] };
  if (announce) {
    c.withdrawals.push(w);
    noteTreasury(c, { at: now, kind: "withdrawal-announced", corp: corp.publicId, by: corp.publicId, note: `${amount} credits, completes ${utcTime(w.completesAt, { withDate: true })} unless blocked` });
    saveAccountsNow();
    for (const m of c.members) {
      const account = accountByCorp(m.corp);
      if (account && m.corp !== corp.publicId) {
        pushSystemNotification(account, { type: "system", protocol: { meaning: "pending", screen: "conglomerate" }, title: `A large withdrawal from ${c.name}`, // ISP-254 (AB#4821): Filed, awaiting review
        body: `${corp.corporationName} asked to withdraw ${plain(amount)} credits, more than ${catalog.withdrawalNoticePct}% of the treasury. It completes in ${catalog.withdrawalDelayHours} hours unless two directors block it${corpRoleOf(c, corp.publicId) === "director" ? ", or the founder" : ""}.` });
      }
    }
    roomEvent(c, "conglomerate:treasury", { kind: "withdrawal-announced", corp: corp.publicId, corpName: corp.corporationName, amount, withdrawal: withdrawalView(w) });
    return { withdrawal: withdrawalView(w), treasury: { credits: c.treasury.credits } };
  }
  c.withdrawals.push(w);
  moveTreasury(c, { at: now, kind: "withdrawal", corp: corp.publicId, amount: -amount, by: corp.publicId });
  applyCredits(corp, amount, "conglomerate-withdrawal", now);
  saveAccountsNow();
  roomEvent(c, "conglomerate:treasury", { kind: "withdrawal", corp: corp.publicId, corpName: corp.corporationName, amount, balance: c.treasury.credits });
  return { withdrawal: withdrawalView(w), treasury: { credits: c.treasury.credits }, account: { credits: corp.finances.credits } };
}

const corpRoleOf = (c, publicId) => c.members.find((m) => m.corp === publicId)?.role || null;
const withdrawalView = (w) => ({ id: w.id, corp: w.corp, corpName: corpName(w.corp), amount: w.amount, at: w.at, completesAt: w.completesAt, state: w.state, blockedBy: [...w.blockedBy] });

/** Block an announced withdrawal: the second director's block stops it; the founder's stops a director's at once. */
export function blockWithdrawal(accountId, conglomerateId, withdrawalId, now = Date.now()) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  if (!can(role, "block-withdrawal")) return no(403, "not-permitted", "Only the founder or a director can block a withdrawal.");
  const w = c.withdrawals.find((x) => x.id === withdrawalId);
  if (!w) return no(404, "no-withdrawal", "No such withdrawal.");
  if (w.state !== "pending") return no(409, "withdrawal-closed", `That withdrawal is ${w.state}; it can no longer be blocked.`);
  if (w.corp === corp.publicId) return no(409, "own-withdrawal", "You cannot block your own withdrawal.");
  if (w.blockedBy.includes(corp.publicId)) return no(409, "already-blocked", "You have already blocked it; a second director's block stops it.");
  w.blockedBy.push(corp.publicId);
  const stopped = (role === "founder" && corpRoleOf(c, w.corp) === "director") || w.blockedBy.filter((p) => corpRoleOf(c, p) === "director").length >= 2;
  if (stopped) {
    w.state = "blocked";
    noteTreasury(c, { at: now, kind: "withdrawal-blocked", corp: w.corp, by: w.blockedBy.join(","), note: `${w.amount} credits` });
  }
  saveAccountsNow();
  roomEvent(c, "conglomerate:treasury", { kind: stopped ? "withdrawal-blocked" : "withdrawal-block-added", corp: w.corp, withdrawal: withdrawalView(w) }, { accounts: [accountByCorp(w.corp)?.id].filter(Boolean) });
  return { withdrawal: withdrawalView(w) };
}

/**
 * The treasury as the caller may see it: the balance, upkeep, arrears and announced withdrawals for every member; the
 * whole ledger for the founder and directors (the roles that may withdraw), and a member's own rows for a member.
 */
/** ISP-206 (AB#901): a page of ledger rows, newest first: `limit` (1 to 100, default 25) rows from `offset`. */
export function ledgerPage(rows, { offset = 0, limit = 25 } = {}, name = () => "") {
  const size = Math.min(100, Math.max(1, Math.floor(Number(limit) || 25)));
  const from = Math.max(0, Math.floor(Number(offset) || 0));
  const newest = rows.slice().reverse();
  return { rows: newest.slice(from, from + size).map((r) => ({ ...r, corpName: r.corp ? name(r.corp) : "" })), total: rows.length, offset: from, limit: size };
}

export function treasuryView(accountId, conglomerateId, now = Date.now(), catalog = CONGLOMERATE_CATALOG, page = {}) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role || !can(role, "view")) return NOT_FOUND.conglomerate();
  const full = can(role, "withdraw-credits");
  const rows = full ? c.ledger : c.ledger.filter((r) => r.corp === corp.publicId);
  return {
    balance: c.treasury.credits,
    upkeepPerDay: dailyUpkeep(c.members.length, catalog),
    nextUpkeepAt: c.upkeepPaidThrough,
    arrears: c.arrearsSince ? { owed: c.arrearsOwed, since: c.arrearsSince } : null,
    custodyFeePct: catalog.poolingFeePct,
    noticePct: catalog.withdrawalNoticePct, // ISP-206 (AB#901): the page says where announcement starts
    allowance: full ? withdrawalAllowance(c, role, corp.publicId, now, catalog) : null,
    pending: c.withdrawals.filter((w) => w.state === "pending").map(withdrawalView),
    ledger: { scope: full ? "all" : "own", ...ledgerPage(rows, page, corpName) }
  };
}
