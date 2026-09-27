import { describe, it, expect } from "vitest";
import {
  DEFAULT_EXCHANGE_VIEW, EXCHANGE_VIEW_KEY, normalizeExchangeView, loadExchangeView, saveExchangeView,
  orderComparator, viewOrders, filteredEmptyHtml
} from "../../public/scripts/exchangeView.js";

// AB#402: sorting and filtering on the Galactic Exchange, client-side only, remembered per viewer.
const order = (id, unitPrice, quantity, createdAt) => ({ id, item: "Silicates", unitPrice, quantity, createdAt });

describe("orderComparator (AB#402)", () => {
  const a = order("a", 20, 5, 1000);
  const b = order("b", 10, 50, 3000);
  const c = order("c", 30, 20, 2000);
  const ids = (list) => list.map((o) => o.id);

  it("sorts newest first by default, and by price and quantity both ways", () => {
    expect(DEFAULT_EXCHANGE_VIEW.sort).toBe("newest");
    expect(ids([a, b, c].sort(orderComparator("newest")))).toEqual(["b", "c", "a"]);
    expect(ids([a, b, c].sort(orderComparator("oldest")))).toEqual(["a", "c", "b"]);
    expect(ids([a, b, c].sort(orderComparator("price-asc")))).toEqual(["b", "a", "c"]);
    expect(ids([a, b, c].sort(orderComparator("price-desc")))).toEqual(["c", "a", "b"]);
    expect(ids([a, b, c].sort(orderComparator("qty-desc")))).toEqual(["b", "c", "a"]);
    expect(ids([a, b, c].sort(orderComparator("qty-asc")))).toEqual(["a", "c", "b"]);
  });

  it("keeps the incoming order for equal prices and for complete ties", () => {
    const p1 = order("p1", 10, 1, 5000);
    const p2 = order("p2", 10, 9, 1000);
    const p3 = order("p3", 10, 4, 3000);
    expect(ids([p1, p2, p3].sort(orderComparator("price-asc")))).toEqual(["p1", "p2", "p3"]);
    expect(ids([p3, p1, p2].sort(orderComparator("price-desc")))).toEqual(["p3", "p1", "p2"]);
    const t1 = order("t1", 10, 1, 1000);
    const t2 = order("t2", 10, 1, 1000);
    expect(ids([t2, t1].sort(orderComparator("newest")))).toEqual(["t2", "t1"]);
  });

  it("puts an order with a missing or unreadable age last, whichever way age is sorted", () => {
    const noAge = order("x", 10, 1, undefined);
    const badAge = order("y", 10, 1, "yesterday");
    for (const sort of ["newest", "oldest"]) {
      expect(ids([noAge, a, badAge, b].sort(orderComparator(sort))).slice(-2), sort).toEqual(["x", "y"]);
    }
  });

  it("reads a standing buy order's quantity from remainingQty", () => {
    const s1 = { id: "s1", unitPrice: 24, remainingQty: 10 };
    const s2 = { id: "s2", unitPrice: 92, remainingQty: 900 };
    expect(ids([s1, s2].sort(orderComparator("qty-desc")))).toEqual(["s2", "s1"]);
  });
});

describe("viewOrders (AB#402)", () => {
  it("filters by resource before sorting, and never changes the list it was given", () => {
    const list = [order("a", 5, 1, 1), { ...order("h", 1, 1, 2), item: "Helium-3" }, order("b", 9, 1, 3)];
    const copy = JSON.stringify(list);
    expect(viewOrders(list, { resource: "Silicates", sort: "price-desc" }).map((o) => o.id)).toEqual(["b", "a"]);
    expect(viewOrders(list, { resource: "", sort: "newest" }).map((o) => o.id)).toEqual(["b", "h", "a"]);
    expect(JSON.stringify(list)).toBe(copy);
  });
});

describe("the view is remembered per viewer, and storage can never break the page (AB#402)", () => {
  const memoryStorage = () => {
    const data = new Map();
    return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
  };

  it("round-trips a chosen view", () => {
    const storage = memoryStorage();
    saveExchangeView(storage, { resource: "Helium-3", type: "standing", sort: "price-desc", sellers: "conglomerate" });
    expect(loadExchangeView(storage)).toEqual({ resource: "Helium-3", type: "standing", sort: "price-desc", sellers: "conglomerate" });
  });

  it("falls back to the defaults when storage is missing, blocked or throws", () => {
    const throwing = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceeded"); } };
    expect(loadExchangeView(undefined)).toEqual(DEFAULT_EXCHANGE_VIEW);
    expect(loadExchangeView(throwing)).toEqual(DEFAULT_EXCHANGE_VIEW);
    expect(() => saveExchangeView(throwing, { type: "sell" })).not.toThrow();
  });

  it("replaces corrupt or hostile stored values with the defaults, field by field", () => {
    const storage = memoryStorage();
    storage.setItem(EXCHANGE_VIEW_KEY, "{not json");
    expect(loadExchangeView(storage)).toEqual(DEFAULT_EXCHANGE_VIEW);
    storage.setItem(EXCHANGE_VIEW_KEY, JSON.stringify({ resource: "x".repeat(500), type: "<script>", sort: "price-asc" }));
    expect(loadExchangeView(storage)).toEqual({ ...DEFAULT_EXCHANGE_VIEW, sort: "price-asc" });
    expect(normalizeExchangeView({ resource: 42, type: "mine", sort: null, sellers: "everyone-else" })).toEqual({ resource: "", type: "mine", sort: "newest", sellers: "all" });
    expect(normalizeExchangeView(["array"])).toEqual(DEFAULT_EXCHANGE_VIEW);
  });
});

describe("filteredEmptyHtml (AB#402)", () => {
  it("names the filter that emptied the table, counts what it hides, offers Clear filters, and escapes the resource", () => {
    const html = filteredEmptyHtml("player sell orders", "Helium-3", 4);
    expect(html).toContain("No player sell orders for <strong>Helium-3</strong>");
    expect(html).toContain("hiding 4 other orders");
    expect(html).toContain('class="ui-button ui-button--secondary" type="button" data-clear-filters'); // ISP-80 (AB#769)
    expect(filteredEmptyHtml("standing buy orders", "Nickel", 1)).toContain("hiding 1 other order.");
    expect(filteredEmptyHtml("x", "<img src=x onerror=alert(1)>", 2)).not.toContain("<img");
  });
});
