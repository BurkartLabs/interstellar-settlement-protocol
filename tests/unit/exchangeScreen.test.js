import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ISP-80 (AB#769): the Galactic Exchange - order book, standing buy orders, my listings, trade history, the price chart
// and the filters - is built from the design system in the flat direction (Decision AB#1801). Its own old classes are
// gone from every page, script, stylesheet and spec; the shared legacy components (.btn, .form-card, .data-table and
// the rest) are gone from it, though screens not yet rebuilt keep them. At each width it is measured in
// e2e/exchange-screen.spec.js, which also looks for a panel wider than its room and a card with content past its edge.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const HTML = read("public/index.html");

/** The classes only the Exchange used before ISP-80. None may appear as a class, selector or toggle anywhere. */
export const OLD_CLASSES = [
  "price-chart", "price-chart__head", "price-chart__ranges", "price-chart__canvas", "price-chart__hint", "price-chart--empty",
  "exchange-controls", "exchange-filter-bar", "exchange-view-selects", "exchange-layout", "exchange-section",
  "exchange-filtered-empty", "exchange-filter-pill", "exchange-buy-btn", "exchange-cancel-btn", "exchange-clear-filters",
  "npc-sell-btn", "npc-order-exhausted", "npc-order-drift", "npc-order-remaining", "npc-order-of-total", "npc-order-track",
  "npc-order-fill", "sell-input", "listing-row-status", "listing-row-status--ok", "listing-row-status--error", "trade-time",
  "trade-counterparty", "trade-type-badge", "trade-type-listed", "trade-type-cancelled", "trade-type-sold",
  "trade-type-bought", "trade-tax-note"
];
/** Shared legacy components: other screens keep them for now, the Exchange does not use them. */
const LEGACY = ["btn", "btn-accent", "btn-ghost", "btn-outline", "form-card", "data-card", "data-table", "data-table--stack", "table-wrap", "split-grid", "text-list", "lede", "action-surface", "muted", "num"];

/** Every place a class name is used as one: class="...", className = "...", classList.*("..."), and selectors. */
function classUses(text, name) {
  const n = name.replace(/-/g, "\\-");
  const edge = "(?![\\w-])";
  const patterns = [
    new RegExp(`class(Name)?\\s*=\\s*["'\`][^"'\`]*(?<![\\w-])${n}${edge}`),
    new RegExp(`classList\\.(add|remove|toggle|contains)\\([^)]*["'\`]${n}["'\`]`),
    new RegExp(`(?<![\\w.-])\\.${n}${edge}(?!\\s*\\()`)
  ];
  return text.split("\n").filter((line) => patterns.some((p) => p.test(line)));
}

const filesUnder = (dir, exts) =>
  readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && exts.some((x) => e.name.endsWith(x)))
    .map((e) => path.relative(ROOT, path.join(e.parentPath, e.name)).split(path.sep).join("/"));

const start = HTML.indexOf('<article id="market" class="tab-panel');
const MARKET = HTML.slice(start, start + 1 + HTML.slice(start + 1).search(/<article id="[a-z]+" class="tab-panel|<\/main>/));
const RENDERERS = ["public/scripts/views/exchange.js", "public/scripts/exchangeView.js", "public/scripts/tradeHistory.js", "public/scripts/priceChart.js"];

describe("the Galactic Exchange is on the design system (ISP-80)", () => {
  it("no old class of its own is used anywhere: pages, scripts, stylesheet, tests or specs", () => {
    const files = ["public/index.html", ...filesUnder("public/scripts", [".js"]), "public/styles.css", ...filesUnder("e2e", [".js", ".mjs"]), ...filesUnder("tests", [".js"]).filter((f) => !f.endsWith("exchangeScreen.test.js"))];
    const found = [];
    for (const f of files) {
      const text = read(f);
      for (const name of OLD_CLASSES) for (const line of classUses(text, name)) found.push(`${f}: .${name}: ${line.trim().slice(0, 100)}`);
    }
    expect(found).toEqual([]);
  });

  it("the check can fail, and does not take an id or a data attribute for a class", () => {
    expect(classUses('<button class="btn btn-accent npc-sell-btn">', "npc-sell-btn")).toHaveLength(1);
    expect(classUses('<div id="exchange-filter-bar">', "exchange-filter-bar")).toHaveLength(0);
    expect(classUses('closest("[data-npc-order-id]")', "npc-sell-btn")).toHaveLength(0);
  });

  it("its markup uses no shared legacy component and no inline style, and is a ui-screen", () => {
    const found = LEGACY.flatMap((name) => classUses(MARKET, name).map((l) => `.${name}: ${l.trim().slice(0, 90)}`));
    expect(found).toEqual([]);
    expect(MARKET).not.toMatch(/\sstyle="/);
    expect(MARKET).toMatch(/^<article id="market" class="tab-panel ui-screen">/);
  });

  it.each(RENDERERS)("%s draws no shared legacy component, no inline style and no literal colour", (file) => {
    const text = read(file);
    const found = LEGACY.flatMap((name) => classUses(text, name).map((l) => `.${name}: ${l.trim().slice(0, 90)}`));
    expect(found).toEqual([]);
    expect(text).not.toMatch(/style="/);
    expect(text).not.toMatch(/\.style\.(display|width|color)\s*=/);
    expect(text).not.toMatch(/#[0-9a-fA-F]{6}\b|\brgba?\(/);
  });

  it("every table is a ui-table, so a phone (and a column narrower than its table) shows cards", () => {
    const tables = MARKET.match(/<table\b[^>]*>/g) || [];
    expect(tables.length).toBe(5);
    for (const t of tables) expect(t).toBe('<table class="ui-table">');
    expect(read("public/scripts/views/exchange.js")).toContain('document.querySelectorAll("#market .ui-table").forEach(labelTableCells)');
  });

  it("an empty table shows its empty state and no table (ISP-20): every table's wrap is hidden with no rows", () => {
    const js = read("public/scripts/views/exchange.js");
    expect(js).toContain('filteredEl.parentElement?.querySelector(".ui-table-wrap")');
    expect(js).toContain('sellGrid?.closest(".ui-table-wrap")');
    expect(js).toContain('tradeHistoryTable?.closest(".ui-table-wrap")');
  });

  it("the price chart takes its colours from the tokens and its text size from chartFont", () => {
    const chart = read("public/scripts/priceChart.js");
    expect(chart).toContain('token("--accent")');
    expect(chart).toContain("chartFont(12)");
  });
});
