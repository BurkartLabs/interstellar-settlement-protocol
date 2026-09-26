import { describe, it, expect } from "vitest";
import { freshGlobalState, normalizeGlobalState, CHAT_CHANNELS, storedCombatReportSummary } from "../../server/gameState.js";

// Bug #588 (and #574): the shape of the global state is tested where it is made, not by reading data/state.json,
// which is gitignored runtime output. A fresh install used to get the bare seed with no market at all: no order book
// and no NPC standing buy orders, because the market setup ran only when a state file already existed.
const NPC_ITEMS = ["Silicates", "Helium-3", "Nickel", "Titanium", "Carbon", "Rare Earths"];
// AB#2341: standing bids for six products too; no NPC corporation sells them (no asks).
const BID_ITEMS = [...NPC_ITEMS, "Aerogel", "Quantum Insulators", "Armour Plating", "Precision Frames", "Carbon Fibre Sheets", "Graphene Lattice",
  // AB#830: the Fuel track's raw items and products, all bought by the Lunar Helium Consortium.
  "Deuterium", "Water Ice", "Hydrogen", "Plasma Conduits", "Dark-Matter Capacitors", "Fusion Pellets", "Cryogenic Coolant",
  // AB#832: the Rare Metals track, all bought by Synthorium Trading House.
  "Thorium", "Cobalt", "Sensor Arrays", "Catalyst Substrates", "Rare-Earth Magnets", "Thorium Fuel Rods"];

describe("the global state a fresh install starts with (Bug #588, #574)", () => {
  const state = freshGlobalState();

  it("has a market with no player listings, the six NPC asks, and every standing buy order in data/economy.json", () => {
    expect(state.market.orderBook.filter((o) => !o.npc)).toEqual([]);
    expect(state.market.orderBook.filter((o) => o.npc).map((o) => o.id).sort()).toEqual(NPC_ITEMS.map((i) => `npc-sell-${i.toLowerCase().replace(/\s+/g, "-")}`).sort()); // ISP-122 (AB#815)
    expect(state.market.npcBuyOrders.map((o) => o.item)).toEqual(BID_ITEMS);
    const silicates = state.market.npcBuyOrders.find((o) => o.item === "Silicates");
    // ISP-87: the quota is a day's work for a working extractor, not for a planet, and the order carries the base
    // price it recovers towards and what has been sold into it today.
    expect(silicates).toMatchObject({ id: "npc-buy-silicates-daily", unitPrice: 24, basePrice: 24, soldToday: 0, totalQtyPerDay: 7000, remainingQty: 7000 });
  });

  it("has a chat log with every channel", () => {
    expect(Object.keys(state.chatLog).sort()).toEqual([...CHAT_CHANNELS].sort());
  });
});

describe("normalizeGlobalState repairs an older state and changes nothing it does not need to (Bug #588)", () => {
  it("adds what an old save lacks and keeps what it has", () => {
    const old = { market: { npcBuyOrders: [{ id: "npc-buy-silicates-daily", item: "Silicates", unitPrice: 24, totalQtyPerDay: 1000000, remainingQty: 5, lastResetDate: "2026-09-20" }] } };
    const state = normalizeGlobalState(old);
    expect(state.market.orderBook.filter((o) => !o.npc)).toEqual([]);
    expect(state.market.orderBook.filter((o) => o.npc)).toHaveLength(6); // ISP-122 (AB#815): added where missing
    expect(state.market.npcBuyOrders).toHaveLength(BID_ITEMS.length); // AB#2341, AB#830: the new bids added where missing
    expect(state.market.npcBuyOrders.find((o) => o.id === "npc-buy-silicates-daily").remainingQty).toBe(5);
  });

  it("is the same applied twice as once", () => {
    const once = normalizeGlobalState(freshGlobalState());
    expect(JSON.parse(JSON.stringify(normalizeGlobalState(structuredClone(once))))).toEqual(JSON.parse(JSON.stringify(once)));
  });
});

describe("combat reports left by the removed simulate route are reported, not deleted (Bug #1036)", () => {
  it("counts them and their size, and names nothing from inside them", () => {
    expect(storedCombatReportSummary({ combatReports: [] })).toBeNull();
    expect(storedCombatReportSummary({})).toBeNull();
    const summary = storedCombatReportSummary({ combatReports: [{ attackerName: "x".repeat(1000) }, { attackerName: "<b>" }] });
    expect(summary.count).toBe(2);
    expect(summary.bytes).toBeGreaterThan(1000);
    expect(JSON.stringify(summary)).not.toContain("xxx");
    expect(JSON.stringify(summary)).not.toContain("<b>");
  });
});
