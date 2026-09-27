// ISP-162 (AB#856): the financial-markets profile of the ISP probe. Three bots per corporation profile play the same
// 30 days: one that never borrows, one that borrows the most the Development Bank lends every chance it gets, and a
// planner that borrows, issues bonds and offers shares by the design's own rules (docs/design/v0.9-debt.md section 8,
// v0.9-equity.md section 6; bondPlanner.js, equityPlanner.js). It prints what the v0.9 stories claim: net worth at day
// 30 for each bot, the planner's coupons and payout ratios, and what the bank created against what interest and fees
// destroyed.
//
// BOT NUMBERS (P-PROXY, DOCTRINE P-005). A bot is not a player. What these numbers measure is whether the leverage,
// coupon and ratio knobs have an interior optimum under the design's arithmetic and the server's real finance code;
// they are not a fact about anybody's play, pace or wealth.
//
// WHAT IS REAL AND WHAT IS ASSUMED, stated rather than implied:
//   - Real (the server's own code, with the clock moved): the bank's offers, quotes, acceptance and servicing
//     (loans.js, loanServicing.js); bond issue, window close, underwriter fill and coupons (bonds.js, bondServicing.js);
//     listing, offerings, the market maker's fill and dividends (shareOfferings.js, dividends.js); statements, grades
//     and the settlement ledger every flow below is counted from.
//   - Assumed: the business. A corporation's operations are one number, its capital K (facilities, at cost), which
//     earns each day capitalValue(K, 1 day) (bondPlanner.js: a return per 30 days whose marginal rate halves every
//     halfLifeCredits), less a fixed daily operating cost. It is booked as exchange income and mining-ops cost, the
//     categories a mining corporation's statements carry. Capital bought with borrowed or raised credits is booked as
//     construction, as a real building is. Capital never depreciates or breaks. No mining, market, research, other
//     sellers or player loans: one world of bot corporations that meet only at the bank and the market maker.
//   - Net worth is computed here, not read: the statement's net worth leaves debt out of liabilities (Bug AB#4647), so
//     it would reward borrowing by the principal. The probe's figure is the statement's net worth less loans owed
//     (balance and arrears) and bond face outstanding, times the founder's share of shares outstanding (equity raised
//     belongs to the new holders, not the founder). The statement's own figure is printed beside it.

import { applyCredits } from "../../server/finances.js";
import { getAccountById, getStatements, mutateAccountState } from "../../server/gameState.js";
import { computeCreditRating } from "../../server/creditRating.js";
import { acceptLoan, loanOffers, quoteLoan } from "../../server/loans.js";
import { loanServicingTick } from "../../server/loanServicing.js";
import { BOND_TERMS, bondEligibility, bondSeriesList, bondWindowTick, bondsIssuedBy, issueBond, previewBond } from "../../server/bonds.js";
import { bondServicingTick } from "../../server/bondServicing.js";
import { companyValue, founderFloorRoom, listCorporation, listingProblem, openOffering, outstandingOf, shareOfferingList, shareOfferingTick } from "../../server/shareOfferings.js";
import { dividendTick, setPayoutRatio } from "../../server/dividends.js";
import { ledgerEntries } from "../../server/settlement.js";
import { SHARE_TERMS } from "../../server/shareRegistry.js";
import { capitalValue, plannerCoupon } from "./bondPlanner.js";
import { plannerPayoutRatio } from "./equityPlanner.js";

export const DAY = 86_400_000;
export const POLICIES = ["no-borrow", "max-borrow", "planner"];

/**
 * The spread of corporations each policy is played on: starting capital K0 against the capital's half-life H, at a low
 * and a high return. Capital-hungry ones (K0 well under H) have a marginal return above the bank's rates; saturated ones
 * do not, so borrowing should not pay for them.
 */
export const PROFILES = [100_000, 300_000].flatMap((K0) => [150_000, 400_000].flatMap((H) => [12, 24].map((r) => ({
  name: `K0 ${K0 / 1000}k, H ${H / 1000}k, ${r}%`, K0, capital: { returnPct30: r, halfLifeCredits: H }
}))));

const OPEX_SHARE = 0.35; // the day's fixed operating cost, as a share of the day's income at the starting capital
const START_CREDITS = 60_000;
const LEVEL = 15; // a mid-game corporation: bonds need 10, listing 15

const dailyIncome = (K, capital) => capitalValue(K, 1, capital);
const marginalPct30 = (K, { returnPct30, halfLifeCredits }) => returnPct30 * 0.5 ** (K / halfLifeCredits);
const corpOf = (id) => getAccountById(id).state.corp;
const statementsOf = (id, now) => getStatements(id, 30, now)?.statements ?? [];

