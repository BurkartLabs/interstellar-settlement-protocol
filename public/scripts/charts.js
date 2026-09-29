// public/scripts/charts.js
// Renders the Financial Control Board (CORP-FIN-1) — six Chart.js panels
// driven entirely by server-side snapshots and ledger data on `corp.finances`.
//
// Snapshot shape (server/finances.js → buildSnapshot):
//   { t, credits, assets, liabilities, dailyRevenue, dailyCosts, dailyExpenses, inventory, netFlow, netWorth }

import { chartReady, loadChartJs } from "./chartLoader.js"; // Bug #4838

const COLOR = {
  cyan: "#00f7ff",
  cyanSoft: "rgba(0, 247, 255, 0.55)",
  cyanFill: "rgba(0, 247, 255, 0.14)",
  amber: "#ffaa33",
  amberSoft: "rgba(255, 170, 51, 0.55)",
  amberFill: "rgba(255, 170, 51, 0.16)",
  red: "rgba(240, 106, 119, 0.85)",
  redFill: "rgba(240, 106, 119, 0.18)",
  green: "rgba(108, 240, 194, 0.85)",
  greenFill: "rgba(108, 240, 194, 0.18)",
  steel: "rgba(137, 167, 189, 0.8)",
  ice: "rgba(216, 235, 245, 0.65)",
  text: "#d8ebf5",
  muted: "#89a7bd",
  grid: "rgba(137, 167, 189, 0.18)",
  panel: "rgba(5, 5, 15, 1)"
};

const SECTOR_PALETTE = [
  "rgba(0, 247, 255, 0.78)",
  "rgba(255, 170, 51, 0.78)",
  "rgba(108, 240, 194, 0.78)",
  "rgba(179, 225, 245, 0.78)",
  "rgba(240, 106, 119, 0.72)",
  "rgba(137, 167, 189, 0.78)",
  "rgba(255, 213, 145, 0.78)"
];

const chartRegistry = {
  cashflow: null,
  netflow: null,
  asset: null,
  sector: null,
  composition: null,
  pnl: null
};

// Per-chart selected duration window (ms). null = "all".
const chartDurations = {
  cashflow: null,
  netflow: null,
  asset: null
};

// Most-recent finances object so duration changes can re-render without
// requiring the caller to repush the data.
let _lastFinances = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * ISP-77 (AB#766): the text a chart draws, in pixels. On a phone nothing a player reads is under 14px, so the axis and
 * legend text is 14 there; on a wider screen the smaller size keeps the axes uncrowded.
 */
export function chartFont(base, narrow = typeof window !== "undefined" && window.matchMedia?.("(max-width: 600px)").matches) {
  return narrow ? 14 : base;
}

function baseOptions(extra = {}) {
  const { beginAtZero = false, ...rest } = extra;
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: COLOR.text, font: { size: chartFont(11) } } },
      tooltip: {
        backgroundColor: "rgba(5, 12, 24, 0.95)",
        borderColor: COLOR.cyanSoft,
        borderWidth: 1,
        titleColor: COLOR.text,
        bodyColor: COLOR.text,
        padding: 10
      }
    },
    scales: {
      x: { ticks: { color: COLOR.muted, font: { size: chartFont(10) } }, grid: { color: COLOR.grid } },
      y: {
        beginAtZero,
        ticks: {
          color: COLOR.muted,
          font: { size: chartFont(10) },
          callback: (v) => formatCompact(v)
        },
        grid: { color: COLOR.grid }
      }
    },
    ...rest
  };
}

export function formatCompact(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (abs >= 1_000) return (v / 1_000).toFixed(1) + "K";
  // AB#2089: a fraction keeps up to two decimals. Around a flat zero line Chart.js picks ticks like 0.2 and 0.4, and
  // rounding them printed the axis as 1, 1, 1, 0, 0, 0.
  return Number(v.toFixed(2)).toString();
}

