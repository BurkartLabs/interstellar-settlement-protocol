// ISP-286 (AB#993): recover a defaulted player debt: credits, then liquid holdings, then force-sold assets.
//
// The Board answered D-0.9-1 (AB#702): "Anything liquid, assets force sold if not able to cover." docs/design/v0.9-debt.md,
// section 10, with the more protective reading wherever the answer leaves a gap:
//   - Trigger: a player loan more than 7 days in arrears (marked defaultedAt by the servicing tick, AB#846), or a bond
//     series more than 7 days in arrears (state `defaulted`, server/bondServicing.js, AB#849; Bug #2574).
//   - Grace: a warning, then 24 hours before anything is sold. Paying the arrears in that time cancels the sale, and
//     while the grace period runs the debtor cannot move value to another corporation (server/recoveryHold.js).
//   - Order, stopping at the amount owed (the arrears and the principal still scheduled; loanServicing owedOnDefault):
//       1. credits;
//       2. station inventory, sold at the NPC standing bid, highest bid first, only as many units as it takes;
//       3. bond holdings, sold to the NPC underwriter at 90% of face, only as many units as it takes (Bug #2574;
//          share holdings join here in their own story)
//       4. buildings, force-sold to the ISA at 40% of what was paid (server/buildingRemoval.js), then leases with
//          nothing left on them at 40% of their price. Each time: the cheapest one that covers what is still owed,
//          or, if none does, the dearest, and again.
//     A sale can raise more than is owed; the surplus stays with the debtor, whose credits pay only what is owed.
//   - Never sold: the office, research, the level and the Headquarters. A debtor is never removed from the game.
// NPC loans are unchanged: the Development Bank never takes more than each day's collection (section 10).
// A bond series owes its arrears and, once recovery runs, its whole face (it is accelerated, as a loan's balance falls
// due in default); what is recovered is paid to its holders pro rata by what each is owed (server/bondServicing.js).
//
// Every credit moves through settleTransfer. Every sale is one mutation on a copy of the corporation, put in place only
// when the whole sale is written, so a failure part way leaves the corporation as it was. Sale prices are the server's.
// Time is passed in (P-TEST-TIME).
import { addAccountNotification, getAccountById, getAllAccountIds, getState, mutateAccountState } from "./gameState.js";
import { deepClone } from "./game/catalog.js";
import { applyCredits } from "./finances.js";
import { emitToAccount } from "./realtime.js";
import { collectOwed, owedOnDefault } from "./loanServicing.js";
import { accountIdOfCorp } from "./playerLoans.js";
import { removeBuilding, buildingCostBasis, NEVER_REMOVED } from "./buildingRemoval.js";
import { bondSeriesList } from "./bonds.js";
import { accelerateSeries, bondOwedOnDefault, collectBondOwed, holdersOf, sellHoldingsToUnderwriter } from "./bondServicing.js";

const HOUR = 3_600_000;
export const GRACE_HOURS = 24;
export const SALVAGE_PCT = 40;

const corpOf = (accountId) => getAccountById(accountId)?.state?.corp ?? null;
const fmt = (n) => Math.round(n).toLocaleString("en-US");

function tell(accountId, title, body) {
  const n = accountId ? addAccountNotification(accountId, { type: "finance", title, body }) : null;
  if (n) emitToAccount(accountId, "notifications:new", { accountId, notification: n });
}

/** Write `loan` and the recovery record back onto the debtor's corporation. */
function save(accountId, loan, recovery) {
  mutateAccountState(accountId, (state) => {
    const loans = state.corp.loans || [];
    const i = loans.findIndex((l) => l.id === loan.id);
    if (i !== -1) loans[i] = { ...loan };
    if (recovery) {
      if (!Array.isArray(state.corp.recoveries)) state.corp.recoveries = [];
      const j = state.corp.recoveries.findIndex((r) => r.id === recovery.id);
      if (j === -1) state.corp.recoveries.push({ ...recovery }); else state.corp.recoveries[j] = { ...recovery };
    }
  }, { sanitize: false, settleMining: false });
}

