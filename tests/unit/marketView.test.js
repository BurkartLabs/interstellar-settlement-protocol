import { describe, it, expect } from "vitest";
import { marketView, ORDER_BOOK_VIEW_LIMIT } from "../../server/marketView.js";
import { bodyCount } from "../../server/bodyNumber.js";

// Bug #425: the book is capped when read, not when written.
describe("marketView (Bug #425)", () => {
  const book = Array.from({ length: 250 }, (_, i) => ({ id: `o${i}`, sellerAccountId: i % 50 === 49 ? "me" : "them" }));

  it("sends the newest 200 to someone not signed in, and never changes the book", () => {
    const view = marketView({ orderBook: book, npcBuyOrders: [1] });
    expect(ORDER_BOOK_VIEW_LIMIT).toBe(200);
    expect(view.orderBook.map((o) => o.id)).toEqual(book.slice(0, 200).map((o) => o.id));
    expect(view.npcBuyOrders).toEqual([1]);
    expect(book).toHaveLength(250);
  });

  it("adds the caller's own older orders, newest first, without repeating any", () => {
    const view = marketView({ orderBook: book }, "me");
    expect(view.orderBook.slice(200).map((o) => o.id)).toEqual(["o249"]);
    expect(new Set(view.orderBook.map((o) => o.id)).size).toBe(view.orderBook.length);
  });
});

describe("bodyCount (Bug #425)", () => {
  it("is a whole number of at least 1, or null", () => {
    expect(bodyCount(3)).toBe(3);
    expect(bodyCount("2.9")).toBe(2);
    for (const v of ["abc", "NaN", "Infinity", -5, 0, 0.5, null, undefined, "", {}]) expect(bodyCount(v), String(v)).toBeNull();
  });
});
