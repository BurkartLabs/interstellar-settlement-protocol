// ISP-151 (AB#845): the Deep Space Development Bank's view: its facilities and this corporation's limit on each, a
// quote with every cost of the loan, accepting it (confirm, then the ISP-19 receipt), and the loans with balance,
// next payment, arrears and early payoff. The HTML is devBank.js; this file fetches and binds.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { bankLoansHtml, bankOffersHtml, bankQuoteHtml, cr, payoffTotal } from "../devBank.js";
import { deepClone } from "../helpers.js";
import { appState } from "../state.js";
import { showActionReceipt } from "./receiptModal.js";
import { showTradeConfirmation, updateAllViews } from "./shared.js";
import { renderBondBoard } from "./bondBoard.js"; // ISP-156 (AB#850)
import { loanBoardSectionsHtml, renderLoanBoard } from "./loanBoard.js"; // ISP-153 (AB#847)
import { codeSlotHtml } from "../sectionCodes.js"; // ISP-250 (AB#946): the drawn sections' document codes

// The view's own state survives a redraw: the offers read once per visit, the open quote, and what the form holds.
const bank = { accountId: null, offers: null, loading: false, quote: null, form: {}, mode: "loans", last: null };
const bound = new WeakSet();
const json = { "Content-Type": "application/json" };
const base = () => `/api/accounts/${encodeURIComponent(appState.accountId)}/loans`;

function redraw(data) {
  const el = document.getElementById("station-building-content");
  const slot = (role) => el?.querySelector(`[data-role="${role}"]`);
  if (!slot("bank-offers")) return; // the player has left the Bank
  slot("bank-offers").innerHTML = bankOffersHtml(bank.offers, bank.form);
  slot("bank-quote-slot").innerHTML = bankQuoteHtml(bank.quote);
  // AB#847: the Bank's own facilities only; loans from other corporations are on the loan board below
  slot("bank-loans").innerHTML = bankLoansHtml((data?.corp?.loans || []).filter((l) => l?.lender?.kind !== "player"));
}

async function loadOffers() {
  if (bank.loading) return;
  bank.loading = true;
  try {
    bank.offers = await parseJsonResponse(await apiFetch(`${base()}/offers`));
  } catch (error) {
    bank.offers = { grade: "NR", minPrincipal: 0, products: [], error: error?.message };
  } finally {
    bank.loading = false;
  }
  redraw(appState.data);
}

async function requestQuote(form) {
  const status = form.querySelector('[data-role="bank-quote-status"]');
  bank.form = { productId: form.productId.value, principal: Number(form.principal.value) };
  status.textContent = "The credit desk is pricing your loan…";
  try {
    const answer = await parseJsonResponse(await apiFetch(`${base()}/quote`, { method: "POST", headers: json, body: JSON.stringify(bank.form) }));
    bank.quote = answer.quote;
    redraw(appState.data);
    document.querySelector('[data-role="bank-accept"]')?.focus();
  } catch (error) {
    status.textContent = error?.message || "The Bank declined to quote.";
  }
}

async function acceptQuote() {
  const q = bank.quote;
  if (!q) return;
  const confirmed = await showTradeConfirmation({
    heading: "Deep Space Development Bank",
    title: `Borrow ${cr(q.principal)} credits for ${q.termDays} days?`,
    confirmLabel: `Borrow ${cr(q.principal)} credits`,
    rows: [
      { label: "You receive", value: `${cr(q.principal - q.originationFee)} credits (after the ${cr(q.originationFee)} fee)` },
      { label: "Daily payment", value: `${cr(q.dailyPayment)} credits, from 24 hours after you accept` },
      { label: "Total repayable", value: `${cr(q.totalRepaid)} credits` }
    ]
  });
  if (!confirmed) return;
  const btn = document.querySelector('[data-role="bank-accept"]');
  if (btn) btn.disabled = true;
  try {
    const account = await parseJsonResponse(await apiFetch(`${base()}/accept`, { method: "POST", headers: json, body: JSON.stringify({ quoteId: q.id }) }));
    bank.quote = null;
    bank.offers = null;
    appState.data = deepClone(account.state);
    updateAllViews();
    showActionReceipt(account, { returnFocusTo: () => document.querySelector('[data-role="bank-loans"] [data-role="bank-payoff"]') });
    loadOffers();
  } catch (error) {
    bank.quote = null;
    redraw(appState.data);
    const status = document.querySelector('[data-role="bank-quote-status"]');
    if (status) status.textContent = error?.message || "The Bank refused the quote. Ask for a new one.";
  }
}

