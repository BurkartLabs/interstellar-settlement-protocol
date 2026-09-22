// The daily statements on the Financial Core (AB#714): pure helpers that turn GET /finances/statements into HTML and
// chart points, kept out of app.js so they can be tested without a browser. Every figure cell carries the statement
// field it shows (data-figure) and its exact value (data-value), so a test can hold the page to the endpoint.

import { escapeHtml } from "./html.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Credits as the Financial Core writes them: whole, grouped, en-US so every viewer and test sees the same digits. */
export function statementCredits(n) {
  return Math.round(Number(n) || 0).toLocaleString("en-US");
}

/** A ledger category as a row label: "office-rent" is "Office Rent"; CEO keeps its capitals. */
export function statementLabel(key) {
  if (key === "ceo-insight") return "CEO Insight";
  return String(key).replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Fixed names, not toLocaleDateString: its output varies by browser and ICU version ("Sep" or "Sept").
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "21 Sep", in UTC. */
function shortDay(d) {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Mon 21 Sep 2026", read in UTC: a statement's day is a UTC day. */
export function statementDayLabel(day) {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(day);
  return `${WEEKDAYS[d.getUTCDay()]} ${shortDay(d)} ${d.getUTCFullYear()}`;
}

/** The day picker's options, newest first; `selected` is a "YYYY-MM-DD" day, else the newest is chosen. */
export function statementDayOptionsHtml(statements, selected, now = Date.now()) {
  const yesterday = new Date(Math.floor(now / DAY_MS) * DAY_MS - DAY_MS).toISOString().slice(0, 10);
  const chosen = statements.some((s) => s.day === selected) ? selected : statements[0]?.day;
  return statements
    .map((s) => {
      const label = `${statementDayLabel(s.day)}${s.day === yesterday ? " (yesterday)" : ""}`;
      return `<option value="${escapeHtml(s.day)}"${s.day === chosen ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

// One figure: the label, and the amount with its sign and colour. `figure` is the statement path it shows.
function row(label, figure, value, { sign = "none", strong = false, muted = false } = {}) {
  const v = Math.round(Number(value) || 0);
  const shown = sign === "out" ? (v === 0 ? "0" : `−${statementCredits(v)}`) : sign === "in" ? `+${statementCredits(v)}` : sign === "net" ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${statementCredits(Math.abs(v))}` : statementCredits(v);
  const tone = sign === "out" && v > 0 ? " num--negative" : sign === "in" && v > 0 ? " num--positive" : sign === "net" && v !== 0 ? (v > 0 ? " num--positive" : " num--negative") : "";
  const cls = strong ? ' class="statement-total"' : muted ? ' class="statement-muted"' : "";
  return `<tr${cls}><td>${escapeHtml(label)}</td><td class="num${tone}" data-figure="${escapeHtml(figure)}" data-value="${v}">${shown}</td></tr>`;
}

const heading = (text, tone) => `<tr class="statement-heading statement-heading--${tone}"><th colspan="2" scope="rowgroup">${escapeHtml(text)}</th></tr>`;

function table(title, sub, body) {
  return `<section class="finance-table-card statement-card">
  <header class="chart-card__head"><h4>${escapeHtml(title)}</h4><span class="chart-card__sub">${escapeHtml(sub)}</span></header>
  <table class="finance-table"><tbody>${body}</tbody></table>
</section>`;
}

/** One closed day's three statements: profit and loss, cash flow, balance sheet. */
export function statementHtml(s) {
  const income = Object.entries(s?.pnl?.income || {}).sort((a, b) => b[1] - a[1]);
  const expenses = Object.entries(s?.pnl?.expenses || {}).sort((a, b) => b[1] - a[1]);
  const pnl = [
    heading("Income", "in"),
    ...(income.length ? income.map(([k, v]) => row(statementLabel(k), `pnl.income.${k}`, v, { sign: "in" })) : [`<tr class="statement-muted"><td>None</td><td class="num">0</td></tr>`]),
    heading("Expenses", "out"),
    ...(expenses.length ? expenses.map(([k, v]) => row(statementLabel(k), `pnl.expenses.${k}`, v, { sign: "out" })) : [`<tr class="statement-muted"><td>None</td><td class="num">0</td></tr>`]),
    row("Total income", "pnl.totalIncome", s.pnl.totalIncome, { sign: "in", strong: true }),
    row("Total expenses", "pnl.totalExpenses", s.pnl.totalExpenses, { sign: "out", strong: true }),
    row("Net profit", "pnl.net", s.pnl.net, { sign: "net", strong: true })
  ].join("");
  const cf = s.cashFlow;
  const cash = [
    row("Opening cash", "cashFlow.opening", cf.opening),
    row("Cash in", "cashFlow.inflows", cf.inflows, { sign: "in" }),
    row("Cash out", "cashFlow.outflows", cf.outflows, { sign: "out" }),
    // Only when something moved credits outside the ledger: shown, never hidden (AB#713).
    ...(cf.unrecorded ? [row("Not in the ledger", "cashFlow.unrecorded", cf.unrecorded, { sign: "net", muted: true })] : []),
    row("Closing cash", "cashFlow.closing", cf.closing, { strong: true })
  ].join("");
  const b = s.balanceSheet;
  const balance = [
    heading("Assets", "in"),
    row("Credits", "balanceSheet.credits", b.credits),
    row("Facilities & probes", "balanceSheet.facilities", b.facilities),
    row("Inventory (at standing bids)", "balanceSheet.inventory", b.inventory),
    row("Total assets", "balanceSheet.totalAssets", b.totalAssets, { strong: true }),
    heading("Liabilities", "out"),
    row("Obligations", "balanceSheet.liabilities", b.liabilities, { sign: "out" }),
    row("Net worth", "balanceSheet.netWorth", b.netWorth, { sign: "net", strong: true })
  ].join("");
  return `<div class="statement-grid" data-day="${escapeHtml(s.day)}">
${table("Profit & Loss", "Income and costs booked that day", pnl)}
${table("Cash Flow", "Opening to closing cash", cash)}
${table("Balance Sheet", "At the close, 00:00 UTC", balance)}
</div>`;
}

/**
 * Before the first close: say when it comes, and what has moved so far today from the open book, so the section is
 * never an empty table.
 */
export function statementsEmptyHtml(today) {
  const inflows = Object.values(today?.income || {}).reduce((a, v) => a + (Number(v) || 0), 0);
  const outflows = Object.values(today?.expenses || {}).reduce((a, v) => a + (Number(v) || 0), 0);
  const soFar = today
    ? `<p class="muted statement-sofar">So far today: <span class="num--positive">+${statementCredits(inflows)}</span> in, <span class="num--negative">−${statementCredits(outflows)}</span> out.</p>`
    : "";
  return `<div class="statement-empty"><p><strong>Your first statement closes at 00:00 UTC.</strong></p><p class="muted">Each day's profit and loss, cash flow and balance sheet are kept here for 90 days.</p>${soFar}</div>`;
}

/**
 * Chart points from the statements: one per closed day, at its close, shaped like the 30-second snapshots charts.js
 * already draws, so charts longer than an hour read the books instead of half an hour of snapshots. Oldest first.
 */
export function statementsToSeries(statements) {
  return [...(statements || [])]
    .filter((s) => Number.isFinite(Number(s?.dayStart)))
    .sort((a, b) => a.dayStart - b.dayStart)
    .map((s) => ({
      t: s.dayStart + DAY_MS,
      label: shortDay(new Date(s.dayStart)),
      credits: s.balanceSheet.credits,
      assets: s.balanceSheet.facilities,
      inventory: s.balanceSheet.inventory,
      liabilities: s.balanceSheet.liabilities,
      netFlow: s.pnl.net,
      netWorth: s.balanceSheet.netWorth
    }));
}
