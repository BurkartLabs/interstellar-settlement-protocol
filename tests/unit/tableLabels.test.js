import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { labelTableCells } from "../../public/scripts/tableLabels.js";

// AB#1055: at phone width the Exchange's action tables are shown one row per card, each cell carrying its column's
// name, because a six-column table does not fit 280 px and the Buy and Create Listing buttons were off to the right.
// The names come from the table's own header, so they cannot drift from it.

/** The smallest table object labelTableCells needs: querySelectorAll for header cells and rows, children, setAttribute. */
function fakeTable(headers, rows) {
  const cell = () => { const attrs = {}; return { attrs, setAttribute: (k, v) => { attrs[k] = v; } }; };
  const trs = rows.map((n) => ({ children: Array.from({ length: n }, cell) }));
  return {
    trs,
    querySelectorAll: (sel) => (sel === "thead th" ? headers.map((t) => ({ textContent: `  ${t}\n` })) : sel === "tbody tr" ? trs : []),
  };
}

describe("labelTableCells (AB#1055)", () => {
  it("gives every body cell the name of its column", () => {
    const t = fakeTable(["Item", "Available", "Unit Price", "Seller", "Buy Qty", "Action"], [6, 6]);
    labelTableCells(t);
    expect(t.trs[1].children.map((c) => c.attrs["data-label"])).toEqual(["Item", "Available", "Unit Price", "Seller", "Buy Qty", "Action"]);
  });
  it("leaves a cell with no header unlabelled rather than guessing", () => {
    const t = fakeTable(["Item"], [2]);
    labelTableCells(t);
    expect(t.trs[0].children[1].attrs["data-label"]).toBeUndefined();
  });
  it("does nothing to an empty or missing table", () => {
    expect(() => labelTableCells(fakeTable(["Item"], []))).not.toThrow();
    expect(() => labelTableCells(null)).not.toThrow();
  });
});

describe("the tables that stack at phone width (AB#1055)", () => {
  const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");
  it("the Exchange tables with an action in every row are design-system tables, cards below 768px (ISP-80, AB#769)", () => {
    for (const body of ["exchange-buy-table", "market-sell-grid", "npc-buy-table", "my-sell-orders-table"]) {
      const table = html.slice(html.lastIndexOf("<table", html.indexOf(`id="${body}"`)), html.indexOf(`id="${body}"`));
      expect(table, body).toMatch(/^<table class="ui-table( exchange__standing-table)?">/); // Bug #4870's compact card
    }
  });
  it("are stacked only inside the phone block", () => {
    const phone = css.split("/* ─── Phone: panels fill the screen (AB#1055) ─── */")[1] || "";
    expect(phone).toMatch(/\.data-table--stack\s+thead\s*{[^}]*display:\s*none/);
    expect(phone).toMatch(/\.data-table--stack td::before\s*{[^}]*content:\s*attr\(data-label\)/);
    expect(css.split("/* ─── Phone: panels fill the screen (AB#1055) ─── */")[0]).not.toMatch(/data-table--stack/);
  });
});
