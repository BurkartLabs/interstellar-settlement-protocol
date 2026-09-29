// ISP-156 (AB#850): the bond board in the Development Bank's view: open series to subscribe to, the issue form with a
// live preview, and the caller's holdings and issued series. The HTML is bondBoard.js; this file fetches and binds.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { bondPreviewHtml, countdown, holdingsHtml, issuedHtml, issueFormHtml, openSeriesHtml } from "../bondBoard.js";
import { cr } from "../devBank.js";
import { deepClone } from "../helpers.js";
import { appState } from "../state.js";
import { showActionReceipt } from "./receiptModal.js";
import { showTradeConfirmation, updateAllViews } from "./shared.js";
import { escapeHtml } from "../html.js";
import { protocolLineHtml, refusalMeaning } from "../protocol.js"; // ISP-255 (AB#4824)

/** A line's plain words, then the protocol phrase and the Bank's code (the Bond Board is the Bank's). */
const said = (text, meaning) => `${escapeHtml(text)} ${protocolLineHtml({ meaning, screen: "building-deep-space-development-bank" })}`;

// Survives a redraw: the board as last read, what the issue form holds, and the server's preview of it.
const board = { accountId: null, data: null, loading: false, form: {}, preview: null, previewError: null, previewSeq: 0 };
const bound = new WeakSet();
const json = { "Content-Type": "application/json" };
const base = () => `/api/accounts/${encodeURIComponent(appState.accountId)}/bonds`;
let previewTimer = null;
let clock = null;

const root = () => document.querySelector('[data-role="bond-board"]');

function draw() {
  const el = root();
  if (!el) return;
  const d = board.data;
  if (!d) { el.innerHTML = `<p class="station__note">Reading the Bank's bond listings…</p>`; return; }
  const own = new Set(d.issued.map((s) => s.id));
  el.innerHTML = `
    <section class="ui-panel station__panel bank-panel">
      <h3>Open for subscribing</h3>
      ${openSeriesHtml(d, own)}
    </section>
    <section class="ui-panel station__panel bank-panel">
      <h3>Issue a series</h3>
      ${issueFormHtml(d, board.form, board.preview, board.previewError)}
    </section>
    <section class="ui-panel station__panel bank-panel">
      <h3>Your bond holdings</h3>
      ${holdingsHtml(d)}
    </section>
    ${d.issued.length ? `<section class="ui-panel station__panel bank-panel"><h3>Series you issued</h3>${issuedHtml(d)}</section>` : ""}`;
}

async function load() {
  if (board.loading) return;
  board.loading = true;
  try {
    board.data = await parseJsonResponse(await apiFetch(base()));
  } catch (error) {
    const el = root();
    if (el) el.innerHTML = `<p class="station__note">${said(error?.message || "The Bank's bond listings could not be read.", "failed")}</p>`; // escaped now, as every other line
    return;
  } finally {
    board.loading = false;
  }
  draw();
  if (board.data.eligibility.eligible && !board.preview && !board.previewError) requestPreview();
}

function readForm(form) {
  return { quantity: Number(form.quantity.value), couponPct30: Number(form.couponPct30.value), maturityDays: Number(form.maturityDays.value), windowHours: Number(form.windowHours.value) };
}

/** Ask the server to price the form as it stands; only the preview, the yield and the button are redrawn. */
async function requestPreview() {
  const form = root()?.querySelector('[data-role="bond-issue"]');
  if (form) board.form = readForm(form);
  const f = { quantity: 100, maturityDays: board.data.terms.maturityDays[1], couponPct30: board.data.terms.impliedYieldPct30[board.data.eligibility.grade] ?? 5, ...board.form };
  const seq = ++board.previewSeq;
  let preview = null, error = null;
  try {
    preview = (await parseJsonResponse(await apiFetch(`${base()}/preview`, { method: "POST", headers: json, body: JSON.stringify({ quantity: f.quantity, couponPct30: f.couponPct30, maturityDays: f.maturityDays }) }))).preview;
  } catch (e) {
    error = e?.message || "The Bank would not price that series.";
  }
  if (seq !== board.previewSeq) return; // a newer edit has asked again
  board.preview = preview;
  board.previewError = error;
  const el = root()?.querySelector('[data-role="bond-issue"]');
  if (!el) return;
  el.querySelector('[data-role="bond-preview"]').outerHTML = bondPreviewHtml(preview, error);
  if (preview) el.querySelector('[data-role="bond-yield"]').innerHTML = `Grade ${preview.grade} implies <strong>${preview.impliedYieldPct30}%</strong>`;
  el.querySelector('[data-role="bond-issue-submit"]').disabled = !preview;
}

