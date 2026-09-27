// ISP-158 (AB#852): listing on the Intergalactic Stock Exchange, and primary share offerings.
//
// docs/design/v0.9-equity.md, sections 1 to 3 and 5. The Board's rule (D-0.9-3, AB#704): a share is worth company value
// divided by shares outstanding. Company value is the net worth on the issuer's latest closed daily statement, so
// nothing a player sends moves it, and a price is never read from a request.
//
//   Listing   level 15, grade BBB or better, 30 closed statements with positive net income over them, and a fee of 1% of
//             company value to the fee sink. Once; it sells nothing by itself.
//   Offering  new shares from `unissued`, priced at open: floor(companyValue / sharesOutstanding), at least 1. Size: 100
//             or more; at most 20% of outstanding at open; at most what keeps the founder at 51% of outstanding after a
//             full sale; at most what is unissued. One open at a time, the next 30 days after the last opened; open for
//             7 days.
//   Buying    any corporation at level 8 or above but the issuer, in whole shares up to what is left, and never above
//             20% of shares outstanding after the purchase (option A of D-0.9-3, assumed). The credits move buyer to
//             issuer through settleTransfer (`share-purchase`) and the shares from `unissued` to the buyer's row in the
//             same mutation as the issuer's credit (settleTransfer's withPayee).
//   Close     the IGSX market maker takes a fill of what is left, set by the issuer's expected yield, from its tap and
//             within its own 20%; what nobody bought stays unissued; the 2% fee on the proceeds goes to the fee sink.
//
// Shares are economic only: nothing reads a holder's stake to grant an action (D-0.9-3, option A). No share has a
// real-money path (the Board, AB#703). Time is passed in (P-TEST-TIME).

import { computeCreditRating } from "./creditRating.js";
import { getAccountById, getStatements, mutateAccountState } from "./gameState.js";
import { accountsStore, saveAccountsNow, readStatements } from "./game/store.js";
import { settleTransfer } from "./settlement.js";
import { bondsIssuedBy } from "./bonds.js";
import { SHARE_TERMS, registryProblems, valuePerShare, exitPrice, holdingsOf, holdingsValue } from "./shareRegistry.js";
import { setHoldingsValuer } from "./finances.js"; // ISP-160 (AB#854)

const DAY = 86_400_000;
const L = SHARE_TERMS.listing, O = SHARE_TERMS.offering, MM = SHARE_TERMS.marketMaker;

/** Every offering, the stored list itself (design: `market.shareOfferings[]`). */
export function shareOfferingList() {
  if (!Array.isArray(accountsStore.shareOfferings)) accountsStore.shareOfferings = [];
  return accountsStore.shareOfferings;
}

const corpOf = (accountId) => getAccountById(accountId)?.state?.corp ?? null;
const closed = (accountId, now, n = 30) => getStatements(accountId, n, now)?.statements ?? []; // newest first
export const outstandingOf = (r) => r.authorized - r.unissued;

/** Company value: the net worth on the latest closed daily statement, never below 0 (section 1). */
export function companyValue(statements) {
  const latest = [...(statements || [])].sort((a, b) => b.dayStart - a.dayStart)[0];
  return Math.max(0, Math.round(Number(latest?.balanceSheet?.netWorth) || 0));
}

/** The Board's price: floor(company value / shares outstanding), at least 1. */
export const sharePrice = (value, outstanding) => Math.max(1, Math.floor(value / outstanding));

/** The largest offering the founder floor allows: outstanding after a full sale keeps the founder at 51% or more. */
export const founderFloorRoom = (r) => Math.floor((r.founderShares * 100) / O.founderFloorPct) - outstandingOf(r);

/** Most a holder may hold with `outstanding` shares out: 20% of them. */
const holderCapOk = (held, outstanding) => held * 100 <= O.holderCapPct * outstanding;