async function payOff(loanId, btn) {
  const loan = (appState.data?.corp?.loans || []).find((l) => l.id === loanId);
  if (!loan) return;
  const total = payoffTotal(loan);
  const confirmed = await showTradeConfirmation({
    heading: "Deep Space Development Bank",
    title: `Settle this ${loan.termDays}-day facility now?`,
    confirmLabel: `Pay ${cr(total)} credits`,
    rows: [
      { label: "Principal still owed", value: `${cr(loan.balance)} credits` },
      ...(loan.arrears > 0 ? [{ label: "Arrears", value: `${cr(loan.arrears)} credits` }] : []),
      { label: "Early settlement fee", value: `${cr(Math.round(loan.balance / 100))} credits (1%)` },
      { label: "Total", value: `${cr(total)} credits` }
    ]
  });
  if (!confirmed) return;
  btn.disabled = true;
  try {
    const account = await parseJsonResponse(await apiFetch(`${base()}/${encodeURIComponent(loanId)}/payoff`, { method: "POST", headers: json, body: "{}" }));
    bank.offers = null;
    appState.data = deepClone(account.state);
    updateAllViews();
    showActionReceipt(account, { returnFocusTo: () => document.querySelector(".nav-tab[data-tab='station']") });
    loadOffers();
  } catch (error) {
    btn.disabled = false;
    btn.textContent = error?.message || "The Bank refused the payment.";
  }
}

/** Draw the Bank into the station's building panel and bind it. `header` is the building's shared header markup. */
export function renderDevelopmentBank(contentEl, data, header) {
  if (bank.accountId !== appState.accountId) Object.assign(bank, { accountId: appState.accountId, offers: null, quote: null, form: {}, mode: "loans" });
  bank.last = { contentEl, header };
  // ISP-156 (AB#850): the Bank lends (loans) and lists corporate bonds (bonds); one at a time
  const modes = `
    <div class="bank-modes" role="group" aria-label="Development Bank desk">
      ${[["loans", "Loans"], ["bonds", "Bonds"]].map(([m, label]) => `<button type="button" class="ui-button ui-button--secondary bank-modes__button" data-role="bank-mode" data-mode="${m}" aria-pressed="${bank.mode === m}">${label}</button>`).join("")}
    </div>`;
  if (bank.mode === "bonds") {
    contentEl.innerHTML = `${header}${modes}<div class="bond-board" data-role="bond-board"></div>`;
    renderBondBoard(contentEl.querySelector('[data-role="bond-board"]'));
  } else {
  contentEl.innerHTML = `
    ${header}
    ${modes}
    <section class="ui-panel station__panel bank-panel">
      <h3>${codeSlotHtml("bank-borrow")}Borrow from the Bank</h3>
      <div data-role="bank-offers"></div>
      <div data-role="bank-quote-slot"></div>
    </section>
    <section class="ui-panel station__panel bank-panel">
      <h3>${codeSlotHtml("bank-facilities")}Your facilities</h3>
      <div class="bank-loans" data-role="bank-loans"></div>
    </section>
    ${loanBoardSectionsHtml()}`;
  redraw(data);
  renderLoanBoard(contentEl); // ISP-153 (AB#847)
  if (!bank.offers) loadOffers();
  }
  if (bound.has(contentEl)) return;
  bound.add(contentEl); // the panel is reused by every building: bind once, and only to the Bank's own controls
  contentEl.addEventListener("submit", (event) => {
    if (event.target.matches('[data-role="bank-quote-form"]')) {
      event.preventDefault();
      requestQuote(event.target);
    }
  });
  contentEl.addEventListener("click", (event) => {
    const t = event.target.closest("button");
    if (!t) return;
    if (t.dataset.role === "bank-mode") {
      bank.mode = t.dataset.mode;
      renderDevelopmentBank(bank.last.contentEl, appState.data, bank.last.header);
      contentEl.querySelector(`[data-role="bank-mode"][data-mode="${bank.mode}"]`)?.focus();
    } else if (t.dataset.role === "bank-accept") acceptQuote();
    else if (t.dataset.role === "bank-discard") { bank.quote = null; redraw(appState.data); }
    else if (t.dataset.role === "bank-payoff") payOff(t.dataset.loan, t);
  });
}