/** Write a recovery record onto the debtor's corporation (a bond issuer's; a loan's goes with its loan in save()). */
function saveRecovery(accountId, recovery) {
  mutateAccountState(accountId, (state) => {
    if (!Array.isArray(state.corp.recoveries)) state.corp.recoveries = [];
    const j = state.corp.recoveries.findIndex((r) => r.id === recovery.id);
    if (j === -1) state.corp.recoveries.push({ ...recovery }); else state.corp.recoveries[j] = { ...recovery };
  }, { sanitize: false, settleMining: false });
}

/**
 * One sale, all or nothing: `sell(draft)` changes a copy of the corporation and returns the credits raised; the copy
 * replaces the corporation only if it returns. The proceeds are booked as forced-sale income.
 */
export function atomicSale(accountId, sell) {
  let raised = 0;
  mutateAccountState(accountId, (state) => {
    const draft = deepClone(state.corp);
    raised = Math.max(0, Math.round(sell(draft) || 0));
    if (raised > 0) applyCredits(draft, raised, "forced-sale");
    state.corp = draft;
  }, { sanitize: false });
  return raised;
}

// ─── Liquid holdings: station inventory at the NPC standing bid ─────────────
/** Every unit the NPC exchange bids for, as { stationId, item, units, bid }, highest bid first. Pure. */
export function liquidInventory(corp, npcBuyOrders) {
  const bids = new Map();
  for (const o of npcBuyOrders || []) if (o?.item && Number(o.unitPrice) > 0) bids.set(o.item, Math.max(bids.get(o.item) || 0, Math.floor(Number(o.unitPrice))));
  const out = [];
  for (const [stationId, held] of Object.entries(corp?.inventory || {})) {
    for (const [item, qty] of Object.entries(held || {})) {
      const units = Math.floor(Number(qty) || 0);
      if (units > 0 && bids.get(item) > 0) out.push({ stationId, item, units, bid: bids.get(item) });
    }
  }
  return out.sort((a, b) => b.bid - a.bid || a.item.localeCompare(b.item) || a.stationId.localeCompare(b.stationId));
}

/** Sell only as many units as it takes to raise `needed`, in liquidInventory's order. Changes `draft`. */
function sellInventory(draft, needed, npcBuyOrders, sold) {
  let raised = 0;
  for (const lot of liquidInventory(draft, npcBuyOrders)) {
    if (raised >= needed) break;
    const units = Math.min(lot.units, Math.ceil((needed - raised) / lot.bid));
    draft.inventory[lot.stationId][lot.item] -= units;
    if (draft.inventory[lot.stationId][lot.item] <= 0) delete draft.inventory[lot.stationId][lot.item];
    raised += units * lot.bid;
    sold.push({ kind: "inventory", stationId: lot.stationId, item: lot.item, units, credits: units * lot.bid });
  }
  return raised;
}

// ─── Assets: buildings, then empty leases, at the salvage value ─────────────
const salvage = (cost) => Math.floor((Math.max(0, Number(cost) || 0) * SALVAGE_PCT) / 100);

/** What can be force-sold now, with its salvage value. Leases only once nothing stands on them. Pure. */
export function saleableAssets(corp) {
  const buildings = (corp?.buildings || [])
    .filter((b) => typeof b?.id === "string" && !NEVER_REMOVED.includes(b.name))
    .map((b) => ({ kind: "building", id: b.id, name: b.name, value: salvage(buildingCostBasis(b)) }))
    .filter((a) => a.value > 0);
  const leases = (corp?.miningLeases || [])
    .filter((l) => !(l.extractorIds || []).length && !(l.facilities || []).length)
    .map((l) => ({ kind: "lease", id: l.id, name: `${l.body || "A"} lease`, value: salvage(l.cost) }))
    .filter((a) => a.value > 0);
  return buildings.length ? buildings : leases; // buildings first: a lease is sold only when nothing stands on it
}

