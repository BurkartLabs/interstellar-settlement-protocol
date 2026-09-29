// Bug #4838: Chart.js (the largest single file on a first load, about 70 KB gzipped) is loaded the first time a chart is
// about to be drawn, not on every page: only the Financial Core (charts.js) and the Exchange's price chart
// (priceChart.js) draw one. It is a classic UMD script that defines window.Chart, so it is injected as a script tag
// once, and each caller draws again when it arrives. A failed load is retried on the next draw.

export const CHART_SRC = "/vendor/chart.js-4.4.3/chart.umd.min.js";

let loading = null;

export const chartReady = () => typeof globalThis.Chart === "function";

/** Load Chart.js once; resolves when window.Chart is defined. */
export function loadChartJs(doc = globalThis.document) {
  if (chartReady()) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = doc.createElement("script");
      script.src = CHART_SRC;
      script.onload = () => resolve();
      script.onerror = () => {
        loading = null; // the next draw tries again
        script.remove();
        reject(new Error(`${CHART_SRC} did not load`));
      };
      doc.head.append(script);
    });
  }
  return loading;
}
