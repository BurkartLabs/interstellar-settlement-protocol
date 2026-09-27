// ISP-161 (AB#855): the Intergalactic Stock Exchange's view: offerings to buy into, the portfolio with its exit to the
// market maker, and the caller's own corporation as an issuer. The HTML is stockExchange.js; this file fetches and binds.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { issuerHtml, offeringsHtml, portfolioHtml } from "../stockExchange.js";
import { countdown } from "../bondBoard.js";
import { cr } from "../devBank.js";
import { deepClone } from "../helpers.js";
import { appState } from "../state.js";
import { showActionReceipt } from "./receiptModal.js";
import { showTradeConfirmation, updateAllViews } from "./shared.js";
import { codeSlotHtml } from "../sectionCodes.js"; // ISP-250 (AB#946): the drawn sections' document codes

// Survives a redraw: which desk is shown and what was last read.
const ex = { accountId: null, mode: "offerings", offerings: null, holdings: null, capTable: null, error: null, last: null };
const bound = new WeakSet();
const json = { "Content-Type": "application/json" };
const base = () => `/api/accounts/${encodeURIComponent(appState.accountId)}/equity`;
const HEADING = "Intergalactic Stock Exchange";
let clock = null;

const root = () => document.querySelector('[data-role="igsx"]');

function draw() {
  const el = root();
  if (!el) return;
  if (ex.error) { el.innerHTML = `<p class="station__note">${ex.error}</p>`; return; }
  const d = ex.offerings;
  if (ex.mode === "portfolio") {
    el.innerHTML = `<section class="ui-panel station__panel bank-panel"><h3>Your portfolio</h3>${ex.holdings ? portfolioHtml(ex.holdings) : `<p class="station__note">Reading your holdings…</p>`}</section>`;
  } else if (ex.mode === "issuer") {
    el.innerHTML = `<section class="ui-panel station__panel bank-panel"><h3>Your corporation's shares</h3>${d ? issuerHtml(d, ex.capTable) : `<p class="station__note">Reading your registry…</p>`}</section>`;
  } else {
    el.innerHTML = `<section class="ui-panel station__panel bank-panel"><h3>${codeSlotHtml("igsx-offerings")}Primary offerings</h3>${d ? offeringsHtml(d, d.issuer?.corpId) : `<p class="station__note">Reading the Exchange's offerings…</p>`}</section>`;
  }
}

async function load() {
  try {
    const [offerings, holdings] = await Promise.all([
      parseJsonResponse(await apiFetch(`${base()}/offerings`)),
      parseJsonResponse(await apiFetch(`${base()}/holdings`))
    ]);
    ex.offerings = offerings;
    ex.holdings = holdings.holdings;
    ex.error = null;
    const corpId = offerings.issuer?.corpId;
    if (corpId) ex.capTable = await parseJsonResponse(await apiFetch(`/api/corporations/${encodeURIComponent(corpId)}/cap-table`));
  } catch (error) {
    ex.error = error?.message || "The Exchange could not be read.";
  }
  draw();
}

/** Post, then draw the account that comes back and show its receipt; a refusal goes in the form's status line. */
async function post(path, body, statusEl, refusal) {
  try {
    const answer = await parseJsonResponse(await apiFetch(`${base()}${path}`, { method: "POST", headers: json, body: JSON.stringify(body) }));
    if (answer.state) {
      appState.data = deepClone(answer.state);
      updateAllViews();
      showActionReceipt(answer, { returnFocusTo: () => document.querySelector('[data-role="igsx"] h3') });
    }
    await load();
    return answer;
  } catch (error) {
    if (statusEl) statusEl.textContent = error?.message || refusal;
    return null;
  }
}

async function buy(form) {
  const o = ex.offerings?.open.find((x) => x.id === form.dataset.offering);
  const n = Number(form.quantity.value);
  const status = form.querySelector('[data-role="igsx-status"]');
  if (!o) return;
  if (!Number.isInteger(n) || n < 1 || n > o.left) { status.textContent = `Enter 1 to ${cr(o.left)} shares.`; return; }
  const confirmed = await showTradeConfirmation({
    heading: HEADING,
    title: `Buy ${cr(n)} share${n === 1 ? "" : "s"} of ${o.issuerName ?? "this corporation"}?`,
    confirmLabel: `Pay ${cr(n * o.pricePerShare)} credits`,
    rows: [
      { label: "Price", value: `${cr(o.pricePerShare)} credits a share (company value ÷ shares outstanding at open)` },
      { label: "Cost", value: `${cr(n * o.pricePerShare)} credits` },
      { label: "Issuer's grade", value: o.grade },
      { label: "Dividends", value: `${o.payoutRatioPct ?? 0}% of its weekly net income, shared by shares` }
    ]
  });
  if (confirmed) await post(`/offerings/${encodeURIComponent(o.id)}/buy`, { quantity: n }, status, "The Exchange refused the order.");
}