function snapshotLabel(snap) {
  if (snap?.label) return snap.label; // a daily close (AB#714) names its day
  if (!snap?.t) return "";
  const d = new Date(snap.t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function ensureCanvas(id) {
  return document.getElementById(id);
}

function projectFromCurrentState(finances) {
  // Until enough real snapshots have accumulated, synthesise a flat baseline
  // from the current credits + dailyRevenue/dailyCosts so the charts are
  // never empty on first paint.
  const credits = Number(finances?.credits) || 0;
  const revenue = Number(finances?.dailyRevenue) || 0;
  const costs = Number(finances?.dailyCosts) || 0;
  const expenses = Number(finances?.dailyExpenses) || 0; // Bug #1022: booked in the last 24 hours
  const inventory = Number(finances?.inventoryValue) || 0;
  const assets = Number(finances?.assets) || 0;
  const now = Date.now();
  const synth = [];
  for (let i = 11; i >= 0; i -= 1) {
    synth.push({
      t: now - i * 30_000,
      credits,
      assets,
      liabilities: Math.round(costs * 7),
      dailyRevenue: revenue,
      dailyCosts: costs,
      dailyExpenses: expenses,
      inventory,
      netFlow: revenue - expenses,
      netWorth: credits + assets + inventory - Math.round(costs * 7)
    });
  }
  return synth;
}

function getSnapshots(finances) {
  const snaps = Array.isArray(finances?.snapshots) ? finances.snapshots : [];
  if (snaps.length >= 2) return snaps;
  return projectFromCurrentState(finances);
}

// Filter snapshots to the rolling window the user has picked for `chartId`.
// `null`/missing = no filter (show everything).
// AB#714: the closed days from the statements, as chart points (statementsToSeries). A window longer than an hour
// draws these and ends at the live figure, instead of the half hour the 30-second snapshots hold.
const HOUR_MS = 3_600_000;
let _dailyPoints = [];

export function setStatementSeries(points) {
  _dailyPoints = Array.isArray(points) ? points : [];
  if (_lastFinances) renderFinanceCharts(_lastFinances);
}

function filterSnapsForChart(snaps, chartId) {
  const windowMs = chartDurations[chartId];
  if (_dailyPoints.length && (!windowMs || !Number.isFinite(windowMs) || windowMs > HOUR_MS)) {
    const cutoff = windowMs && Number.isFinite(windowMs) ? Date.now() - windowMs : -Infinity;
    const days = _dailyPoints.filter((p) => p.t >= cutoff);
    const live = snaps[snaps.length - 1];
    if (days.length) return live ? [...days, { ...live, label: "Now" }] : days;
  }
  if (!windowMs || !Number.isFinite(windowMs)) return snaps;
  const cutoff = Date.now() - windowMs;
  const filtered = snaps.filter((s) => Number(s?.t) >= cutoff);
  // If the window is too narrow to show anything, fall back to full series
  // rather than rendering an empty chart.
  return filtered.length >= 2 ? filtered : snaps;
}

// ─── Chart builders ─────────────────────────────────────────────────────────

function renderCashReserves(snaps) {
  const canvas = ensureCanvas("cashflow-chart");
  if (!canvas) return;
  const filtered = filterSnapsForChart(snaps, "cashflow");
  const labels = filtered.map(snapshotLabel);
  const data = filtered.map((s) => s.credits);

  if (!chartRegistry.cashflow) {
    chartRegistry.cashflow = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Liquid Credits",
          data,
          fill: true,
          borderColor: COLOR.cyan,
          backgroundColor: COLOR.cyanFill,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4
        }]
      },
      options: baseOptions({ beginAtZero: true })
    });
  } else {
    const c = chartRegistry.cashflow;
    c.data.labels = labels;
    c.data.datasets[0].data = data;
    c.update("none");
  }
}

function renderNetFlow(snaps) {
  const canvas = ensureCanvas("netflow-chart");
  if (!canvas) return;
  const filtered = filterSnapsForChart(snaps, "netflow");
  const labels = filtered.map(snapshotLabel);
  const data = filtered.map((s) => s.netFlow);

  if (!chartRegistry.netflow) {
    chartRegistry.netflow = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Net Flow",
          data,
          fill: true,
          borderColor: COLOR.amber,
          backgroundColor: COLOR.amberFill,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4
        }]
      },
      options: baseOptions({ beginAtZero: true })
    });
  } else {
    const c = chartRegistry.netflow;
    c.data.labels = labels;
    c.data.datasets[0].data = data;
    c.update("none");
  }
}