/** Book a movement the way the server books one: applyCredits, on the day it happens. */
function book(id, delta, category, now, extra = () => {}) {
  mutateAccountState(id, (state) => { applyCredits(state.corp, delta, category, now); extra(state.corp); }, { sanitize: false, settleMining: false });
}

/** Put `credits` into capital: construction, as a building is booked, and the facilities it buys. */
function invest(bot, credits, now) {
  const amount = Math.min(Math.floor(credits), Math.max(0, Math.round(corpOf(bot.id).finances.credits)));
  if (amount <= 0) return 0;
  book(bot.id, -amount, "construction", now, (c) => { c.finances.assets = Math.round(Number(c.finances.assets) || 0) + amount; });
  bot.K += amount;
  return amount;
}

/** A day of operations: the capital's income, then the fixed cost. */
function operate(bot, now) {
  book(bot.id, Math.round(dailyIncome(bot.K, bot.capital)), "exchange", now);
  book(bot.id, -bot.opex, "mining-ops", now);
}

/** Debt the statement leaves out (Bug AB#4647): loans borrowed (balance and arrears) and bond face outstanding. */
export function debtOf(id) {
  const loans = (corpOf(id).loans || []).filter((l) => l.state !== "repaid" && l.state !== "closed")
    .reduce((a, l) => a + (Number(l.balance) || 0) + (Number(l.arrears) || 0), 0);
  const bonds = bondsIssuedBy(id).reduce((a, s) => a + (Number(s.outstandingFace) || 0), 0);
  return Math.round(loans + bonds);
}

/** { statement, economic, founder }: the latest closed statement's net worth, less the debt, times the founder's share. */
export function netWorthOf(id, now) {
  const statement = companyValue(statementsOf(id, now));
  const r = corpOf(id).shareRegistry;
  const founderShare = r ? r.founderShares / outstandingOf(r) : 1;
  const economic = statement - debtOf(id);
  return { statement, economic, founder: Math.round(economic * founderShare) };
}

// ─── The policies ──────────────────────────────────────────────────────────────

/** Borrow `principal` on `productId` and put it to work. Returns the loan's terms, or null when the bank refuses. */
function borrow(bot, productId, principal, now) {
  const q = quoteLoan(bot.id, { productId, principal }, now);
  if (!q.ok) return null;
  const a = acceptLoan(bot.id, { quoteId: q.quote.id }, now);
  if (!a.ok) return null;
  invest(bot, principal, now);
  bot.borrowed += principal;
  return q.quote;
}

const openNpcLoans = (id) => (corpOf(id).loans || []).filter((l) => l.lender?.kind === "npc" && (l.state === "active" || l.state === "arrears"));

/** Max-borrow: on every product it has no loan on, the most the bank will lend, halving until the grade allows it. */
function maxBorrow(bot, now) {
  const offers = loanOffers(bot.id, now);
  for (const p of [...(offers?.products || [])].sort((a, b) => b.termDays - a.termDays)) {
    if (!p.available || openNpcLoans(bot.id).some((l) => l.lender.productId === p.id)) continue;
    for (let principal = p.maxPrincipal; principal >= offers.minPrincipal; principal = Math.floor(principal / 2)) {
      if (borrow(bot, p.id, principal, now)) break;
    }
  }
}

/**
 * The planner's loan (section 8): with no bank loan open, each product at a quarter, half, three quarters and all of
 * what is offered; the one whose extra earnings over its term beat its interest and fee by most, and whose daily
 * payment the corporation's own cash flow covers ("the shortest term the cash flow can service"). None, if none nets.
 */
function plannerLoan(bot, now) {
  if (openNpcLoans(bot.id).length) return;
  const offers = loanOffers(bot.id, now);
  let best = null;
  for (const p of offers?.products || []) {
    if (!p.available) continue;
    for (const f of [0.25, 0.5, 0.75, 1]) {
      const principal = Math.floor(p.maxPrincipal * f);
      if (principal < offers.minPrincipal) continue;
      const q = quoteLoan(bot.id, { productId: p.id, principal }, now);
      if (!q.ok) continue;
      const t = q.quote;
      const gain = capitalValue(bot.K + principal, t.termDays, bot.capital) - capitalValue(bot.K, t.termDays, bot.capital);
      const net = gain - t.totalInterest - t.originationFee;
      const cashFlow = dailyIncome(bot.K + principal, bot.capital) - bot.opex;
      if (net > 0 && t.dailyPayment <= cashFlow && (!best || net > best.net)) best = { productId: p.id, principal, net };
    }
  }
  if (best && borrow(bot, best.productId, best.principal, now)) bot.choices.loans.push({ productId: best.productId, principal: best.principal });
}