/** Why this corporation may not list now, or null: { why, grade, level, statements }. */
export function listingProblem(accountId, now) {
  const corp = corpOf(accountId);
  if (!corp?.shareRegistry) return "No such corporation.";
  if (corp.shareRegistry.state === "listed") return "Your corporation is already listed.";
  if ((Number(corp.level) || 0) < L.minLevel) return `Listing on the Exchange takes corporation level ${L.minLevel}; yours is level ${Number(corp.level) || 0}.`;
  const statements = closed(accountId, now);
  if (statements.length < L.minStatements) return `Listing takes ${L.minStatements} closed daily statements; your corporation has ${statements.length}.`;
  const net = statements.reduce((a, s) => a + (Number(s.pnl?.net) || 0), 0);
  if (!(net > 0)) return "Listing takes positive net income over the last 30 days.";
  const grade = computeCreditRating(corp, now, statements, { bonds: bondsIssuedBy(accountId) }).grade;
  if (!L.grades.includes(grade)) return `Listing takes a credit grade of BBB or better; your corporation is ${grade}.`;
  return null;
}

/** List the corporation: the gate, then the 1% fee to the fee sink, then `listed`. { ok, fee } or { ok: false, error }. */
export function listCorporation(accountId, now = Date.now()) {
  const problem = listingProblem(accountId, now);
  if (problem) return { ok: false, error: problem };
  const fee = Math.floor((companyValue(closed(accountId, now)) * L.feePct) / 100);
  if (fee > 0) {
    const paid = settleTransfer({ fromAccountId: accountId, toAccountId: "sink:fee", credits: fee, reason: "fee", idempotencyKey: `listing:${accountId}` }, now);
    if (!paid.ok) return { ok: false, error: paid.error === "the payer does not have the credits" ? `Listing takes a fee of ${fee.toLocaleString("en-US")} credits (1% of company value).` : paid.error };
  }
  setRegistry(accountId, (r) => { r.state = "listed"; r.listedAt = now; });
  return { ok: true, fee };
}

/** Change a corporation's registry in one mutation: the change is made on a copy, and kept only if it holds the invariant. */
function setRegistry(accountId, change) {
  let ok = false;
  mutateAccountState(accountId, (state) => {
    const next = structuredClone(state.corp.shareRegistry);
    change(next);
    if (registryProblems(next).length) return;
    state.corp.shareRegistry = next;
    ok = true;
  }, { sanitize: false, settleMining: false });
  return ok;
}

/**
 * Open an offering of `quantity` new shares: { ok: true, offering } or { ok: false, error }. The price is the Board's
 * formula at this moment; nothing in the request sets it.
 */
export function openOffering(accountId, { quantity } = {}, now = Date.now()) {
  const corp = corpOf(accountId);
  const r = corp?.shareRegistry;
  if (!r) return { ok: false, error: "No such corporation." };
  if (r.state !== "listed") return { ok: false, error: "List your corporation on the Exchange before offering shares." };
  const mine = shareOfferingList().filter((o) => o.issuerAccountId === accountId);
  if (mine.some((o) => o.state === "open")) return { ok: false, error: "Your corporation already has an offering open." };
  const last = mine.reduce((a, o) => Math.max(a, o.openedAt), 0);
  if (last && now < last + O.cadenceDays * DAY) return { ok: false, error: `The next offering may open ${O.cadenceDays} days after the last one opened.` };
  const outstanding = outstandingOf(r);
  const max = Math.min(Math.floor((outstanding * O.maxPctOfOutstanding) / 100), founderFloorRoom(r), r.unissued);
  if (!Number.isInteger(quantity) || quantity < O.minQuantity) return { ok: false, error: `An offering is at least ${O.minQuantity} shares.` };
  if (quantity > max) {
    const why = quantity > founderFloorRoom(r) ? `it would leave the founder below ${O.founderFloorPct}% of shares outstanding` : quantity > r.unissued ? "that is more than is unissued" : `it is more than ${O.maxPctOfOutstanding}% of shares outstanding`;
    return { ok: false, error: `At most ${Math.max(0, max).toLocaleString("en-US")} shares may be offered now: ${why}.` };
  }
  const value = companyValue(closed(accountId, now));
  const offering = {
    id: `so-${now.toString(36)}-${(shareOfferingList().length + 1).toString(36)}`,
    issuerAccountId: accountId,
    issuerCorpId: corp.publicId ?? null,
    issuerName: corp.corporationName ?? null,
    quantity,
    pricePerShare: sharePrice(value, outstanding),
    companyValueAtOpen: value,
    outstandingAtOpen: outstanding,
    soldToPlayers: 0,
    soldToMarketMaker: 0,
    purchases: 0,
    proceeds: 0,
    feePct: O.feePct,
    feePaid: 0,
    state: "open",
    openedAt: now,
    closesAt: now + O.openDays * DAY,
    closedAt: null
  };
  shareOfferingList().push(offering);
  saveAccountsNow();
  return { ok: true, offering };
}

