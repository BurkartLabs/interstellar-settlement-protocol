// public/scripts/priceChart.js
// The Galactic Exchange's price chart (AB#716, ISP-31): one resource's daily close and volume over the last 7 or 30
// days, from GET /api/market/history/:item (AB#715). The resource is the one selected in the Exchange's filter bar,
// Silicates when none is. shapePriceHistory is pure so it can be tested against the API without a browser.

const DAY_MS = 24 * 60 * 60 * 1000;
export const PRICE_CHART_RANGES = [7, 30];
export const DEFAULT_CHART_ITEM = "Silicates";

/** The UTC calendar day of a timestamp, YYYY-MM-DD: the same key the server buckets by. */
export function chartDayKey(t) {
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Turn the server's daily buckets (oldest first) into what the chart draws: one entry per UTC day of the range, today
 * last, with the day's close (null on a day with no trades, so the line breaks rather than inventing a price) and its
 * volume (0). `lastClose` is the close of the most recent bucket, which is the most recent trade's price, whether or
 * not it falls inside the range.
 */
export function shapePriceHistory(buckets, rangeDays, now = Date.now()) {
  const sorted = (Array.isArray(buckets) ? buckets : []).filter((b) => b && b.day).slice().sort((a, b) => (a.day < b.day ? -1 : 1));
  const byDay = new Map(sorted.map((b) => [b.day, b]));
  const days = [];
  for (let i = rangeDays - 1; i >= 0; i -= 1) days.push(chartDayKey(now - i * DAY_MS));
  const inRange = days.map((d) => byDay.get(d)).filter(Boolean);
  const last = sorted.at(-1) || null;
  return {
    days,
    closes: days.map((d) => (byDay.has(d) ? byDay.get(d).close : null)),
    volumes: days.map((d) => (byDay.has(d) ? byDay.get(d).volume : 0)),
    hasAny: sorted.length > 0,
    hasInRange: inRange.length > 0,
    lastClose: last ? last.close : null,
    lastDay: last ? last.day : null,
    high: inRange.length ? Math.max(...inRange.map((b) => b.high)) : null,
    low: inRange.length ? Math.min(...inRange.map((b) => b.low)) : null,
    volume: inRange.reduce((sum, b) => sum + b.volume, 0),
    trades: inRange.reduce((sum, b) => sum + b.trades, 0)
  };
}

/** The line under the chart's title: what the chart says, in words. Empty history has its own message. */
export function priceChartSummary(item, shaped, rangeDays, formatCredits) {
  if (!shaped.hasAny) return `No trades recorded yet for ${item}.`;
  const last = `Last trade ${formatCredits(shaped.lastClose)} on ${shaped.lastDay}.`;
  if (!shaped.hasInRange) return `${last} No trades in the last ${rangeDays} days.`;
  return `${last} ${rangeDays}-day high ${formatCredits(shaped.high)}, low ${formatCredits(shaped.low)}; ${shaped.volume.toLocaleString()} units in ${shaped.trades.toLocaleString()} trade${shaped.trades === 1 ? "" : "s"}.`;
}

const COLOR = { line: "#00f7ff", lineFill: "rgba(0, 247, 255, 0.12)", bar: "rgba(137, 167, 189, 0.45)", grid: "rgba(137, 167, 189, 0.12)", muted: "#89a7bd" };

/**
 * Wire the chart to the Exchange: the filter bar picks the item, the 7/30 buttons pick the range, and the chart
 * refreshes when the Exchange is shown and every 30 seconds while it is open (a trade anywhere changes the history).
 * `fetchHistory(item)` resolves to the route's JSON; `formatCredits(n)` prints money. The selected resource is read from
 * the filter bar's active pill, so the chart follows it however it changes (a click, a remembered view, a reset).
 */
export function bindPriceChart({ fetchHistory, formatCredits }) {
  const card = document.getElementById("exchange-price-chart");
  if (!card) return;
  const title = document.getElementById("price-chart-title");
  const summary = document.getElementById("price-chart-summary");
  const canvas = document.getElementById("price-chart-canvas");
  const rangeButtons = [...card.querySelectorAll("[data-price-range]")];
  const panel = document.getElementById("market");
  if (!panel) return;
  let range = 7;
  let chart = null;
  let latest = 0;
  let charted = null;
  const filterBar = document.getElementById("exchange-filter-bar");
  const selectedItem = () => filterBar?.querySelector(".exchange-filter-pill.active")?.getAttribute("data-filter") || "";

  const draw = (item, buckets) => {
    const shaped = shapePriceHistory(buckets, range);
    title.textContent = `${item}: price history`;
    summary.textContent = priceChartSummary(item, shaped, range, formatCredits);
    card.classList.toggle("price-chart--empty", !shaped.hasAny);
    canvas.hidden = !shaped.hasAny;
    if (!shaped.hasAny || typeof window.Chart !== "function") {
      chart?.destroy();
      chart = null;
      return;
    }
    const labels = shaped.days.map((d) => d.slice(5));
    const data = {
      labels,
      datasets: [
        { type: "line", label: "Close", data: shaped.closes, yAxisID: "price", borderColor: COLOR.line, backgroundColor: COLOR.lineFill,
          pointRadius: range === 7 ? 3 : 2, spanGaps: false, tension: 0.2, order: 1 },
        { type: "bar", label: "Volume", data: shaped.volumes, yAxisID: "volume", backgroundColor: COLOR.bar, order: 2 }
      ]
    };
    if (chart) {
      chart.data = data;
      chart.update("none");
      return;
    }
    chart = new window.Chart(canvas, {
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: COLOR.muted, boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: COLOR.muted, maxRotation: 0, autoSkip: true }, grid: { color: COLOR.grid } },
          price: { position: "left", ticks: { color: COLOR.muted, callback: (v) => formatCredits(v) }, grid: { color: COLOR.grid } },
          volume: { position: "right", beginAtZero: true, ticks: { color: COLOR.muted }, grid: { display: false } }
        }
      }
    });
  };

  const refresh = async () => {
    const item = selectedItem() || DEFAULT_CHART_ITEM;
    charted = item;
    const ticket = ++latest;
    try {
      const res = await fetchHistory(item);
      if (ticket !== latest) return; // a newer request superseded this one
      draw(item, res?.buckets || []);
    } catch {
      if (ticket !== latest) return;
      title.textContent = `${item}: price history`;
      summary.textContent = `Price history for ${item} is unavailable right now.`;
      canvas.hidden = true;
    }
  };

  rangeButtons.forEach((btn) => btn.addEventListener("click", () => {
    range = Number(btn.getAttribute("data-price-range")) || 7;
    rangeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    refresh();
  }));
  // The bar is redrawn on every market update; chart again only when the selected resource has changed.
  if (filterBar) {
    new MutationObserver(() => {
      if (panel.classList.contains("active") && (selectedItem() || DEFAULT_CHART_ITEM) !== charted) refresh();
    }).observe(filterBar, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }
  // Whenever the Exchange is shown, from its tab or from anywhere else that opens it.
  let shown = false;
  new MutationObserver(() => {
    const now = panel.classList.contains("active");
    if (now && !shown) refresh();
    shown = now;
  }).observe(panel, { attributes: true, attributeFilter: ["class"] });
  setInterval(() => { if (panel.classList.contains("active") && !document.hidden) refresh(); }, 30_000);
}