function renderAssetVsLiability(snaps) {
  const canvas = ensureCanvas("asset-chart");
  if (!canvas) return;
  const filtered = filterSnapsForChart(snaps, "asset");
  const labels = filtered.map(snapshotLabel);
  const assets = filtered.map((s) => s.assets + s.credits + (Number(s.inventory) || 0)); // Bug #1022: as Total Assets
  const liabilities = filtered.map((s) => s.liabilities);

  if (!chartRegistry.asset) {
    chartRegistry.asset = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Total Assets",
            data: assets,
            borderColor: COLOR.cyan,
            backgroundColor: COLOR.cyanFill,
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 0
          },
          {
            label: "Liabilities",
            data: liabilities,
            borderColor: COLOR.amber,
            backgroundColor: COLOR.amberFill,
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 0
          }
        ]
      },
      options: baseOptions()
    });
  } else {
    const c = chartRegistry.asset;
    c.data.labels = labels;
    c.data.datasets[0].data = assets;
    c.data.datasets[1].data = liabilities;
    c.update("none");
  }
}

function renderIncomeBySource(finances) {
  const canvas = ensureCanvas("sector-chart");
  if (!canvas) return;
  const map = (finances && finances.incomeBySource) || {};
  let entries = Object.entries(map).filter(([, v]) => Number(v) > 0);
  if (entries.length === 0) {
    entries = [["No revenue yet", 1]];
  }
  const labels = entries.map(([k]) => prettifySource(k));
  const data = entries.map(([, v]) => Number(v));
  const colors = entries.map((_, i) => SECTOR_PALETTE[i % SECTOR_PALETTE.length]);

  if (!chartRegistry.sector) {
    chartRegistry.sector = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderColor: COLOR.panel,
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "55%",
        plugins: {
          legend: {
            position: "right",
            labels: { color: COLOR.text, font: { size: chartFont(11) }, boxWidth: 10 }
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
                const pct = ((ctx.parsed / total) * 100).toFixed(1);
                return `${ctx.label}: ¤${formatCompact(ctx.parsed)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  } else {
    const c = chartRegistry.sector;
    c.data.labels = labels;
    c.data.datasets[0].data = data;
    c.data.datasets[0].backgroundColor = colors;
    c.update("none");
  }
}

function renderAssetComposition(finances) {
  const canvas = ensureCanvas("composition-chart");
  if (!canvas) return;
  const credits = Math.max(0, Number(finances?.credits) || 0);
  const facilities = Math.max(0, Number(finances?.assets) || 0);
  // Bug #1022: valued by the server at the standing NPC bids, refreshed with each snapshot.
  const inventory = Math.max(0, Number(finances?.inventoryValue) || 0);

  if (!chartRegistry.composition) {
    chartRegistry.composition = new Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Composition"],
        datasets: [
          { label: "Liquid Credits", data: [credits], backgroundColor: COLOR.cyanSoft, borderColor: COLOR.cyan, borderWidth: 1 },
          { label: "Facilities", data: [facilities], backgroundColor: COLOR.amberSoft, borderColor: COLOR.amber, borderWidth: 1 },
          { label: "Inventory", data: [inventory], backgroundColor: COLOR.steel, borderColor: COLOR.ice, borderWidth: 1 }
        ]
      },
      options: {
        ...baseOptions(),
        indexAxis: "y",
        scales: {
          x: { stacked: true, ticks: { color: COLOR.muted, font: { size: chartFont(10) }, callback: (v) => formatCompact(v) }, grid: { color: COLOR.grid } },
          y: { stacked: true, ticks: { color: COLOR.muted, font: { size: chartFont(10) } }, grid: { display: false } }
        }
      }
    });
  } else {
    const c = chartRegistry.composition;
    c.data.datasets[0].data = [credits];
    c.data.datasets[1].data = [facilities];
    c.data.datasets[2].data = [inventory];
    c.update("none");
  }
}

function renderDailyPnL(finances) {
  const canvas = ensureCanvas("pnl-chart");
  if (!canvas) return;
  const revenue = Math.max(0, Number(finances?.dailyRevenue) || 0);
  const costs = Math.max(0, Number(finances?.dailyExpenses) || 0); // Bug #1022: booked in the last 24 hours
  const net = revenue - costs;

  if (!chartRegistry.pnl) {
    chartRegistry.pnl = new Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Revenue", "Costs", "Net"],
        datasets: [{
          data: [revenue, costs, net],
          backgroundColor: [COLOR.greenFill, COLOR.redFill, net >= 0 ? COLOR.cyanFill : COLOR.redFill],
          borderColor: [COLOR.green, COLOR.red, net >= 0 ? COLOR.cyan : COLOR.red],
          borderWidth: 1
        }]
      },
      options: {
        ...baseOptions(),
        plugins: { legend: { display: false }, tooltip: baseOptions().plugins.tooltip }
      }
    });
  } else {
    const c = chartRegistry.pnl;
    c.data.datasets[0].data = [revenue, costs, net];
    c.data.datasets[0].backgroundColor = [COLOR.greenFill, COLOR.redFill, net >= 0 ? COLOR.cyanFill : COLOR.redFill];
    c.data.datasets[0].borderColor = [COLOR.green, COLOR.red, net >= 0 ? COLOR.cyan : COLOR.red];
    c.update("none");
  }
}

function prettifySource(key) {
  return String(key)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Bug #4838: the six panels' canvases; Chart.js is fetched only when one of them is on screen. */
const FINANCE_CANVASES = ["cashflow-chart", "netflow-chart", "asset-chart", "sector-chart", "composition-chart", "pnl-chart"];
const financeOnScreen = () => FINANCE_CANVASES.some((id) => (document.getElementById(id)?.getClientRects().length ?? 0) > 0);

export function renderFinanceCharts(finances) {
  if (!finances) return;
  if (!chartReady()) {
    // Bug #4838: the socket redraws these every 30 seconds whatever tab is open; only the Financial Core's own view
    // fetches Chart.js, and draws again when it arrives.
    _lastFinances = finances;
    if (financeOnScreen()) loadChartJs().then(() => { if (_lastFinances) renderFinanceCharts(_lastFinances); }, (error) => console.error("[charts]", error));
    return;
  }
  _lastFinances = finances;
  const snaps = getSnapshots(finances);
  renderCashReserves(snaps);
  renderNetFlow(snaps);
  renderAssetVsLiability(snaps);
  renderIncomeBySource(finances);
  renderAssetComposition(finances);
  renderDailyPnL(finances);
}

// Set the rolling-window duration for a single time-series chart and
// immediately re-render it with the cached finances. `windowMs` may be a
// number of milliseconds, or null/'all' for no filter.
export function setChartDuration(chartId, windowMs) {
  if (!Object.prototype.hasOwnProperty.call(chartDurations, chartId)) return;
  chartDurations[chartId] = windowMs === "all" || windowMs == null
    ? null
    : Number(windowMs);
  if (!_lastFinances) return;
  const snaps = getSnapshots(_lastFinances);
  if (chartId === "cashflow") renderCashReserves(snaps);
  else if (chartId === "netflow") renderNetFlow(snaps);
  else if (chartId === "asset") renderAssetVsLiability(snaps);
}

// Wire up the per-chart <select data-chart-duration> pickers in the DOM.
// Safe to call multiple times — listeners are attached idempotently via a
// dataset flag.
export function bindChartDurationPickers(root = document) {
  const pickers = root.querySelectorAll("[data-chart-duration]");
  pickers.forEach((picker) => {
    if (picker.dataset.durationBound === "1") return;
    picker.dataset.durationBound = "1";
    picker.addEventListener("change", () => {
      const chartId = picker.getAttribute("data-chart-duration");
      const value = picker.value;
      setChartDuration(chartId, value === "all" ? "all" : Number(value));
    });
  });
}
