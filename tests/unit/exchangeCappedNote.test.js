import { describe, it, expect } from "vitest";
import { SELL_ORDERS_SHOWN, MY_LISTINGS_SHOWN, cappedNote } from "../../public/scripts/exchangeView.js";

// AB#1169: Sell Orders showed at most 30 rows and said nothing about the rest; My Active Listings did the same at 50.
describe("cappedNote (AB#1169)", () => {
  it("pins the caps the tables show", () => {
    expect(SELL_ORDERS_SHOWN).toBe(30);
    expect(MY_LISTINGS_SHOWN).toBe(50);
  });

  it("says nothing when every order fits, and names both numbers when some do not", () => {
    expect(cappedNote(29, 29, "player sell orders")).toBe("");
    expect(cappedNote(30, 30, "player sell orders")).toBe("");
    expect(cappedNote(30, 31, "player sell orders")).toBe(
      "Showing 30 of 31 player sell orders. Sort by price or filter by resource to see the rest."
    );
    expect(cappedNote(50, 51, "of your listings")).toContain("Showing 50 of 51 of your listings.");
  });
});