async function issue(form) {
  const f = readForm(form);
  const p = board.preview;
  if (!p) return;
  const confirmed = await showTradeConfirmation({
    heading: "Deep Space Development Bank",
    title: `Issue ${cr(f.quantity)} bond units at ${f.couponPct30}% per 30 days?`,
    confirmLabel: "Issue series",
    rows: [
      { label: "Face", value: `${cr(p.face)} credits, ${f.maturityDays} days` },
      { label: "Grade and its yield", value: `${p.grade}, implying ${p.impliedYieldPct30}% per 30 days` },
      { label: "Coupons over its life", value: `${cr(p.couponCostIfSold)} credits if every unit sells` },
      { label: "Open for subscribing", value: `${f.windowHours} hours` }
    ]
  });
  if (!confirmed) return;
  const status = form.querySelector('[data-role="bond-issue-status"]');
  try {
    const account = await parseJsonResponse(await apiFetch(`${base()}/issue`, { method: "POST", headers: json, body: JSON.stringify(f) }));
    board.preview = null; board.previewError = null;
    appState.data = deepClone(account.state);
    updateAllViews();
    showActionReceipt(account, { returnFocusTo: () => document.querySelector('[data-role="bond-board"] h3') });
    await load();
  } catch (error) {
    if (status) status.innerHTML = said(error?.message || "The Bank refused the series.", refusalMeaning(error));
  }
}

async function subscribe(form) {
  const s = board.data?.open.find((x) => x.id === form.dataset.series);
  const units = Number(form.units.value);
  const status = form.querySelector('[data-role="bond-status"]');
  if (!s) return;
  if (!Number.isInteger(units) || units < 1 || units > s.left) { status.innerHTML = said(`Enter 1 to ${s.left} units.`, "refused"); return; }
  const confirmed = await showTradeConfirmation({
    heading: "Deep Space Development Bank",
    title: `Buy ${cr(units)} unit${units === 1 ? "" : "s"} of ${s.issuerName ? `${s.issuerName}'s` : "this"} series?`,
    confirmLabel: `Pay ${cr(units * s.faceValue)} credits`,
    rows: [
      { label: "Cost", value: `${cr(units * s.faceValue)} credits, at face` },
      { label: "Coupon", value: `${s.couponPct30}% per 30 days, every ${s.couponEveryDays} days` },
      { label: "Face back", value: `at maturity, ${s.maturityDays} days after the window closes` },
      { label: "Issuer's grade", value: s.grade }
    ]
  });
  if (!confirmed) return;
  try {
    const account = await parseJsonResponse(await apiFetch(`${base()}/${encodeURIComponent(s.id)}/subscribe`, { method: "POST", headers: json, body: JSON.stringify({ units }) }));
    appState.data = deepClone(account.state);
    updateAllViews();
    showActionReceipt(account, { returnFocusTo: () => document.querySelector('[data-role="bond-board"] h3') });
    await load();
  } catch (error) {
    status.innerHTML = said(error?.message || "The Bank refused to sell those units.", refusalMeaning(error));
  }
}

/** Draw the board into `el` (the Bank view's bond slot), read the listings, and keep the countdowns moving. */
export function renderBondBoard(el) {
  if (board.accountId !== appState.accountId) Object.assign(board, { accountId: appState.accountId, data: null, form: {}, preview: null, previewError: null });
  draw();
  load();
  clearInterval(clock);
  clock = setInterval(() => {
    if (!root()) { clearInterval(clock); return; }
    for (const c of document.querySelectorAll('[data-role="bond-countdown"]')) c.textContent = countdown(Number(c.dataset.closes), Date.now());
  }, 30_000);
  if (bound.has(el)) return;
  bound.add(el);
  el.addEventListener("input", (event) => {
    if (!event.target.closest('[data-role="bond-issue"]') || event.target.name === "windowHours") return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(requestPreview, 350);
  });
  el.addEventListener("change", (event) => {
    if (event.target.closest('[data-role="bond-issue"]') && event.target.name === "maturityDays") { clearTimeout(previewTimer); requestPreview(); }
  });
  el.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.matches('[data-role="bond-issue"]')) { event.preventDefault(); issue(form); }
    else if (form.matches('[data-role="bond-subscribe"]')) { event.preventDefault(); subscribe(form); }
  });
}