const left = (o) => o.quantity - o.soldToPlayers - o.soldToMarketMaker;

/** Add `shares` to `holder`'s row in registry `r` (a new row if it has none), from `unissued`. */
function addShares(r, holder, shares, paid, now) {
  const same = (h) => (holder.kind === "npc" ? h.holder?.kind === "npc" && h.holder.id === holder.id : h.holder?.corpId === holder.corpId);
  let row = r.holders.find(same);
  if (!row) { row = { holder, shares: 0, costBasis: 0, dividendsReceived: 0, acquiredAt: now }; r.holders.push(row); }
  row.shares += shares;
  row.costBasis += paid;
  r.unissued -= shares;
}

const heldBy = (r, match) => r.holders.filter(match).reduce((a, h) => a + h.shares, 0);

/**
 * Buy `quantity` shares in an open offering: { ok: true, offering, shares, paid } or { ok: false, status, error }.
 * Refused, with nothing moved: the issuer itself, a buyer below level 8, a closed offering, a quantity that is not a
 * whole number within what is left, a holding above 20% after the purchase, credits that do not cover it.
 */
export function buyShares(accountId, { offeringId, quantity } = {}, now = Date.now()) {
  const o = typeof offeringId === "string" ? shareOfferingList().find((x) => x.id === offeringId) : null;
  if (!o) return { ok: false, status: 404, error: "No such offering." };
  if (o.issuerAccountId === accountId) return { ok: false, status: 409, error: "A corporation cannot buy its own shares." };
  if (o.state !== "open" || now >= o.closesAt) return { ok: false, status: 409, error: "That offering has closed." };
  const buyer = corpOf(accountId);
  if (!buyer) return { ok: false, status: 404, error: "No such corporation." };
  if ((Number(buyer.level) || 0) < SHARE_TERMS.buyerMinLevel) return { ok: false, status: 409, error: `Buying on the Exchange takes corporation level ${SHARE_TERMS.buyerMinLevel}.` };
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, status: 400, error: "Buy a whole number of shares, at least 1." };
  if (quantity > left(o)) return { ok: false, status: 409, error: `Only ${left(o).toLocaleString("en-US")} shares of that offering are left.` };
  const r = corpOf(o.issuerAccountId)?.shareRegistry;
  const held = heldBy(r, (h) => h.holder?.corpId === buyer.publicId);
  if (!holderCapOk(held + quantity, outstandingOf(r) + quantity)) {
    const most = Math.max(0, Math.floor((O.holderCapPct * outstandingOf(r) - 100 * held) / (100 - O.holderCapPct)));
    return { ok: false, status: 409, error: `No holder may own more than ${O.holderCapPct}% of shares outstanding: you may buy at most ${most.toLocaleString("en-US")} more.` };
  }
  const paid = quantity * o.pricePerShare;
  const n = o.purchases + 1;
  let registryError = null;
  const moved = settleTransfer({
    fromAccountId: accountId, toAccountId: o.issuerAccountId, credits: paid, reason: "share-purchase", idempotencyKey: `shares:${o.id}:${n}`,
    withPayer: (state) => {
      const index = new Set(state.corp.holdingIndex || []);
      index.add(o.issuerCorpId);
      state.corp.holdingIndex = [...index];
    },
    withPayee: (state) => {
      const reg = state.corp.shareRegistry;
      addShares(reg, { kind: "corp", corpId: buyer.publicId }, quantity, paid, now);
      const problems = registryProblems(reg);
      if (problems.length) registryError = problems.join("; "); // checked, never thrown: the credits have moved
    }
  }, now);
  if (!moved.ok) return { ok: false, status: 409, error: moved.error === "the payer does not have the credits" ? `Buying takes ${paid.toLocaleString("en-US")} credits.` : moved.error };
  if (registryError) console.error(`[shares] ${o.id}: the registry broke its invariant on a purchase: ${registryError}`);
  o.purchases = n;
  o.soldToPlayers += quantity;
  o.proceeds += paid;
  saveAccountsNow();
  return { ok: true, offering: o, shares: quantity, paid };
}

