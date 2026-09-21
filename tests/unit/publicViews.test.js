import { describe, it, expect } from "vitest";
import { forumsView, orderView, postView, publicName, UNNAMED_CORPORATION } from "../../server/publicViews.js";
import { marketView } from "../../server/marketView.js";

// Bugs #1134 and #1145: shared state goes to clients without account ids.
describe("forumsView (Bug #1134)", () => {
  const stored = {
    categories: ["General"],
    threads: [{
      id: "t1", title: "Prices", author: "Alpha", authorAccountId: "acc-a", likes: 2, likedBy: ["acc-b", "acc-c"],
      replies: [{ id: "r1", author: "Beta", authorAccountId: "acc-b", content: "24", likes: 1, likedBy: ["acc-a"] }]
    }]
  };

  it("sends no account ids, and tells each viewer only whether they liked a post", () => {
    const asB = forumsView(stored, "acc-b");
    expect(JSON.stringify(asB)).not.toMatch(/acc-/);
    expect(asB.threads[0]).toMatchObject({ author: "Alpha", likes: 2, likedByMe: true });
    expect(asB.threads[0].replies[0]).toMatchObject({ author: "Beta", likes: 1, likedByMe: false });
    expect(forumsView(stored, "acc-a").threads[0].replies[0].likedByMe).toBe(true);
    expect(forumsView(stored).threads[0].likedByMe).toBe(false);
    expect(forumsView(stored).categories).toEqual(["General"]);
  });

  it("never changes what is stored", () => {
    forumsView(stored, "acc-b");
    expect(stored.threads[0].likedBy).toEqual(["acc-b", "acc-c"]);
    expect(stored.threads[0].replies[0].authorAccountId).toBe("acc-b");
  });

  it("counts likes from who liked, and a post with no likes list has none", () => {
    expect(postView({ id: "p", author: "A", likes: 5 }, "acc-a")).toMatchObject({ likes: 0, likedByMe: false });
  });

  it("does not show an email address a post was once signed with", () => {
    expect(postView({ author: "someone@example.com" }).author).toBe(UNNAMED_CORPORATION);
    expect(publicName("")).toBe(UNNAMED_CORPORATION);
    expect(publicName("  Helios Mining  ")).toBe("Helios Mining");
    expect(publicName("R&D @ Ceres")).toBe("R&D @ Ceres");
  });
});

describe("orderView and marketView (Bug #1145)", () => {
  it("marks the viewer's own listing and drops every seller's account id", () => {
    const order = { id: "o1", type: "sell", item: "Silicates", seller: "Alpha", sellerAccountId: "acc-a" };
    expect(orderView(order, "acc-a")).toEqual({ id: "o1", type: "sell", item: "Silicates", seller: "Alpha", mine: true });
    expect(orderView(order, "acc-b").mine).toBe(false);
    expect(orderView(order).mine).toBe(false);
    expect(orderView({ id: "o2", seller: "x@y.io", sellerAccountId: null }, null)).toMatchObject({ seller: UNNAMED_CORPORATION, mine: false });
  });

  it("marketView sends the book with no account ids, signed in or not", () => {
    const market = { orderBook: [{ id: "o1", seller: "Alpha", sellerAccountId: "acc-a" }], npcBuyOrders: [{ id: "n1" }] };
    for (const viewer of [null, "acc-a", "acc-b"]) expect(JSON.stringify(marketView(market, viewer))).not.toMatch(/acc-/);
    expect(market.orderBook[0].sellerAccountId).toBe("acc-a");
  });
});
