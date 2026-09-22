// Column names on table cells, for tables that stack into one card per row at phone width (AB#1055).
//
// A stacked row has no header above it, so each cell shows its column's name through CSS (td::before, content:
// attr(data-label)). The names are read from the table's own header after every render, so they cannot drift.

/** Label every body cell of `table` with the text of its column's header cell. */
export function labelTableCells(table) {
  if (!table) return;
  const headers = [...table.querySelectorAll("thead th")].map((th) => String(th.textContent || "").trim());
  for (const tr of table.querySelectorAll("tbody tr")) {
    [...tr.children].forEach((td, i) => {
      if (headers[i]) td.setAttribute("data-label", headers[i]);
    });
  }
}
