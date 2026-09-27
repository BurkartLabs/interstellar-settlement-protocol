// ISP-153 (AB#847): the loan board's view, inside the Deep Space Development Bank: fetches the board and this
// corporation's player loans, draws them (loanBoard.js holds the HTML) and binds posting, withdrawing and borrowing.
// Each step that moves credits is confirmed first, with what it moves: posting shows the escrow held, borrowing the
// fee and the schedule.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { borrowedLoansHtml, lentLoansHtml, loanBoardHtml, postOfferFormHtml } from "../loanBoard.js";
import { cr } from "../devBank.js";
import { appState } from "../state.js";
import { pushFeedback, refreshFromServer, showTradeConfirmation } from "./shared.js";

const board = { accountId: null, offers: null, rules: null, minGrades: [], grade: "NR", sort: "rate-asc", onlyMine: false, loans: null, error: "", form: {} };
const bound = new WeakSet();
const json = { "Content-Type": "application/json" };
const base = () => `/api/accounts/${encodeURIComponent(appState.accountId)}`;

/** The loan board's sections, for the Bank to place under its own. */
export function loanBoardSectionsHtml() {
  return `
    <section class="ui-panel station__panel bank-panel">
      <h3>Loan board</h3>
      <p class="station__note">Offers from other corporations, each fixed at its rate and term. Borrow one and it is repaid daily, to that corporation.</p>
      <div data-role="loan-board"></div>
    </section>
    <section class="ui-panel station__panel bank-panel">
      <h3>Offer a loan</h3>
      <div data-role="loan-post"></div>
    </section>
    <section class="ui-panel station__panel bank-panel">
      <h3>Loans you have made</h3>
      <div class="bank-loans" data-role="loans-lent"></div>
    </section>
    <section class="ui-panel station__panel bank-panel">
      <h3>Loans you owe other corporations</h3>
      <div class="bank-loans" data-role="loans-borrowed"></div>
    </section>`;
}

function draw(el) {
  const slot = (role) => el?.querySelector(`[data-role="${role}"]`);
  if (!slot("loan-board")) return; // the player has left the Bank
  slot("loan-board").innerHTML = loanBoardHtml({ offers: board.offers, grade: board.grade, sort: board.sort, onlyMine: board.onlyMine, error: board.error });
  // In a default's grace period the server refuses new offers (recoveryHold, AB#993): say so rather than offer the form.
  const held = (board.loans?.borrowed || []).some((l) => l.recovery?.state === "grace");
  slot("loan-post").innerHTML = held
    ? `<p class="station__note" data-role="loan-post-held">You cannot offer loans while one of your loans is in default and its grace period runs. Pay its arrears to lift this.</p>`
    : postOfferFormHtml(board.rules, board.minGrades, board.form);
  slot("loans-lent").innerHTML = board.loans ? lentLoansHtml(board.loans.lent) : `<p class="station__note">Reading your loans…</p>`;
  slot("loans-borrowed").innerHTML = board.loans ? borrowedLoansHtml(board.loans.borrowed) : "";
}

async function load(el) {
  try {
    const [offers, loans] = await Promise.all([
      parseJsonResponse(await apiFetch(`${base()}/loan-offers`)),
      parseJsonResponse(await apiFetch(`${base()}/player-loans`))
    ]);
    Object.assign(board, { offers: offers.offers, rules: offers.rules, minGrades: offers.minGrades, grade: offers.grade, loans, error: "", loadedAt: Date.now() });
  } catch (error) {
    board.error = error?.message || "the server did not answer";
  }
  draw(el);
}

