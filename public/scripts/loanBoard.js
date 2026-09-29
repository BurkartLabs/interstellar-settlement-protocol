// ISP-153 (AB#847): the loan board, as HTML. Pure: no DOM and no requests, so node tests read it; views/loanBoard.js
// fetches, binds and draws what this returns. It sits in the Deep Space Development Bank, beside the Bank's own loans.
//
// Every figure is the server's (GET /loan-offers, GET /player-loans). A lender sees each borrower's grade next to the
// loan, because a lender who cannot see the grade cannot price the risk, which is the point of the rating. Every name
// and number goes through escapeHtml or cr.

import { escapeHtml, refHtml } from "./html.js";
import { cr, bankTime } from "./devBank.js";
import { protocolLineHtml } from "./protocol.js"; // ISP-255 (AB#4824)

/** The grades, best first; an offer's minimum may also be NR-accepted (it lends to unrated corporations). */
export const GRADE_ORDER = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "CC", "C"];

/** Whether a corporation at `grade` may take an offer asking for `minGrade`. Mirrors the server (playerLoans.js). */
export function canTake(offer, grade) {
  if (!grade || grade === "D") return false;
  if (offer.minGrade === "NR-accepted") return true;
  if (grade === "NR") return false;
  return GRADE_ORDER.indexOf(grade) <= GRADE_ORDER.indexOf(offer.minGrade);
}

const gradeRank = (g) => (g === "NR-accepted" ? GRADE_ORDER.length : GRADE_ORDER.indexOf(g));
/** The offers in the order the board is set to: by rate, either way, or by minimum grade (easiest to take first). */
export function sortOffers(offers, sort) {
  const list = [...(offers || [])];
  if (sort === "rate-desc") return list.sort((a, b) => b.ratePct30 - a.ratePct30 || b.principal - a.principal);
  if (sort === "grade") return list.sort((a, b) => gradeRank(b.minGrade) - gradeRank(a.minGrade) || a.ratePct30 - b.ratePct30);
  return list.sort((a, b) => a.ratePct30 - b.ratePct30 || b.principal - a.principal); // rate-asc, the default
}

const gradeLabel = (g) => (g === "NR-accepted" ? "Unrated welcome" : `${g} or better`);

function offerCard(o, grade) {
  const takeable = !o.mine && canTake(o, grade);
  const action = o.mine
    ? `<button type="button" class="ui-button ui-button--secondary" data-role="loan-offer-cancel" data-offer="${escapeHtml(o.id)}">Withdraw your offer</button>`
    : takeable
      ? `<button type="button" class="ui-button ui-button--primary" data-role="loan-offer-accept" data-offer="${escapeHtml(o.id)}">Borrow ${cr(o.principal)} credits</button>`
      : `<p class="station__note loan-offer__why">Needs a grade of ${escapeHtml(o.minGrade)}; yours is ${escapeHtml(grade || "NR")}.</p>`;
  return `
    <article class="bank-loan loan-offer${o.mine ? " loan-offer--mine" : ""}" data-offer-card="${escapeHtml(o.id)}">
      <header class="bank-loan__header">
        <h4>${cr(o.principal)} credits · ${escapeHtml(String(o.ratePct30))}% per 30 days</h4>
        <span class="ui-badge">${escapeHtml(gradeLabel(o.minGrade))}</span>
      </header>
      <dl class="bank-loan__terms">
        <div><dt>Lender</dt><dd>${o.mine ? "You" : escapeHtml(o.lenderName)}</dd></div>
        <div><dt>Term</dt><dd>${cr(o.termDays)} days</dd></div>
        <div><dt>Daily payment</dt><dd>${cr(o.dailyPayment)} credits</dd></div>
        <div><dt>Total repaid</dt><dd>${cr(o.totalRepaid)} credits</dd></div>
      </dl>
      ${action}
    </article>`;
}

/** The board: its controls, then the offers as set, then the empty state that says what to do. */
export function loanBoardHtml({ offers, grade, sort = "rate-asc", onlyMine = false, error } = {}) {
  if (error) return `<p class="station__note">The loan board could not be read: ${escapeHtml(error)}</p>`;
  if (!offers) return `<p class="station__note">Reading the loan board…</p>`;
  const shown = sortOffers(offers.filter((o) => !onlyMine || o.mine || canTake(o, grade)), sort);
  const controls = `
    <form class="loan-board__controls" data-role="loan-board-controls">
      <label class="bank-quote-form__field">Order by
        <select class="ui-input" name="sort" data-role="loan-board-sort">
          <option value="rate-asc"${sort === "rate-asc" ? " selected" : ""}>Rate, lowest first</option>
          <option value="rate-desc"${sort === "rate-desc" ? " selected" : ""}>Rate, highest first</option>
          <option value="grade"${sort === "grade" ? " selected" : ""}>Minimum grade, easiest first</option>
        </select>
      </label>
      <label class="loan-board__only"><input type="checkbox" name="onlyMine" data-role="loan-board-only"${onlyMine ? " checked" : ""}> Only offers my grade can take</label>
    </form>
    <p class="bank-grade">Your credit grade: <strong>${escapeHtml(grade || "NR")}</strong>. ${offers.length} open offer${offers.length === 1 ? "" : "s"} on the board.</p>`;
  if (!offers.length) return `${controls}<p class="station__note" data-role="loan-board-empty">No open offers yet. Post one below to lend to other corporations.</p>`;
  if (!shown.length) return `${controls}<p class="station__note" data-role="loan-board-empty">No offers match your grade. Clear the filter to see them all, or post an offer of your own.</p>`;
  return `${controls}<div class="loan-board__offers">${shown.map((o) => offerCard(o, grade)).join("")}</div>`;
}