/** The planner's bond (debt section 8, bondPlanner.js): once, at the coupon that nets most at its marginal return. */
function plannerBond(bot, now, choices) {
  if (bot.bondDecided || !bondEligibility(bot.id, now).eligible) return;
  bot.bondDecided = true;
  const grade = computeCreditRating(corpOf(bot.id), now, statementsOf(bot.id, now), { bonds: bondsIssuedBy(bot.id) }).grade;
  const quantity = Math.min(BOND_TERMS.maxQuantity, Math.max(BOND_TERMS.minQuantity, Math.round(bot.K0 / 4 / BOND_TERMS.faceValue)));
  const coupon = plannerCoupon({ grade, quantity, maturityDays: 60, capital: { returnPct30: marginalPct30(bot.K, bot.capital), halfLifeCredits: bot.capital.halfLifeCredits } });
  choices.coupons.push({ profile: bot.profile, grade, couponPct30: coupon, impliedYieldPct30: BOND_TERMS.impliedYieldPct30[grade] ?? null });
  if (coupon === null || !previewBond(bot.id, { quantity, couponPct30: coupon, maturityDays: 60 }, now).ok) return;
  const r = issueBond(bot.id, { quantity, couponPct30: coupon, maturityDays: 60, windowHours: BOND_TERMS.windowHours[0] }, now);
  if (r.ok) bot.pending.push({ kind: "bond", id: r.series.id });
}

/** The planner's shares (equity section 6, equityPlanner.js): list when it may, then one offering at its best ratio. */
function plannerShares(bot, now, choices) {
  const r = corpOf(bot.id).shareRegistry;
  if (r.state !== "listed") {
    if (!listingProblem(bot.id, now)) listCorporation(bot.id, now);
    return;
  }
  if (bot.offered) return;
  bot.offered = true;
  const statements = statementsOf(bot.id, now);
  const income30 = statements.reduce((a, s) => a + (Number(s.pnl?.net) || 0), 0);
  const value = companyValue(statements);
  const outstanding = outstandingOf(r);
  const offerShares = Math.max(0, Math.min(Math.floor(outstanding * 0.2), founderFloorRoom(r), r.unissued));
  const grade = computeCreditRating(corpOf(bot.id), now, statements, { bonds: bondsIssuedBy(bot.id) }).grade;
  const m = marginalPct30(bot.K, bot.capital);
  const ratio = plannerPayoutRatio({ income30, value, outstanding, offerShares, grade, capital: { tranche: bot.capital.halfLifeCredits, firstPct: 2 * m, restPct: m } });
  choices.ratios.push({ profile: bot.profile, grade, payoutRatioPct: ratio });
  if (ratio !== r.payoutRatioPct) setPayoutRatio(bot.id, ratio, now);
  const o = openOffering(bot.id, { quantity: offerShares }, now);
  if (o.ok) bot.pending.push({ kind: "offering", id: o.offering.id });
}

/** Capital a closed bond window or offering raised, put to work. */
function collectRaised(bot, now) {
  bot.pending = bot.pending.filter((p) => {
    if (p.kind === "bond") {
      const s = bondSeriesList().find((x) => x.id === p.id);
      if (!s || s.state === "subscribing") return true;
      bot.raised += invest(bot, s.sold * s.faceValue, now);
      return false;
    }
    const o = shareOfferingList().find((x) => x.id === p.id);
    if (!o || o.state === "open") return true;
    bot.raised += invest(bot, o.proceeds - (o.feePaid || 0), now);
    return false;
  });
}

/** Every server tick that moves money on a day, at `now`. */
function ticks(now) {
  loanServicingTick(now);
  bondWindowTick(now);
  bondServicingTick(now);
  shareOfferingTick(now);
  dividendTick(now);
}

// ─── The run ───────────────────────────────────────────────────────────────────

/**
 * Play the profile. `newCorporation()` makes an account through the server and returns its id; `setTime(t)` moves the
 * clock every server module reads. Warm-up days are operations only, so each corporation has the 30 closed statements a
 * grade and a listing need before the measured days start. Returns the report (formatReport prints it).
 */