/** The asset to sell for `needed`: the cheapest that covers it, else the dearest. Pure. */
export function pickAsset(assets, needed) {
  const covering = assets.filter((a) => a.value >= needed).sort((a, b) => a.value - b.value);
  if (covering.length) return covering[0];
  return [...assets].sort((a, b) => b.value - a.value)[0] || null;
}

function sellAsset(draft, asset, now, sold) {
  if (asset.kind === "building") {
    const r = removeBuilding(draft, asset.id, now);
    if (r.outcome !== "ok") throw new Error(`recovery could not remove ${asset.name}: ${r.outcome}`);
  } else {
    const at = (draft.miningLeases || []).findIndex((l) => l.id === asset.id);
    if (at < 0) throw new Error(`recovery could not find ${asset.name}`);
    draft.miningLeases.splice(at, 1);
    draft.buildingSlots = Math.max((draft.buildings || []).length, (Number(draft.buildingSlots) || 2) - 2); // what the lease added
  }
  sold.push({ kind: asset.kind, name: asset.name, credits: asset.value });
  return asset.value;
}

// ─── The recovery ────────────────────────────────────────────────────────────
/**
 * Recover what the defaulted loan `loanId` on `debtorAccountId` owes, at `now`. Returns
 * { ok, owedBefore, collected, shortfall, sold[] }. Collects from credits, then sells inventory, then assets, stopping
 * as soon as nothing is owed; whatever a sale raises beyond that stays with the debtor. `options.faultAfterSale` is
 * for the test that a failed sale changes nothing: it throws inside the sale, after it has changed the copy.
 */
export function recoverDefault(debtorAccountId, loanId, now, options = {}) {
  const loan = corpOf(debtorAccountId)?.loans?.find((l) => l.id === loanId);
  if (!loan || loan.lender?.kind !== "player") return { ok: false, error: "No such player loan." };
  const r = runRecovery(debtorAccountId, {
    tag: `recovery:${loan.id}:${now}`,
    owed: () => owedOnDefault(loan),
    collect: (key) => collectOwed(debtorAccountId, loan, now, key)
  }, now, options);
  save(debtorAccountId, loan, null);
  return { ...r, loan };
}

/**
 * Bug #2574: recover what the defaulted bond series `seriesId` owes from its issuer, at `now`: the whole face falls
 * due (accelerateSeries), then the same stages as a loan, each collection split to the holders pro rata. Returns
 * { ok, owedBefore, collected, shortfall, sold[], series }.
 */
export function recoverBondDefault(seriesId, now, options = {}) {
  const series = bondSeriesList().find((x) => x.id === seriesId);
  if (!series || series.state !== "defaulted") return { ok: false, error: "No such defaulted bond series." };
  accelerateSeries(series, now);
  const r = runRecovery(series.issuerAccountId, {
    tag: `recovery:${series.id}:${now}`,
    owed: () => bondOwedOnDefault(series),
    collect: (key) => collectBondOwed(series, now, key)
  }, now, options);
  return { ...r, series };
}

/**
 * The stages, for any debt: `debt.owed()` is what is still owed, `debt.collect(key)` takes what the debtor's credits
 * cover of it. Credits, then station goods, then bond holdings, then buildings and leases, stopping when nothing is
 * owed. { ok, owedBefore, collected, shortfall, sold[] }.
 */