async function exit(form) {
  const h = ex.holdings?.find((x) => x.issuerCorpId === form.dataset.issuer);
  const n = Number(form.quantity.value);
  const status = form.querySelector('[data-role="igsx-status"]');
  if (!h) return;
  if (!Number.isInteger(n) || n < 1 || n > h.shares) { status.textContent = `Enter 1 to ${cr(h.shares)} shares.`; return; }
  const costOfSold = Math.round(h.costBasis * (n / h.shares));
  const confirmed = await showTradeConfirmation({
    heading: HEADING,
    title: `Sell ${cr(n)} share${n === 1 ? "" : "s"} of ${h.issuerName ?? "this corporation"} to the market maker?`,
    confirmLabel: `Sell for ${cr(n * h.exitPrice)} credits`,
    rows: [
      { label: "Price", value: `${cr(h.exitPrice)} credits a share (value ${cr(h.valuePerShare)}, less 5%)` },
      { label: "You receive", value: `${cr(n * h.exitPrice)} credits` },
      { label: "Those shares cost", value: `${cr(costOfSold)} credits` }
    ]
  });
  if (confirmed) await post(`/holdings/${encodeURIComponent(h.issuerCorpId)}/exit`, { quantity: n }, status, "The market maker refused the sale.");
}

async function setPayout(form) {
  const pct = Number(form.payoutRatioPct.value);
  const status = form.querySelector('[data-role="igsx-payout-status"]');
  const confirmed = await showTradeConfirmation({
    heading: HEADING,
    title: `Pay out ${pct}% of net income from the next period?`,
    confirmLabel: "Set payout ratio",
    rows: [
      { label: "Now", value: `${ex.offerings.issuer.payoutRatioPct}%` },
      { label: "From the next period", value: `${pct}%` },
      { label: "Next change", value: "not for 7 days" }
    ]
  });
  if (confirmed && await post("/payout-ratio", { payoutRatioPct: pct }, status, "The Exchange refused the change.")) {
    const s = root()?.querySelector('[data-role="igsx-payout-status"]');
    if (s) s.textContent = `Set: ${pct}% from the next period.`;
  }
}

async function list(btn) {
  const fee = ex.offerings.issuer.listingFee;
  const confirmed = await showTradeConfirmation({
    heading: HEADING,
    title: "List your corporation on the Exchange?",
    confirmLabel: `Pay ${cr(fee)} credits`,
    rows: [{ label: "Fee", value: `${cr(fee)} credits, 1% of company value, once` }, { label: "Then", value: "you may offer new shares to other corporations" }]
  });
  if (confirmed) { btn.disabled = true; await post("/list", {}, root()?.querySelector('[data-role="igsx-list-status"]'), "The Exchange refused the listing."); }
}

async function offer(form) {
  const n = Number(form.quantity.value);
  const status = form.querySelector('[data-role="igsx-offer-status"]');
  const confirmed = await showTradeConfirmation({
    heading: HEADING,
    title: `Offer ${cr(n)} new shares for 7 days?`,
    confirmLabel: "Open offering",
    rows: [{ label: "Price", value: "company value ÷ shares outstanding, set when it opens" }, { label: "Fee", value: "2% of what it raises, at close" }]
  });
  if (confirmed) await post("/offerings", { quantity: n }, status, "The Exchange refused the offering.");
}

/** Draw the Exchange into the station's building panel and bind it. `header` is the building's shared header markup. */
export function renderStockExchange(contentEl, header) {
  if (ex.accountId !== appState.accountId) Object.assign(ex, { accountId: appState.accountId, mode: "offerings", offerings: null, holdings: null, capTable: null, error: null });
  ex.last = { contentEl, header };
  contentEl.innerHTML = `${header}
    <div class="bank-modes" role="group" aria-label="Stock Exchange desk">
      ${[["offerings", "Offerings"], ["portfolio", "Portfolio"], ["issuer", "Your shares"]].map(([m, label]) => `<button type="button" class="ui-button ui-button--secondary bank-modes__button" data-role="igsx-mode" data-mode="${m}" aria-pressed="${ex.mode === m}">${label}</button>`).join("")}
    </div>
    <div data-role="igsx"></div>`;
  draw();
  load();
  clearInterval(clock);
  clock = setInterval(() => {
    if (!root()) { clearInterval(clock); return; }
    for (const c of document.querySelectorAll('[data-role="igsx-countdown"]')) c.textContent = countdown(Number(c.dataset.closes), Date.now());
  }, 30_000);
  if (bound.has(contentEl)) return;
  bound.add(contentEl); // the panel is reused by every building: bind once, and only to the Exchange's own controls
  contentEl.addEventListener("submit", (event) => {
    const f = event.target;
    const handler = { "igsx-buy": buy, "igsx-exit": exit, "igsx-payout": setPayout, "igsx-offer": offer }[f.dataset?.role];
    if (!handler) return;
    event.preventDefault();
    handler(f);
  });
  contentEl.addEventListener("click", (event) => {
    const t = event.target.closest("button");
    if (t?.dataset.role === "igsx-mode") {
      ex.mode = t.dataset.mode;
      for (const b of contentEl.querySelectorAll('[data-role="igsx-mode"]')) b.setAttribute("aria-pressed", String(b.dataset.mode === ex.mode));
      draw();
    } else if (t?.dataset.role === "igsx-list") list(t);
  });
}