async function postOffer(el, form) {
  const status = form.querySelector('[data-role="loan-post-status"]');
  const offer = { principal: Number(form.principal.value), ratePct30: Number(form.ratePct30.value), termDays: Number(form.termDays.value), minGrade: form.minGrade.value };
  board.form = offer;
  const credits = Math.floor(Number(appState.data?.corp?.finances?.credits) || 0);
  if (credits < offer.principal) {
    status.textContent = `Offering ${cr(offer.principal)} credits holds them in escrow; you have ${cr(credits)}.`;
    return;
  }
  const confirmed = await showTradeConfirmation({
    heading: "Loan board",
    title: `Offer ${cr(offer.principal)} credits at ${offer.ratePct30}% per 30 days?`,
    confirmLabel: `Hold ${cr(offer.principal)} credits in escrow`,
    rows: [
      { label: "Held in escrow now", value: `${cr(offer.principal)} credits, leaving you ${cr(credits - offer.principal)}` },
      { label: "Term", value: `${offer.termDays} days, repaid daily to you` },
      { label: "Lends to", value: offer.minGrade === "NR-accepted" ? "any grade, unrated included" : `grade ${offer.minGrade} or better` },
      { label: "Returned to you", value: "if you withdraw it, or no one borrows it in 7 days" }
    ]
  });
  if (!confirmed) return;
  status.textContent = "Posting…";
  try {
    await parseJsonResponse(await apiFetch(`${base()}/loan-offers`, { method: "POST", headers: json, body: JSON.stringify(offer) }));
    pushFeedback(`Offered ${cr(offer.principal)} credits on the loan board.`, "success");
    await refreshFromServer();
    await load(el);
  } catch (error) {
    status.textContent = error?.message || "The offer was not posted.";
  }
}

async function acceptOffer(el, offerId, btn) {
  const o = (board.offers || []).find((x) => x.id === offerId);
  if (!o) return;
  const confirmed = await showTradeConfirmation({
    heading: "Loan board",
    title: `Borrow ${cr(o.principal)} credits from ${o.lenderName}?`,
    confirmLabel: `Borrow ${cr(o.principal)} credits`,
    rows: [
      { label: "You receive", value: `${cr(o.principal - o.settlementFee)} credits (after the ${cr(o.settlementFee)} settlement fee)` },
      { label: "Daily payment", value: `${cr(o.dailyPayment)} credits for ${o.termDays} days, from 24 hours after you borrow` },
      { label: "Total repayable", value: `${cr(o.totalRepaid)} credits` },
      { label: "If you fall behind", value: "after 7 days in arrears the loan is in default, and what is owed is recovered from your credits, goods and buildings" }
    ]
  });
  if (!confirmed) return;
  btn.disabled = true;
  try {
    await parseJsonResponse(await apiFetch(`${base()}/loan-offers/${encodeURIComponent(offerId)}/accept`, { method: "POST", headers: json, body: "{}" }));
    pushFeedback(`Borrowed ${cr(o.principal)} credits from ${o.lenderName}.`, "success");
    await refreshFromServer();
  } catch (error) {
    pushFeedback(error?.message || "The loan was not taken.", "error");
  }
  await load(el);
}

async function cancelOffer(el, offerId, btn) {
  btn.disabled = true;
  try {
    await parseJsonResponse(await apiFetch(`${base()}/loan-offers/${encodeURIComponent(offerId)}/cancel`, { method: "POST", headers: json, body: "{}" }));
    pushFeedback("Offer withdrawn; its escrow is back in your account.", "success");
    await refreshFromServer();
  } catch (error) {
    pushFeedback(error?.message || "The offer was not withdrawn.", "error");
  }
  await load(el);
}

/** Draw the loan board into the Bank's panel `el` (after the Bank's own sections are placed), and bind it once. */
export function renderLoanBoard(el) {
  if (board.accountId !== appState.accountId) Object.assign(board, { accountId: appState.accountId, offers: null, loans: null, error: "", form: {} });
  draw(el);
  // the station redraws often: read the board when it is missing or older than 30 seconds, and after every action
  if (!board.offers || !board.loadedAt || Date.now() - board.loadedAt > 30_000) load(el);
  if (bound.has(el)) return;
  bound.add(el); // the panel is reused by every building: bind once, and only to the board's own controls
  el.addEventListener("submit", (event) => {
    if (event.target.matches('[data-role="loan-post-form"]')) { event.preventDefault(); postOffer(el, event.target); }
    if (event.target.matches('[data-role="loan-board-controls"]')) event.preventDefault();
  });
  el.addEventListener("change", (event) => {
    if (event.target.matches('[data-role="loan-board-sort"]')) { board.sort = event.target.value; draw(el); }
    if (event.target.matches('[data-role="loan-board-only"]')) { board.onlyMine = event.target.checked; draw(el); }
  });
  el.addEventListener("click", (event) => {
    const t = event.target.closest("button");
    if (!t) return;
    if (t.dataset.role === "loan-offer-accept") acceptOffer(el, t.dataset.offer, t);
    else if (t.dataset.role === "loan-offer-cancel") cancelOffer(el, t.dataset.offer, t);
  });
}