/** The post-an-offer form. What will be held in escrow is shown on the form and again before it is confirmed. */
export function postOfferFormHtml(rules, minGrades, form = {}) {
  if (!rules) return "";
  const rates = [];
  for (let r = rules.minRatePct30; r <= rules.maxRatePct30 + 1e-9; r += rules.rateStep) rates.push(Math.round(r * 100) / 100);
  const principal = form.principal ?? 10_000;
  const rate = form.ratePct30 ?? 3;
  return `
    <form class="bank-quote-form" data-role="loan-post-form">
      <label class="bank-quote-form__field">Principal (credits)
        <input class="ui-input" type="number" name="principal" min="${rules.minPrincipal}" max="${rules.maxPrincipal}" step="1000" value="${escapeHtml(String(principal))}" required>
      </label>
      <label class="bank-quote-form__field">Rate per 30 days
        <select class="ui-input" name="ratePct30">${rates.map((r) => `<option value="${r}"${r === rate ? " selected" : ""}>${r.toFixed(2)}%</option>`).join("")}</select>
      </label>
      <label class="bank-quote-form__field">Term
        <select class="ui-input" name="termDays">${rules.terms.map((t) => `<option value="${t}"${t === (form.termDays ?? 30) ? " selected" : ""}>${t} days</option>`).join("")}</select>
      </label>
      <label class="bank-quote-form__field">Lend to grades
        <select class="ui-input" name="minGrade">${(minGrades || []).map((g) => `<option value="${escapeHtml(g)}"${g === (form.minGrade ?? "BBB") ? " selected" : ""}>${escapeHtml(gradeLabel(g))}</option>`).join("")}</select>
      </label>
      <button type="submit" class="ui-button ui-button--primary">Post offer</button>
      <p class="bank-quote-form__status" data-role="loan-post-status"></p>
    </form>
    <p class="station__note">Posting holds the principal in escrow until a corporation borrows it, you withdraw the offer, or it expires after ${cr(rules.expiryDays)} days. Rates start at ${escapeHtml(String(rules.minRatePct30))}%, and two corporations may lend each other at most ${cr(rules.pairCapPrincipal)} credits in ${cr(rules.pairCapDays)} days.</p>`;
}

const STATE_BADGE = {
  active: ["Current", "bank-loan__badge--ok"], arrears: ["In arrears", ""], repaid: ["Repaid", "bank-loan__badge--ok"]
};
function stateBadge(loan) {
  // ISP-255 (AB#4824): the phrase after the badge; "In arrears" is already the guide's words
  const line = (meaning) => ` ${protocolLineHtml({ meaning, screen: "loans-board" })}`;
  if (loan.defaultedAt && loan.state === "arrears") return `<span><span class="ui-badge bank-loan__badge" data-role="loan-state">In default</span>${line("failed")}</span>`; // one span: the header is a flex row
  const [label, extra] = STATE_BADGE[loan.state] || [loan.state, ""];
  const meaning = { active: "active", repaid: "complete" }[loan.state];
  const badge = `<span class="ui-badge bank-loan__badge ${extra}" data-role="loan-state">${escapeHtml(label)}</span>`;
  return meaning ? `<span>${badge}${line(meaning)}</span>` : badge;
}

/** What recovery took, grouped by where it came from: credits, goods sold, buildings force-sold. */
/**
 * What recovery took, and from what, as it went to the debt: from credits, from goods sold at the exchange, and from
 * buildings force-sold (with what each sold for: a sale's surplus stays with the borrower, so its price is not what the
 * lender received). A record from before `applied` was kept falls back to the sale prices alone.
 */