export async function runMarketsProbe({ newCorporation, setTime, start, profiles = PROFILES, warmupDays = 30, days = 30 }) {
  setTime(start);
  const bots = [];
  for (const profile of profiles) {
    for (const policy of POLICIES) {
      const id = await newCorporation();
      const opex = Math.round(dailyIncome(profile.K0, profile.capital) * OPEX_SHARE);
      mutateAccountState(id, (s) => { s.corp.level = LEVEL; s.corp.finances.credits = START_CREDITS; s.corp.finances.assets = profile.K0; }, { sanitize: false, settleMining: false });
      bots.push({ id, policy, profile: profile.name, capital: profile.capital, K0: profile.K0, K: profile.K0, opex, borrowed: 0, raised: 0, pending: [], choices: { loans: [] } });
    }
  }
  const choices = { coupons: [], ratios: [] };
  const noon = (d) => start + d * DAY + 3 * 3_600_000;
  for (let d = 0; d < warmupDays; d++) {
    setTime(noon(d));
    for (const bot of bots) operate(bot, noon(d));
  }
  const measureStart = start + warmupDays * DAY;
  setTime(measureStart + 3_600_000);
  for (const bot of bots) bot.nw0 = netWorthOf(bot.id, measureStart + 3_600_000);

  let botDays = 0;
  for (let d = warmupDays; d < warmupDays + days; d++) {
    const morning = start + d * DAY + 3_600_000;
    setTime(morning);
    for (const bot of bots) {
      collectRaised(bot, morning);
      if (bot.policy === "max-borrow") maxBorrow(bot, morning);
      if (bot.policy === "planner") { plannerLoan(bot, morning); plannerBond(bot, morning, choices); plannerShares(bot, morning, choices); }
    }
    setTime(noon(d));
    for (const bot of bots) { operate(bot, noon(d)); botDays++; }
    ticks(noon(d));
  }
  const end = start + (warmupDays + days) * DAY + 3_600_000;
  setTime(end);
  for (const bot of bots) bot.nw30 = netWorthOf(bot.id, end);

  return { config: { profiles: profiles.length, warmupDays, days, opexShare: OPEX_SHARE, startCredits: START_CREDITS }, botDays, bots, choices, flows: flowsSince(measureStart), profileNames: profiles.map((p) => p.name) };
}

/** What the ledger moved from `since`: the bank's principal against its interest and fees, and the other taps. */
export function flowsSince(since) {
  const e = ledgerEntries().filter((x) => x.at >= since);
  const sum = (f) => e.filter(f).reduce((a, x) => a + x.credits, 0);
  const loanKey = (x) => typeof x.key === "string" && (x.key.startsWith("loan:") || x.key.startsWith("loan-fee:") || x.key.startsWith("loan-payoff"));
  return {
    npcPrincipalCreated: sum((x) => x.from === "tap:dsdb" && x.reason === "loan-disbursal"),
    npcPrincipalRepaid: sum((x) => x.to === "tap:dsdb" && x.reason === "loan-repayment"),
    npcInterest: sum((x) => x.to === "sink:loan-interest" && loanKey(x)),
    npcFees: sum((x) => x.to === "sink:fee" && loanKey(x)),
    underwriterCreated: sum((x) => x.from === "tap:dsdb" && x.reason !== "loan-disbursal"),
    marketMakerPaid: sum((x) => x.from === "tap:igsx"),
    marketMakerBack: sum((x) => x.to === "tap:igsx"),
    otherFees: sum((x) => x.to === "sink:fee" && !loanKey(x)),
    allTaps: sum((x) => typeof x.from === "string" && x.from.startsWith("tap:"))
  };
}

// ─── The report ────────────────────────────────────────────────────────────────

const pct = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : 0);
const n = (x) => Math.round(x).toLocaleString("en-US");

/** The targets AB#856 names, each PASS or FAIL with its numbers. Never softened here: a FAIL is reported. */
export function targets(report) {
  const byProfile = report.profileNames.map((name) => {
    const at = (policy) => report.bots.find((b) => b.profile === name && b.policy === policy).nw30.founder;
    return { name, planner: at("planner"), none: at("no-borrow"), max: at("max-borrow") };
  });
  const beats = byProfile.filter((p) => pct(p.planner, p.none) >= 10 && pct(p.planner, p.max) >= 10).length;
  const f = report.flows;
  const sinkPct = f.npcPrincipalCreated ? ((f.npcInterest + f.npcFees) / f.npcPrincipalCreated) * 100 : null;
  const mmNet = f.marketMakerPaid - f.marketMakerBack;
  return [
    { target: "planner-borrow beats no-borrow and max-borrow by >= 10% net worth at day 30 (T-018)", result: beats === byProfile.length ? "PASS" : "FAIL", detail: `${beats} of ${byProfile.length} profiles` },
    { target: "interest + fees destroy >= 5% (and <= 10%) of NPC principal created (debt section 9)", result: sinkPct === null ? "NO LOANS" : sinkPct >= 5 && sinkPct <= 10 ? "PASS" : "FAIL", detail: sinkPct === null ? "no NPC principal created" : `${sinkPct.toFixed(2)}%: ${n(f.npcInterest + f.npcFees)} of ${n(f.npcPrincipalCreated)}` },
    { target: "market maker's net creation <= 10% of all credits created (equity section 7)", result: f.allTaps ? (mmNet <= 0.1 * f.allTaps ? "PASS" : "FAIL") : "NO TAPS", detail: `${n(mmNet)} of ${n(f.allTaps)} tapped by the bank, underwriter and market maker (operations income not counted)` }
  ];
}

