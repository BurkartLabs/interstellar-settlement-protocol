// ISP-151 (AB#845): the Deep Space Development Bank's view, as HTML. Pure: no DOM and no requests, so node tests read
// it. views/developmentBank.js fetches, binds and draws what this returns.
//
// Every figure here is the server's (GET /loans/offers, POST /loans/quote, corp.loans): nothing is priced in the page.
// The quote shows the whole cost of the loan before anything is committed, so borrowing never looks free.

import { escapeHtml } from "./html.js";

export const cr = (n) => `${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
const DAY = 86_400_000;

/** A time as the Bank's ledgers write it: "28 Sep, 14:05 UTC". Fixed names, so every browser and test agrees. */
export function bankTime(t) {
  const d = new Date(t);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${month}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** What paying a loan off takes now: the principal still owed, the arrears, and 1% of that principal (AB#844). */
export function payoffTotal(loan) {
  const balance = Math.round(Number(loan?.balance) || 0);
  return balance + Math.round(Number(loan?.arrears) || 0) + Math.round(balance / 100);
}

const facilityName = (termDays) => `${termDays}-day facility`;

/** The products, each with this corporation's limit on it, and the form that asks for a quote. */
export function bankOffersHtml(offers, { productId, principal } = {}) {
  if (!offers) return `<p class="station__note">Reading the Bank's terms…</p>`;
  const usable = offers.products.filter((p) => p.available);
  const chosen = usable.find((p) => p.id === productId) ?? usable[0] ?? null;
  const cards = offers.products.map((p) => `
    <article class="bank-product${p.available ? "" : " bank-product--closed"}" data-product="${escapeHtml(p.id)}">
      <h4 class="bank-product__name">${escapeHtml(facilityName(p.termDays))}</h4>
      <p class="bank-product__rate">from ${escapeHtml(String(p.baseRatePct30))}% per 30 days</p>
      <p class="bank-product__limit">${p.available ? `Up to ${cr(p.maxPrincipal)} credits` : escapeHtml(p.why || "Not open to you")}</p>
    </article>`).join("");
  const form = chosen ? `
    <form class="bank-quote-form" data-role="bank-quote-form" novalidate>
      <label class="bank-quote-form__field">Facility
        <select class="ui-select" name="productId" data-role="bank-product">${usable.map((p) => `<option value="${escapeHtml(p.id)}"${p.id === chosen.id ? " selected" : ""}>${escapeHtml(facilityName(p.termDays))}, up to ${cr(p.maxPrincipal)}</option>`).join("")}</select>
      </label>
      <label class="bank-quote-form__field">Principal
        <input class="ui-input" name="principal" type="number" inputmode="numeric" min="${offers.minPrincipal}" step="1000" value="${escapeHtml(String(principal ?? Math.min(chosen.maxPrincipal, 50_000)))}" data-role="bank-principal">
      </label>
      <button type="submit" class="ui-button ui-button--primary">Request a quote</button>
      <p class="bank-quote-form__status" data-role="bank-quote-status" aria-live="polite"></p>
    </form>` : `<p class="station__note">The Bank has no facility open to your corporation at present.</p>`;
  return `
    <p class="bank-grade">Your corporation is graded <strong>${escapeHtml(offers.grade)}</strong> by the Bank's credit desk. The rate follows the grade your corporation would have after the loan.</p>
    <div class="bank-products">${cards}</div>
    ${form}`;
}