function runRecovery(debtorAccountId, debt, now, options = {}) {
  const owedBefore = debt.owed();
  const sold = [];
  const tag = debt.tag;
  let step = 0;
  const collect = () => debt.collect(`${tag}:${step++}`);
  const owed = () => debt.owed();

  collect(); // 1. credits
  if (owed() > 0) { // 2. station inventory at the NPC standing bid
    const npc = getState()?.market?.npcBuyOrders || [];
    if (liquidInventory(corpOf(debtorAccountId), npc).length) {
      atomicSale(debtorAccountId, (draft) => {
        const raised = sellInventory(draft, owed(), npc, sold);
        if (options.faultAfterSale === "inventory") throw new Error("injected fault after the inventory sale");
        return raised;
      });
      collect();
    }
  }
  if (owed() > 0) { // 3. bond holdings, to the NPC underwriter at 90% of face (Bug #2574)
    if (sellHoldingsToUnderwriter(debtorAccountId, owed(), now, `${tag}:${step}`, sold) > 0) collect();
  }
  // 4. buildings, then empty leases, one at a time
  for (let guard = 0; owed() > 0 && guard < 100; guard++) {
    const asset = pickAsset(saleableAssets(corpOf(debtorAccountId)), owed());
    if (!asset) break;
    atomicSale(debtorAccountId, (draft) => {
      const raised = sellAsset(draft, asset, now, sold);
      if (options.faultAfterSale === "asset") throw new Error("injected fault after the asset sale");
      return raised;
    });
    collect();
  }
  return { ok: true, owedBefore, collected: owedBefore - owed(), shortfall: owed(), sold };
}

/**
 * The recovery tick: starts a recovery (the warning and the grace period) for each player loan newly in default, and
 * runs each whose grace period has ended, unless the arrears were paid in it, which cancels the sale.
 */
export function defaultRecoveryTick(now) {
  for (const accountId of getAllAccountIds()) {
    const corp = corpOf(accountId);
    for (const loan of corp?.loans || []) {
      if (loan?.lender?.kind !== "player" || !loan.defaultedAt) continue;
      const id = `rec-${loan.id}-${loan.defaultedAt}`;
      const existing = (corp.recoveries || []).find((r) => r.id === id);
      const lenderAccountId = accountIdOfCorp(loan.lender.corpId);
      if (!existing) {
        if (loan.state !== "arrears") continue;
        const recovery = { id, loanId: loan.id, creditorCorpId: loan.lender.corpId, warnedAt: now, saleAt: now + GRACE_HOURS * HOUR, state: "grace" };
        save(accountId, loan, recovery);
        tell(accountId, "Your assets will be sold in 24 hours", `Your loan from ${corpOf(lenderAccountId)?.corporationName || "another corporation"} is in default: ${fmt(owedOnDefault(loan))} credits are owed. In 24 hours your credits, then your station goods at the exchange's bid, then your buildings at ${SALVAGE_PCT}% of what you paid will be taken until it is covered. Paying the ${fmt(loan.arrears)} credits in arrears before then cancels the sale. Your office, research, level and Headquarters are never taken.`);
        tell(lenderAccountId, "Recovery begins in 24 hours", `${corp.corporationName || "Your borrower"} is in default on your loan. If the arrears are not paid within 24 hours, what is owed will be recovered from its credits, goods and buildings.`);
        continue;
      }
      if (existing.state !== "grace" || existing.saleAt > now) continue;
      if (loan.state !== "arrears") { // paid in the grace period: the sale is cancelled
        save(accountId, { ...loan, defaultedAt: loan.state === "repaid" ? loan.defaultedAt : null }, { ...existing, state: "cancelled", closedAt: now });
        tell(accountId, "Sale cancelled", "Your arrears were paid in time: nothing will be sold.");
        tell(lenderAccountId, "Recovery cancelled", `${corp.corporationName || "Your borrower"} paid its arrears in time.`);
        continue;
      }
      const r = recoverDefault(accountId, loan.id, now);
      const result = { collected: r.collected, shortfall: r.shortfall, sold: r.sold.map((s) => ({ kind: s.kind, name: s.name || s.item, credits: s.credits })) };
      save(accountId, r.loan, { ...existing, state: "done", closedAt: now, result });
      tell(accountId, "Debt recovered", `${fmt(r.collected)} credits were taken for your defaulted loan${r.sold.length ? `, selling ${r.sold.map((s) => s.name || `${s.units} ${s.item}`).join(", ")}` : ""}.${r.shortfall ? ` ${fmt(r.shortfall)} credits are still owed and are collected as your credits allow.` : " The loan is closed."}`);
      tell(lenderAccountId, "Debt recovered", `${fmt(r.collected)} credits were recovered from ${corp.corporationName || "your borrower"}.${r.shortfall ? ` ${fmt(r.shortfall)} could not be recovered yet and is collected as its credits allow.` : " The loan is closed."}`);
    }
  }
  bondRecoveryTick(now);
}