/** The market maker's fill at close (section 5): clip((expectedYield30 - 0.5%) / 2%, 0, 1) x the grade's factor. */
export function marketMakerFill({ payoutRatioPct, netIncome30, value, grade }) {
  if (!(value > 0)) return 0;
  const yieldPct = ((payoutRatioPct / 100) * Math.max(0, netIncome30) / value) * 100;
  const f = Math.min(1, Math.max(0, (yieldPct - MM.yieldFloorPct) / MM.yieldSpanPct));
  return f * (MM.gradeFactor[grade] ?? 0);
}

/** Close an offering: the market maker's fill of what is left, within its 20%, then the 2% fee. Idempotent. */
export function closeOffering(o, now) {
  if (o.state !== "open") return o;
  const issuer = corpOf(o.issuerAccountId);
  const r = issuer?.shareRegistry;
  if (r) {
    const statements = closed(o.issuerAccountId, now);
    const netIncome30 = statements.reduce((a, s) => a + (Number(s.pnl?.net) || 0), 0);
    const grade = computeCreditRating(issuer, now, statements, { bonds: bondsIssuedBy(o.issuerAccountId) }).grade;
    let units = Math.floor(left(o) * marketMakerFill({ payoutRatioPct: r.payoutRatioPct, netIncome30, value: companyValue(statements), grade }));
    const mmHeld = heldBy(r, (h) => h.holder?.kind === "npc" && h.holder.id === MM.id);
    while (units > 0 && !holderCapOk(mmHeld + units, outstandingOf(r) + units)) units--; // its own 20% cap
    if (units > 0) {
      const paid = units * o.pricePerShare;
      const moved = settleTransfer({
        fromAccountId: MM.account, toAccountId: o.issuerAccountId, credits: paid, reason: "share-purchase", idempotencyKey: `shares:${o.id}:market-maker`,
        withPayee: (state) => addShares(state.corp.shareRegistry, { kind: "npc", id: MM.id }, units, paid, now)
      }, now);
      if (moved.ok) { o.soldToMarketMaker = units; o.proceeds += paid; }
    }
  }
  const fee = Math.floor((o.proceeds * o.feePct) / 100);
  if (fee > 0) {
    const paid = settleTransfer({ fromAccountId: o.issuerAccountId, toAccountId: "sink:fee", credits: fee, reason: "fee", idempotencyKey: `shares:${o.id}:fee` }, now);
    if (paid.ok) o.feePaid = fee; else o.feeUnpaid = fee;
  }
  o.state = "closed";
  o.closedAt = now;
  saveAccountsNow();
  return o;
}

/** The offering tick: close every open offering whose 7 days have passed. `now` is passed in. */
export function shareOfferingTick(now) {
  for (const o of shareOfferingList()) if (o.state === "open" && now >= o.closesAt) closeOffering(o, now);
}

/** An offering as any corporation may see it: no account ids. */
export function publicOffering(o, now = Date.now()) {
  return {
    id: o.id, issuerCorpId: o.issuerCorpId, issuerName: o.issuerName, quantity: o.quantity, left: left(o),
    pricePerShare: o.pricePerShare, state: o.state === "open" && now >= o.closesAt ? "closing" : o.state,
    openedAt: o.openedAt, closesAt: o.closesAt, closedAt: o.closedAt, soldToPlayers: o.soldToPlayers, soldToMarketMaker: o.soldToMarketMaker
  };
}