/** The report as text, headed with what it is (P-PROXY). */
export function formatReport(report) {
  const lines = [];
  lines.push("ISP financial-markets probe (ISP-162, AB#856). BOT NUMBERS (P-PROXY): bots on the design's assumed business, not players.");
  lines.push(`${report.config.profiles} profiles x ${POLICIES.length} policies, ${report.config.warmupDays} warm-up days, ${report.config.days} measured days: ${report.botDays} bot days.`);
  lines.push("");
  lines.push("Net worth at the last measured day (founder's share, debt counted; the statement's own figure in brackets, Bug AB#4647):");
  for (const name of report.profileNames) {
    const row = POLICIES.map((policy) => {
      const b = report.bots.find((x) => x.profile === name && x.policy === policy);
      return `${policy} ${n(b.nw30.founder)} [${n(b.nw30.statement)}]${b.borrowed ? `, borrowed ${n(b.borrowed)}` : ""}${b.raised ? `, raised ${n(b.raised)}` : ""}`;
    });
    const at = (p) => report.bots.find((x) => x.profile === name && x.policy === p).nw30.founder;
    lines.push(`  ${name}: ${row.join(" | ")} -> planner vs no-borrow ${pct(at("planner"), at("no-borrow")).toFixed(1)}%, vs max-borrow ${pct(at("planner"), at("max-borrow")).toFixed(1)}%`);
  }
  lines.push("");
  const loans = report.bots.filter((b) => b.policy === "planner").flatMap((b) => b.choices.loans.map((l) => `${l.productId} ${n(l.principal)}`));
  lines.push(`Planner loans: ${loans.length ? loans.join(", ") : "none"}`);
  const coupons = report.choices.coupons;
  lines.push(`Planner coupons (% per 30 days, grade and its implied yield): ${coupons.length ? coupons.map((c) => c.couponPct30 === null ? `declined (${c.grade})` : `${c.couponPct30} (${c.grade} ${c.impliedYieldPct30})`).join(", ") : "no planner could issue"}`);
  const issued = coupons.filter((c) => c.couponPct30 !== null);
  lines.push(`  interior (strictly inside ${BOND_TERMS.minCouponPct30} to ${BOND_TERMS.maxCouponPct30}): ${issued.filter((c) => c.couponPct30 > BOND_TERMS.minCouponPct30 && c.couponPct30 < BOND_TERMS.maxCouponPct30).length} of ${issued.length} issued`);
  const ratios = report.choices.ratios;
  lines.push(`Planner payout ratios: ${ratios.length ? ratios.map((r) => `${r.payoutRatioPct}% (${r.grade})`).join(", ") : "no planner listed"}`);
  const b = SHARE_TERMS.payoutRatioPct;
  lines.push(`  interior (strictly inside ${b.min} to ${b.max}%): ${ratios.filter((r) => r.payoutRatioPct > b.min && r.payoutRatioPct < b.max).length} of ${ratios.length}; ISP-159 asks for 80% of runs`);
  lines.push("");
  const f = report.flows;
  lines.push(`Bank: NPC principal created ${n(f.npcPrincipalCreated)}, repaid ${n(f.npcPrincipalRepaid)}; destroyed by interest ${n(f.npcInterest)} and fees ${n(f.npcFees)}.`);
  lines.push(`Underwriter bought ${n(f.underwriterCreated)} of bonds; market maker paid ${n(f.marketMakerPaid)}, took back ${n(f.marketMakerBack)}; other fees ${n(f.otherFees)}.`);
  lines.push("");
  for (const t of targets(report)) lines.push(`${t.result.padEnd(8)} ${t.target}: ${t.detail}`);
  return lines.join("\n");
}
