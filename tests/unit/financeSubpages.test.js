// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url"; // jsdom replaces the global URL, and readFileSync wants Node's

// AB#2470 (DOCTRINE P-010): the Financial Core was one page 3.6 screens tall on a desktop. It is four pages - Summary,
// Trends, Statements, Daily - each a tabpanel of #finance-subnav. Nothing the one page held is lost: every section is
// in exactly one page. What each page looks like at 1280x800 and 375x812 is in docs/ab-2470.
vi.mock("../../public/scripts/charts.js", () => ({ renderFinanceCharts: vi.fn(), setStatementSeries: vi.fn() }));
const { renderFinanceCharts } = await import("../../public/scripts/charts.js");
const { appState } = await import("../../public/scripts/state.js");
const { FINANCE_SUBPAGES, bindFinanceSubpages, showFinanceSubpage } = await import("../../public/scripts/views/finance.js");

const HTML = readFileSync(new NodeURL("../../public/index.html", import.meta.url), "utf8");
const ARTICLE = HTML.slice(HTML.indexOf('<article id="finance"'), HTML.indexOf("</article>", HTML.indexOf('<article id="finance"')) + "</article>".length);

/** Where each of the original page's sections now lives. */
const HOME = {
  "finance-rating": "summary", "finance-cash-reserves": "summary", "kpi-net-worth": "summary", "kpi-runway": "summary",
  "finance-net-cash-flow": "trends", "finance-assets-vs-liabilities": "trends", "finance-income-by-source": "trends",
  "finance-asset-composition": "trends", "finance-daily-profit-and-loss": "trends",
  "finance-profit-and-loss-statement": "statements", "finance-balance-sheet": "statements",
  "finance-statements": "daily", "statement-day": "daily", "statement-body": "daily"
};

// the viewer's storage: Node's own localStorage (undefined without --localstorage-file) hides jsdom's, so a plain one
const saved = new Map();
const storage = { getItem: (k) => (saved.has(k) ? saved.get(k) : null), setItem: (k, v) => void saved.set(k, String(v)), clear: () => saved.clear() };
Object.defineProperty(window, "localStorage", { value: storage, configurable: true });

const tabs = () => [...document.querySelectorAll("#finance-subnav [role=tab]")];
const shown = () => [...document.querySelectorAll("#finance .finance__subpage")].filter((p) => !p.hidden).map((p) => p.id);

beforeEach(() => {
  document.body.innerHTML = `<main>${ARTICLE}</main>`;
  storage.clear();
  renderFinanceCharts.mockClear();
  appState.data = { corp: { finances: { credits: 1 } } };
});

describe("the Financial Core's pages (AB#2470)", () => {
  it("has one tab per page, each controlling its own tabpanel", () => {
    expect(tabs().map((t) => t.dataset.financeSub)).toEqual(FINANCE_SUBPAGES);
    for (const tab of tabs()) {
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    }
  });

  it("keeps every section of the one page, each in the page it belongs to", () => {
    for (const [id, page] of Object.entries(HOME)) {
      expect(document.getElementById(id)?.closest(".finance__subpage")?.id, id).toBe(`finance-sub-${page}`);
    }
    // below the header and the tab strip, the screen holds nothing but its pages
    const loose = [...document.getElementById("finance").children].filter((el) => !el.matches("header, #finance-subnav, .finance__subpage"));
    expect(loose.map((el) => el.outerHTML.slice(0, 60))).toEqual([]);
  });

  it("opens on Summary, and a click shows one page, selected, and remembered", () => {
    bindFinanceSubpages();
    expect(shown()).toEqual(["finance-sub-summary"]);
    tabs()[2].click();
    expect(shown()).toEqual(["finance-sub-statements"]);
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "false", "true", "false"]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, 0, -1]);
    expect(storage.getItem("isp.financeSubpage")).toBe("statements");

    document.body.innerHTML = `<main>${ARTICLE}</main>`;
    bindFinanceSubpages();
    expect(shown()).toEqual(["finance-sub-statements"]);
  });

  it("moves between pages with the arrow keys, Home and End, wrapping at the ends", () => {
    bindFinanceSubpages();
    const key = (k) => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    tabs()[0].focus();
    key("ArrowLeft");
    expect(shown()).toEqual(["finance-sub-daily"]);
    expect(document.activeElement.dataset.financeSub).toBe("daily");
    key("ArrowRight");
    expect(shown()).toEqual(["finance-sub-summary"]);
    key("End");
    expect(shown()).toEqual(["finance-sub-daily"]);
    key("Home");
    expect(shown()).toEqual(["finance-sub-summary"]);
  });

  it("draws the charts again when a page with charts opens on screen, since a chart drawn hidden has no size", () => {
    bindFinanceSubpages();
    showFinanceSubpage("trends");
    expect(renderFinanceCharts).not.toHaveBeenCalled(); // the Financial Core is not the tab on screen
    document.getElementById("finance").classList.add("active");
    showFinanceSubpage("trends");
    expect(renderFinanceCharts).toHaveBeenCalledTimes(1);
    showFinanceSubpage("statements");
    showFinanceSubpage("daily");
    expect(renderFinanceCharts).toHaveBeenCalledTimes(1);
  });

  it("ignores a remembered page that no longer exists, and works without storage", () => {
    storage.setItem("isp.financeSubpage", "ledger");
    bindFinanceSubpages();
    expect(shown()).toEqual(["finance-sub-summary"]);
    const spy = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => showFinanceSubpage("trends")).not.toThrow();
    expect(shown()).toEqual(["finance-sub-trends"]);
    spy.mockRestore();
  });
});
