import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";

// Bug #4838: Chart.js is fetched the first time a chart is about to be drawn, once, and again only after a failure.
const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

function fakeDocument() {
  const appended = [];
  return {
    appended,
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { append: (el) => appended.push(el) }
  };
}

describe("loadChartJs (Bug #4838)", () => {
  let mod;
  beforeEach(async () => {
    vi.resetModules();
    delete globalThis.Chart;
    mod = await import("../../public/scripts/chartLoader.js");
  });
  afterEach(() => { delete globalThis.Chart; });

  it("injects the script once, however many draws ask, and resolves when it has loaded", async () => {
    const doc = fakeDocument();
    const a = mod.loadChartJs(doc);
    const b = mod.loadChartJs(doc);
    expect(doc.appended).toHaveLength(1);
    expect(doc.appended[0].src).toBe(mod.CHART_SRC);
    globalThis.Chart = function Chart() {};
    doc.appended[0].onload();
    await Promise.all([a, b]);
    expect(mod.chartReady()).toBe(true);
    await mod.loadChartJs(doc);
    expect(doc.appended).toHaveLength(1);
  });

  it("loads nothing when Chart.js is already there", async () => {
    globalThis.Chart = function Chart() {};
    const doc = fakeDocument();
    await mod.loadChartJs(doc);
    expect(doc.appended).toHaveLength(0);
  });

  it("tries again on the next draw after a failed load", async () => {
    const doc = fakeDocument();
    const first = mod.loadChartJs(doc);
    doc.appended[0].onerror();
    await expect(first).rejects.toThrow(/did not load/);
    expect(doc.appended[0].removed).toBe(true);
    mod.loadChartJs(doc);
    expect(doc.appended).toHaveLength(2);
  });

  it("is the vendored file, and the two views that chart are its only callers", () => {
    expect(fs.existsSync(new URL(`../../public${"/vendor/chart.js-4.4.3/chart.umd.min.js"}`, import.meta.url))).toBe(true);
    expect(read("public/scripts/chartLoader.js")).toContain('"/vendor/chart.js-4.4.3/chart.umd.min.js"');
    const callers = fs.readdirSync(new URL("../../public/scripts/", import.meta.url), { recursive: true })
      .filter((f) => f.endsWith(".js") && f !== "chartLoader.js" && /loadChartJs\(/.test(read(`public/scripts/${f.replace(/\\/g, "/")}`)));
    expect(callers.sort()).toEqual(["charts.js", "priceChart.js"]);
  });
});
