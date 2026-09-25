// The Financial Core tab: the KPIs, profit and loss, the balance sheet and the daily statements.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { setStatementSeries } from "../charts.js";
import { fmtCredits, fmtSignedCredits, fmtTimestamp, prettifyLedgerLabel } from "../helpers.js";
import { escapeHtml } from "../html.js";
import { appState } from "../state.js";
import { clientPrices } from "../clientPrices.js";
import { statementDayOptionsHtml, statementHtml, statementsEmptyHtml, statementsToSeries } from "../statements.js";

// ─── Financial Control Board (CORP-FIN-1) — KPI strip and ledger tables ─────

export function setKpi(id, value, options = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.classList.remove("kpi-tile__value--positive", "kpi-tile__value--negative");
  if (options.tone === "positive") el.classList.add("kpi-tile__value--positive");
  else if (options.tone === "negative") el.classList.add("kpi-tile__value--negative");
}

export function setTrend(id, deltaText, direction) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = deltaText;
  el.classList.remove("kpi-tile__trend--up", "kpi-tile__trend--down", "kpi-tile__trend--flat");
  if (direction === "up") el.classList.add("kpi-tile__trend--up");
  else if (direction === "down") el.classList.add("kpi-tile__trend--down");
  else el.classList.add("kpi-tile__trend--flat");
}

export function describeTrend(curr, prev) {
  if (!Number.isFinite(prev)) return { text: "", direction: "flat" };
  const delta = curr - prev;
  if (delta === 0) return { text: "▬ no change", direction: "flat" };
  const sign = delta > 0 ? "▲" : "▼";
  return {
    text: `${sign} $${Math.abs(Math.round(delta)).toLocaleString()}`,
    direction: delta > 0 ? "up" : "down"
  };
}

export const STATEMENT_DAY_MS = 24 * 60 * 60 * 1000;

export const statementsState = { data: null, loadedForDay: null, selectedDay: null, loading: false };