/** An open quote: everything the loan costs, and when it expires, before the player commits. */
export function bankQuoteHtml(quote, now = Date.now()) {
  if (!quote) return "";
  const minutes = Math.max(0, Math.ceil((quote.expiresAt - now) / 60_000));
  const rows = [
    ["Principal", `${cr(quote.principal)} credits`],
    ["Rate", `${quote.ratePct30}% per 30 days (grade ${escapeHtml(quote.gradeAfter)} after the loan)`],
    ["Term", `${quote.termDays} days`],
    ["Daily payment", `${cr(quote.dailyPayment)} credits × ${quote.payments}${quote.lastPayment !== quote.dailyPayment ? ` (last ${cr(quote.lastPayment)})` : ""}`],
    ["Total repayable", `${cr(quote.totalRepaid)} credits`],
    ["Interest", `${cr(quote.totalInterest)} credits`],
    ["Origination fee", `${cr(quote.originationFee)} credits, taken at disbursal`],
    ["You receive", `${cr(quote.principal - quote.originationFee)} credits`]
  ];
  return `
    <section class="bank-quote" data-role="bank-quote" aria-label="Loan quote">
      <header class="bank-quote__header"><h4>Quote ${escapeHtml(facilityName(quote.termDays))}</h4><span class="bank-quote__expiry">${minutes > 0 ? `holds for ${minutes} min` : "expired"}</span></header>
      <dl class="bank-quote__terms">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd data-term="${escapeHtml(k)}">${v}</dd></div>`).join("")}</dl>
      <div class="bank-quote__actions">
        <button type="button" class="ui-button ui-button--primary" data-role="bank-accept"${minutes > 0 ? "" : " disabled"}>Accept and borrow</button>
        <button type="button" class="ui-button ui-button--secondary" data-role="bank-discard">Discard</button>
      </div>
    </section>`;
}

/** The corporation's loans: open ones with balance, next payment, arrears and payoff; the last few closed ones. */
export function bankLoansHtml(loans, now = Date.now()) {
  const list = Array.isArray(loans) ? loans : [];
  const open = list.filter((l) => l.state === "active" || l.state === "arrears");
  const closed = list.filter((l) => l.state === "repaid").slice(-3).reverse();
  if (!open.length && !closed.length) return `<p class="station__note">No facilities with the Bank.</p>`;
  const card = (l) => {
    const late = l.state === "arrears";
    const next = l.paymentsMade >= l.termDays ? null : (l.paymentsMade + 1 === l.termDays ? l.lastPayment : l.dailyPayment);
    return `
      <article class="bank-loan${late ? " bank-loan--arrears" : ""}" data-loan="${escapeHtml(l.id)}">
        <header class="bank-loan__header">
          <h4>${escapeHtml(facilityName(l.termDays))} · ${cr(l.principal)} credits</h4>
          ${late ? `<span class="ui-badge bank-loan__badge" data-role="arrears-badge">In arrears</span>` : `<span class="ui-badge bank-loan__badge bank-loan__badge--ok">Current</span>`}
        </header>
        <dl class="bank-loan__terms">
          <div><dt>Still owed</dt><dd>${cr(l.balance)} credits</dd></div>
          <div><dt>Next payment</dt><dd>${next === null ? "none: the schedule is paid" : `${cr(next)} credits, ${bankTime(l.nextDueAt)}`}</dd></div>
          <div><dt>Payments</dt><dd>${l.paymentsMade} of ${l.termDays}, ${l.ratePct30}% per 30 days</dd></div>
          ${late ? `<div><dt>Arrears</dt><dd class="bank-loan__arrears">${cr(l.arrears)} credits since ${bankTime(l.arrearsSince)}; penalty interest accrues daily</dd></div>` : ""}
        </dl>
        <button type="button" class="ui-button ui-button--secondary" data-role="bank-payoff" data-loan="${escapeHtml(l.id)}">Pay off now: ${cr(payoffTotal(l))} credits</button>
      </article>`;
  };
  const done = (l) => `<li>${escapeHtml(facilityName(l.termDays))} · ${cr(l.principal)} credits · repaid ${bankTime(l.closedAt)}${l.paidOffEarly ? " (early)" : ""}</li>`;
  return `${open.map(card).join("")}${closed.length ? `<ul class="bank-loans__closed">${closed.map(done).join("")}</ul>` : ""}`;
}

export const BANK_DAY_MS = DAY;