/**
 * Bug #2574: the same for bond series: a warning and 24 hours' grace from the issuer's default, the sale cancelled
 * if the issuer brings the series back out of default in that time, otherwise recoverBondDefault. The holders are told
 * at each step. A series left owing after recovery is still collected daily by its servicing, as its credits allow.
 */
export function bondRecoveryTick(now) {
  for (const s of bondSeriesList()) {
    if (!s.defaultedAt) continue;
    const id = `rec-${s.id}-${s.defaultedAt}`;
    const issuer = corpOf(s.issuerAccountId);
    if (!issuer) continue;
    const existing = (issuer.recoveries || []).find((r) => r.id === id);
    const holders = holdersOf(s).map((h) => h.account).filter((a) => !a.startsWith("tap:"));
    const name = `${s.quantity.toLocaleString("en-US")}-unit bond series at ${s.couponPct30}%`;
    if (!existing) {
      if (s.state !== "defaulted") continue;
      saveRecovery(s.issuerAccountId, { id, seriesId: s.id, warnedAt: now, saleAt: now + GRACE_HOURS * HOUR, state: "grace" });
      tell(s.issuerAccountId, "Your assets will be sold in 24 hours", `Your ${name} is in default: ${fmt(bondOwedOnDefault(s))} credits are owed to its holders, its whole face included. In 24 hours your credits, then your station goods at the exchange's bid, then your bond holdings at 90% of face, then your buildings at ${SALVAGE_PCT}% of what you paid will be taken until it is covered. Paying the ${fmt(s.arrears)} credits in arrears before then cancels the sale. Your office, research, level and Headquarters are never taken.`);
      for (const h of holders) tell(h, "Bond recovery begins in 24 hours", `${s.issuerName || "The issuer"} is in default on its ${name}. If the arrears are not paid within 24 hours, what it owes will be recovered from its credits, goods, bonds and buildings and paid to holders by what each is owed.`);
      continue;
    }
    if (existing.state !== "grace" || existing.saleAt > now) continue;
    if (s.state !== "defaulted") { // brought back out of default in the grace period: the sale is cancelled
      saveRecovery(s.issuerAccountId, { ...existing, state: "cancelled", closedAt: now });
      tell(s.issuerAccountId, "Sale cancelled", "Your bond arrears were paid in time: nothing will be sold.");
      for (const h of holders) tell(h, "Bond recovery cancelled", `${s.issuerName || "The issuer"} paid its bond arrears in time.`);
      continue;
    }
    const r = recoverBondDefault(s.id, now);
    const result = { collected: r.collected, shortfall: r.shortfall, sold: r.sold.map((x) => ({ kind: x.kind, name: x.name || x.item, credits: x.credits })) };
    saveRecovery(s.issuerAccountId, { ...existing, state: "done", closedAt: now, result });
    tell(s.issuerAccountId, "Debt recovered", `${fmt(r.collected)} credits were taken for your defaulted ${name}${r.sold.length ? `, selling ${r.sold.map((x) => x.name || `${x.units} ${x.item}`).join(", ")}` : ""}.${r.shortfall ? ` ${fmt(r.shortfall)} credits are still owed to its holders and are collected as your credits allow.` : " The series is repaid and closed."}`);
    for (const h of holders) tell(h, "Bond recovery", `${fmt(r.collected)} credits were recovered from ${s.issuerName || "the issuer"} for its ${name} and paid to holders by what each was owed.${r.shortfall ? ` ${fmt(r.shortfall)} is still owed and is collected as its credits allow.` : " The series is closed."}`);
  }
}