/** Fetch the closed days and render them. Runs when the Financial Core opens, and again once a new day has closed. */
export async function loadStatements() {
  if (!appState.accountId || statementsState.loading) return;
  statementsState.loading = true;
  try {
    const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/finances/statements`);
    statementsState.data = await parseJsonResponse(response);
    statementsState.loadedForDay = Math.floor(Date.now() / STATEMENT_DAY_MS);
    renderStatements();
  } catch (err) {
    const body = document.getElementById("statement-body");
    if (body) body.innerHTML = `<p class="muted">The statements could not be loaded: ${escapeHtml(err.message || "try again shortly")}.</p>`;
  } finally {
    statementsState.loading = false;
  }
}

export function renderStatements() {
  const body = document.getElementById("statement-body");
  const picker = document.getElementById("statement-day");
  if (!body || !picker || !statementsState.data) return;
  const statements = Array.isArray(statementsState.data.statements) ? statementsState.data.statements : [];
  setStatementSeries(statementsToSeries(statements));
  const pickerLabel = picker.closest("label");
  if (!statements.length) {
    if (pickerLabel) pickerLabel.hidden = true;
    body.innerHTML = statementsEmptyHtml(statementsState.data.today);
    return;
  }
  // Yesterday by default (the newest closed day); a day chosen earlier stays chosen while it is kept.
  const chosen = statements.find((s) => s.day === statementsState.selectedDay) || statements[0];
  statementsState.selectedDay = chosen.day;
  picker.innerHTML = statementDayOptionsHtml(statements, chosen.day);
  if (pickerLabel) pickerLabel.hidden = false;
  body.innerHTML = statementHtml(chosen);
}

document.getElementById("statement-day")?.addEventListener("change", (event) => {
  statementsState.selectedDay = event.target.value;
  renderStatements();
});

/** A day has closed since the statements were loaded: load them again (checked on each finance update). */
export function refreshStatementsIfDayClosed() {
  if (statementsState.loadedForDay === null) return;
  if (Math.floor(Date.now() / STATEMENT_DAY_MS) !== statementsState.loadedForDay) loadStatements();
}

export function renderFinanceDashboard(finances) {
  if (!finances) return;
  const credits = Number(finances.credits) || 0;
  const assets = Number(finances.assets) || 0;
  const dailyRevenue = Number(finances.dailyRevenue) || 0;
  const dailyCosts = Number(finances.dailyCosts) || 0;
  // Bug #1022: the cost side is what was booked in the last 24 hours, not the payroll rate.
  const dailyExpenses = Number(finances.dailyExpenses) || 0;
  const inventory = Number(finances.inventoryValue) || 0;
  const netFlow = dailyRevenue - dailyExpenses;
  const snaps = Array.isArray(finances.snapshots) ? finances.snapshots : [];
  const latest = snaps.length ? snaps[snaps.length - 1] : null;
  const liabilities = latest ? latest.liabilities : Math.round(dailyCosts * 7);
  const netWorth = credits + assets + inventory - liabilities;

  setKpi("kpi-net-worth", `$${fmtCredits(netWorth)}`);
  setKpi("kpi-credits", `$${fmtCredits(credits)}`);
  setKpi(
    "kpi-net-flow",
    `${netFlow >= 0 ? "+" : "-"}$${Math.abs(Math.round(netFlow)).toLocaleString()}/day`,
    { tone: netFlow >= 0 ? "positive" : "negative" }
  );
  setKpi("kpi-revenue", `$${fmtCredits(dailyRevenue)}`);
  setKpi("kpi-costs", `$${fmtCredits(dailyExpenses)}`);

  let runwayLabel;
  if (dailyExpenses <= 0) runwayLabel = "∞";
  else runwayLabel = `${(credits / dailyExpenses).toFixed(1)} d`;
  setKpi("kpi-runway", runwayLabel);

  const prev = snaps.length >= 2 ? snaps[snaps.length - 2] : null;
  const nwTrend = describeTrend(netWorth, prev ? prev.netWorth : NaN);
  setTrend("kpi-net-worth-trend", nwTrend.text, nwTrend.direction);
  const credTrend = describeTrend(credits, prev ? prev.credits : NaN);
  setTrend("kpi-credits-trend", credTrend.text, credTrend.direction);

  const meta = document.getElementById("finance-last-snapshot");
  if (meta) meta.textContent = latest ? fmtTimestamp(latest.t) : "no snapshots yet";

  renderPnlTable(finances);
  renderBalanceTable(finances, { credits, assets, inventory, liabilities, netWorth });
}

export function renderPnlTable(finances) {
  const table = document.getElementById("finance-pnl-table");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  const tfoot = table.querySelector("tfoot");
  if (!tbody || !tfoot) return;

  const income = finances.incomeBySource || {};
  const expenses = finances.expensesByCategory || {};
  const lifetimeRevenue = Number(finances.lifetimeRevenue) || 0;
  const lifetimeCosts = Number(finances.lifetimeCosts) || 0;
  const net = lifetimeRevenue - lifetimeCosts;

  const incomeRows = Object.entries(income)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const expenseRows = Object.entries(expenses)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  const rowsHtml = [];
  rowsHtml.push(`<tr><th colspan="2" style="color:#6cf0c2">Revenue</th></tr>`);
  if (incomeRows.length === 0) {
    rowsHtml.push(`<tr><td>—</td><td class="num">0</td></tr>`);
  } else {
    for (const [k, v] of incomeRows) {
      rowsHtml.push(`<tr><td>${escapeHtml(prettifyLedgerLabel(k))}</td><td class="num num--positive">+${fmtCredits(v)}</td></tr>`);
    }
  }
  rowsHtml.push(`<tr><th colspan="2" style="color:#f0a06a">Expenses</th></tr>`);
  if (expenseRows.length === 0) {
    rowsHtml.push(`<tr><td>—</td><td class="num">0</td></tr>`);
  } else {
    for (const [k, v] of expenseRows) {
      rowsHtml.push(`<tr><td>${escapeHtml(prettifyLedgerLabel(k))}</td><td class="num num--negative">−${fmtCredits(v)}</td></tr>`);
    }
  }
  tbody.innerHTML = rowsHtml.join("");

  const netClass = net >= 0 ? "num--positive" : "num--negative";
  tfoot.innerHTML = `
    <tr><td>Lifetime Revenue</td><td class="num num--positive">+${fmtCredits(lifetimeRevenue)}</td></tr>
    <tr><td>Lifetime Costs</td><td class="num num--negative">−${fmtCredits(lifetimeCosts)}</td></tr>
    <tr><td><strong>Net Position</strong></td><td class="num ${netClass}"><strong>${fmtSignedCredits(net)}</strong></td></tr>
  `;
}

export function renderBalanceTable(finances, derived) {
  const table = document.getElementById("finance-balance-table");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  const tfoot = table.querySelector("tfoot");
  if (!tbody || !tfoot) return;

  const { credits, assets, inventory, liabilities, netWorth } = derived;
  const dailyRevenue = Number(finances.dailyRevenue) || 0;
  const dailyCosts = Number(finances.dailyCosts) || 0;
  const dailyExpenses = Number(finances.dailyExpenses) || 0;
  const forwardOps = Math.round(dailyCosts * 7);
  // Bug #1097: wages owed are their own line, not part of the lease figure; payroll is charged, at this rate.
  const payrollOwed = Math.max(0, Math.round(Number(finances.payrollArrears) || 0));
  const leaseShare = Math.max(0, liabilities - forwardOps - payrollOwed);
  const staff = Math.max(0, Math.floor(Number(appState.data?.corp?.employeeCount) || 0));
  const { payrollPerDay } = clientPrices(appState.economy);

  tbody.innerHTML = `
    <tr><th colspan="2" style="color:#6cf0c2">Assets</th></tr>
    <tr><td>Liquid Credits</td><td class="num">${fmtCredits(credits)}</td></tr>
    <tr><td>Facilities &amp; Probes</td><td class="num">${fmtCredits(assets)}</td></tr>
    <tr><td>Inventory (at standing bids)</td><td class="num">${fmtCredits(inventory)}</td></tr>
    <tr><th colspan="2" style="color:#f0a06a">Liabilities</th></tr>
    <tr><td>Forward Operating (7d)</td><td class="num">${fmtCredits(forwardOps)}</td></tr>
    <tr><td>Lease Commitments</td><td class="num">${fmtCredits(leaseShare)}</td></tr>
    ${payrollOwed > 0 ? `<tr><td>Payroll Owed</td><td class="num num--negative">${fmtCredits(payrollOwed)}</td></tr>` : ""}
    <tr><th colspan="2" style="color:#89a7bd">Operating Profile</th></tr>
    <tr><td>Daily Revenue</td><td class="num num--positive">+${fmtCredits(dailyRevenue)}</td></tr>
    <tr><td>Daily Costs</td><td class="num num--negative">−${fmtCredits(dailyExpenses)}</td></tr>
    <tr><td>Payroll (${staff} staff × ${fmtCredits(payrollPerDay)} a day)</td><td class="num num--negative">−${fmtCredits(staff * payrollPerDay)}</td></tr>
  `;

  const nwClass = netWorth >= 0 ? "num--positive" : "num--negative";
  tfoot.innerHTML = `
    <tr><td>Total Assets</td><td class="num num--positive">${fmtCredits(credits + assets + inventory)}</td></tr>
    <tr><td>Total Liabilities</td><td class="num num--negative">−${fmtCredits(liabilities)}</td></tr>
    <tr><td><strong>Net Worth</strong></td><td class="num ${nwClass}"><strong>${fmtSignedCredits(netWorth)}</strong></td></tr>
  `;
}