// ─── ISP-160 (AB#854): holding value and the investor exit ──────────────────
// docs/design/v0.9-equity.md, sections 1, 5 and 8. A holding is worth the Board's value per share (company value /
// shares outstanding, AB#704) times its shares; it counts in the investor's balance sheet (ISP-1) and so in its net
// worth. An investor exits by selling to the IGSX market maker at floor(value x 0.95), from the market maker's tap, at
// most 1% of the issuer's shares outstanding a day across every seller and never past the market maker's own 20%. A
// defaulting investor's shares are sold the same way in recovery, with both limits waived (section 8).
const accountOfCorp = (corpId) => (corpId ? Object.keys(accountsStore.accounts || {}).find((id) => accountsStore.accounts[id]?.state?.corp?.publicId === corpId) ?? null : null);

/** The net worth on an account's latest closed statement (filed, or closed and not yet filed), never below 0. Reads only. */
function latestClosedNetWorth(accountId) {
  const unfiled = accountsStore.accounts?.[accountId]?.state?.statements || [];
  return companyValue([...readStatements(accountId), ...unfiled]);
}

/** An issuer as a valuation needs it: { accountId, registry, companyValue, name }, or null. Never closes a day. */
export function issuerFacts(corpId) {
  const accountId = accountOfCorp(corpId);
  const corp = accountId ? accountsStore.accounts[accountId].state.corp : null;
  if (!corp?.shareRegistry) return null;
  return { accountId, registry: corp.shareRegistry, companyValue: latestClosedNetWorth(accountId), name: corp.corporationName || "" };
}
setHoldingsValuer((corp) => holdingsValue(corp, issuerFacts)); // the balance sheet's holdings line (finances.js)

/** The caller's holdings, each with its value, cost and exit price: what the investor's view shows. */
export const holdingsOfAccount = (accountId) => holdingsOf(corpOf(accountId), issuerFacts);

const dayOf = (now) => Math.floor(now / DAY) * DAY;

/**
 * Sell `quantity` of the caller's shares in `issuerCorpId` to the market maker, at `now`. The price is the server's:
 * nothing in the request is read but the issuer and the quantity. { ok, shares, valuePerShare, pricePerShare, paid } or
 * { ok: false, status, error }, with nothing moved. `recovery: true` (default recovery) waives the market maker's
 * daily and 20% limits; `key` names the transfer then.
 */