export function recoveredFromText(result) {
  if (!result) return "";
  const sold = result.sold || [];
  const goodsNames = sold.filter((s) => s.kind === "inventory").map((s) => s.name).join(", ");
  const assets = sold.filter((s) => s.kind === "building" || s.kind === "lease");
  const assetList = assets.map((a) => `${escapeHtml(a.name)} for ${cr(a.credits)}`).join(", ");
  const parts = [];
  const a = result.applied;
  if (a) {
    if (a.fromCredits > 0) parts.push(`${cr(a.fromCredits)} from credits`);
    if (a.fromGoods > 0) parts.push(`${cr(a.fromGoods)} from goods sold at the exchange (${escapeHtml(goodsNames)})`);
    if (a.fromHoldings > 0) parts.push(`${cr(a.fromHoldings)} from holdings sold (${escapeHtml(sold.filter((x) => x.kind === "bond" || x.kind === "shares").map((x) => x.name).join(", "))})`); // bonds (Bug #2574) and shares (AB#854)
    if (a.fromAssets > 0) parts.push(`${cr(a.fromAssets)} from force-sold assets (${assetList}; what they raised beyond the debt stayed with the borrower)`);
  } else {
    if (goodsNames) parts.push(`goods sold at the exchange (${escapeHtml(goodsNames)})`);
    if (assetList) parts.push(`force-sold ${assetList}`);
  }
  const head = `${cr(result.collected || 0)} credits recovered`;
  return `${head}${parts.length ? `: ${parts.join("; ")}` : ""}.${result.shortfall ? ` ${cr(result.shortfall)} could not be recovered yet and is collected as credits allow.` : ""}`;
}

function recoveryRow(loan, side) {
  const r = loan.recovery;
  if (!r) return "";
  if (r.state === "grace") {
    return side === "borrower"
      ? `<div class="loan-warning" data-role="loan-warning" role="alert"><strong>Your assets will be sold on ${escapeHtml(bankTime(r.saleAt))}.</strong> ${protocolLineHtml({ meaning: "pending", screen: "loans-board" })} Pay the ${cr(loan.arrears)} credits in arrears before then and nothing is sold. Until then you cannot sell, buy or lend to other corporations. Your office, research, level and Headquarters are never taken.</div>`
      : `<div><dt>Recovery</dt><dd>Begins ${escapeHtml(bankTime(r.saleAt))} unless the arrears are paid ${protocolLineHtml({ meaning: "pending", screen: "loans-board" })}</dd></div>`;
  }
  if (r.state === "done" && r.result) {
    return side === "borrower"
      ? `<div class="loan-warning" data-role="loan-recovered">Recovered from you on ${escapeHtml(bankTime(r.closedAt))}: ${recoveredFromText(r.result)}</div>`
      : `<div class="loan-recovered" data-role="loan-recovered"><dt>Recovered</dt><dd>${recoveredFromText(r.result)}</dd></div>`;
  }
  if (r.state === "cancelled") return side === "borrower" ? "" : `<div><dt>Recovery</dt><dd>Cancelled: the arrears were paid in time ${protocolLineHtml({ meaning: "cancelled", screen: "loans-board" })}</dd></div>`;
  return "";
}

function loanCard(loan, side) {
  const late = loan.state === "arrears";
  const who = side === "lender"
    ? `<div><dt>Borrower</dt><dd>${escapeHtml(loan.borrowerName)} <span class="ui-badge loan-grade" data-role="borrower-grade">${escapeHtml(loan.borrowerGrade || "NR")}</span></dd></div>`
    : `<div><dt>Lender</dt><dd>${escapeHtml(loan.lenderName)}</dd></div>`;
  const recovery = recoveryRow(loan, side);
  const isBlock = recovery.startsWith("<div class=\"loan-warning\"");
  return `
    <article class="bank-loan${late ? " bank-loan--arrears" : ""}" data-player-loan="${escapeHtml(loan.id)}">
      <header class="bank-loan__header">
        <h4>${cr(loan.principal)} credits · ${escapeHtml(String(loan.ratePct30))}% per 30 days ${refHtml(loan.ref)}</h4>
        ${stateBadge(loan)}
      </header>
      <dl class="bank-loan__terms">
        ${who}
        <div><dt>Still owed</dt><dd>${cr(loan.balance)} credits</dd></div>
        <div><dt>Payments</dt><dd>${cr(loan.paymentsMade)} of ${cr(loan.termDays)}, ${cr(loan.dailyPayment)} a day</dd></div>
        ${late ? `<div><dt>Arrears</dt><dd class="bank-loan__arrears">${cr(loan.arrears)} credits since ${escapeHtml(bankTime(loan.arrearsSince))}</dd></div>` : ""}
        ${isBlock ? "" : recovery}
      </dl>
      ${isBlock ? recovery : ""}
    </article>`;
}

/** The loans this corporation has made, each with its borrower's grade and any recovery. */
export function lentLoansHtml(lent) {
  const list = Array.isArray(lent) ? lent : [];
  if (!list.length) return `<p class="station__note">You have not lent to anyone. Post an offer above; when a corporation borrows it, the loan appears here with its borrower's grade.</p>`;
  return list.map((l) => loanCard(l, "lender")).join("");
}

/** The loans this corporation owes other corporations, with any warning before its assets are sold. */
export function borrowedLoansHtml(borrowed) {
  const list = Array.isArray(borrowed) ? borrowed : [];
  if (!list.length) return `<p class="station__note">You owe no other corporation. Borrow from an offer on the board above.</p>`;
  return list.map((l) => loanCard(l, "borrower")).join("");
}
