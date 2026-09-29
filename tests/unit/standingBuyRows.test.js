import { describe, it, expect } from "vitest";
import { standingBuyNote, standingBuyRows, standingBuyToggle } from "../../public/scripts/exchangeView.js";

// AB#4710: the Standing orders page lists the buyers for what the player holds at the station when All is picked, the
// rest one press away; a resource or tier filter narrows as before; Show all lists every order in the chosen sort.

const orders = ["Silicates", "Aerogel", "Nickel", "Titanium", "Carbon"].map((item, i) => ({ id: `npc-${i}`, item }));
const held = { Silicates: 1800, Nickel: 240, Titanium: 0 };

describe("AB#4710 standing buy orders, short by default", () => {
  it("with All picked, only the buyers for what the station holds (a zero quantity is not held)", () => {
    const s = standingBuyRows(orders, { view: { resource: "", tier: "" }, held });
    expect(s.rows.map((o) => o.item)).toEqual(["Silicates", "Nickel"]);
    expect(s).toMatchObject({ total: 5, held: 2, collapsed: true, filtering: false });
    expect(standingBuyNote(s, "Earth Station Prime")).toBe("Showing the 2 buyers for what you hold at Earth Station Prime.");
    expect(standingBuyToggle(s)).toBe("Show all 5 buyers");
  });

  it("Show all lists every order, in the order it was given (the viewer's sort), and offers the way back", () => {
    const s = standingBuyRows(orders, { view: {}, held, showAll: true });
    expect(s.rows).toEqual(orders);
    expect(s.collapsed).toBe(false);
    expect(standingBuyNote(s)).toBe("");
    expect(standingBuyToggle(s)).toBe("Show only what you hold here");
  });

  it("a resource or a tier filter lists every order it leaves, held or not, with no toggle", () => {
    for (const view of [{ resource: "Titanium" }, { tier: "2" }]) {
      const s = standingBuyRows([orders[3]], { view, held });
      expect(s.rows.map((o) => o.item)).toEqual(["Titanium"]);
      expect(s).toMatchObject({ collapsed: false, filtering: true });
      expect(standingBuyToggle(s)).toBe("");
      expect(standingBuyNote(s)).toBe("");
    }
  });

  it("holding nothing a buyer wants says so, and every buyer is still one press away", () => {
    const s = standingBuyRows(orders, { view: {}, held: {} });
    expect(s.rows).toEqual([]);
    expect(standingBuyNote(s, "Luna Gateway")).toBe("You hold nothing these buyers want at Luna Gateway.");
    expect(standingBuyToggle(s)).toBe("Show all 5 buyers");
  });

  it("no toggle when everything is already shown, or there are no buyers", () => {
    const all = standingBuyRows(orders.slice(0, 1), { view: {}, held });
    expect(all.rows).toHaveLength(1);
    expect(standingBuyToggle(all)).toBe(""); // the one buyer is held: nothing more to show
    expect(standingBuyToggle(standingBuyRows([], { view: {}, held }))).toBe("");
    expect(standingBuyNote({ collapsed: true, held: 1, total: 1 })).toBe("Showing the 1 buyer for what you hold at this station.");
  });
});