export function exitShares(accountId, { issuerCorpId, quantity } = {}, now = Date.now(), { recovery = false, key } = {}) {
  const investor = corpOf(accountId);
  if (!investor?.publicId) return { ok: false, status: 404, error: "No such corporation." };
  const facts = typeof issuerCorpId === "string" ? issuerFacts(issuerCorpId) : null;
  if (!facts) return { ok: false, status: 404, error: "No such listed corporation." };
  if (facts.accountId === accountId) return { ok: false, status: 409, error: "A corporation holds none of its own shares." };
  const r = facts.registry;
  const row = r.holders.find((h) => h.holder?.kind === "corp" && h.holder.corpId === investor.publicId);
  const held = row?.shares || 0;
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, status: 400, error: "Sell a whole number of shares, at least 1." };
  if (quantity > held) return { ok: false, status: 409, error: `You hold ${held.toLocaleString("en-US")} shares of ${facts.name}.` };
  const outstanding = outstandingOf(r);
  const perShare = valuePerShare(facts.companyValue, outstanding);
  const price = exitPrice(perShare);
  if (price < 1) return { ok: false, status: 409, error: `${facts.name} is worth nothing on its last statement: the market maker pays nothing for its shares now.` };
  const today = dayOf(now);
  const soldToday = r.marketMakerExits?.day === today ? r.marketMakerExits.shares : 0;
  if (!recovery) {
    const mmHeld = heldBy(r, (h) => h.holder?.kind === "npc" && h.holder.id === MM.id);
    const room = Math.min(
      Math.floor((outstanding * MM.exitDailyPctOfOutstanding) / 100) - soldToday, // 1% of outstanding a day, every seller
      Math.floor((outstanding * O.holderCapPct) / 100) - mmHeld // and never past its own 20%
    );
    if (quantity > room) {
      return { ok: false, status: 409, error: room > 0 ? `The market maker can take at most ${room.toLocaleString("en-US")} more shares of ${facts.name} today.` : `The market maker takes no more shares of ${facts.name} today. Try again tomorrow, or hold.` };
    }
  }
  const paid = quantity * price;
  const exitNo = (r.exits || 0) + 1;
  // The shares move first, in the issuer's registry; then the market maker pays. The payment is from a tap, so only a
  // malformed request fails it, and then the move is put back.
  let removedCost = 0;
  const move = (dir) => mutateAccountState(facts.accountId, (state) => {
    const reg = state.corp.shareRegistry;
    const mine = (h) => h.holder?.kind === "corp" && h.holder.corpId === investor.publicId;
    const mm = (h) => h.holder?.kind === "npc" && h.holder.id === MM.id;
    if (dir > 0) {
      const from = reg.holders.find(mine);
      removedCost = Math.round((from.costBasis || 0) * (quantity / from.shares));
      from.shares -= quantity;
      from.costBasis = (from.costBasis || 0) - removedCost;
      if (from.shares === 0) reg.holders = reg.holders.filter((h) => h !== from);
      let to = reg.holders.find(mm);
      if (!to) { to = { holder: { kind: "npc", id: MM.id }, shares: 0, costBasis: 0, dividendsReceived: 0, acquiredAt: now }; reg.holders.push(to); }
      to.shares += quantity;
      to.costBasis += paid;
      reg.exits = exitNo;
      if (!recovery) reg.marketMakerExits = { day: today, shares: soldToday + quantity };
    } else {
      const to = reg.holders.find(mm);
      to.shares -= quantity;
      to.costBasis -= paid;
      if (to.shares === 0) reg.holders = reg.holders.filter((h) => h !== to);
      let from = reg.holders.find(mine);
      if (!from) { from = { holder: { kind: "corp", corpId: investor.publicId }, shares: 0, costBasis: 0, dividendsReceived: 0, acquiredAt: now }; reg.holders.push(from); }
      from.shares += quantity;
      from.costBasis += removedCost;
      reg.exits = exitNo - 1;
      if (!recovery) reg.marketMakerExits = { day: today, shares: soldToday };
    }
    const problems = registryProblems(reg);
    if (problems.length) throw new Error(`the registry would break its invariant: ${problems.join("; ")}`);
  }, { sanitize: false, settleMining: false });
  move(+1);
  const leftAfter = held - quantity;
  const moved = settleTransfer({
    fromAccountId: MM.account, toAccountId: accountId, credits: paid, reason: "share-purchase",
    idempotencyKey: key || `shares:exit:${issuerCorpId}:${exitNo}`,
    withPayee: (state) => { if (leftAfter === 0) state.corp.holdingIndex = (state.corp.holdingIndex || []).filter((id) => id !== issuerCorpId); }
  }, now);
  if (!moved.ok) { move(-1); return { ok: false, status: 409, error: moved.error }; }
  saveAccountsNow();
  return { ok: true, shares: quantity, valuePerShare: perShare, pricePerShare: price, paid, issuerName: facts.name };
}

/**
 * Default recovery's share stage (section 8, Board AB#702): sell the debtor's shares to the market maker at the exit
 * price, limits waived, highest price first, only as many as it takes to raise `needed`. Returns the credits raised.
 */
export function sellSharesForRecovery(accountId, needed, now, tag, sold = []) {
  let raised = 0;
  const holdings = holdingsOfAccount(accountId).filter((h) => h.exitPrice > 0).sort((a, b) => b.exitPrice - a.exitPrice);
  for (const h of holdings) {
    if (raised >= needed) break;
    const units = Math.min(h.shares, Math.ceil((needed - raised) / h.exitPrice));
    const r = exitShares(accountId, { issuerCorpId: h.issuerCorpId, quantity: units }, now, { recovery: true, key: `${tag}:shares:${h.issuerCorpId}` });
    if (!r.ok) continue;
    raised += r.paid;
    sold.push({ kind: "shares", name: `${units} share${units === 1 ? "" : "s"} of ${h.issuerName || "a corporation"}`, credits: r.paid });
  }
  return raised;
}
