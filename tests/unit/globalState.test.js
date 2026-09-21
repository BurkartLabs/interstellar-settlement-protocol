import { describe, it, expect } from "vitest";
import { freshGlobalState, normalizeGlobalState, CHAT_CHANNELS } from "../../server/gameState.js";

// Bug #588 (and #574): the shape of the global state is tested where it is made, not by reading data/state.json,
// which is gitignored runtime output. A fresh install used to get the bare seed with no market at all: no order book
// and no NPC standing buy orders, because the market setup ran only when a state file already existed.
const NPC_ITEMS = ["Silicates", "Helium-3", "Nickel", "Titanium", "Carbon", "Rare Earths"];

describe("the global state a fresh install starts with (Bug #588, #574)", () => {
  const state = freshGlobalState();

  it("has a market with an empty order book and the six standing buy orders", () => {
    expect(state.market.orderBook).toEqual([]);
    expect(state.market.npcBuyOrders.map((o) => o.item)).toEqual(NPC_ITEMS);
    const silicates = state.market.npcBuyOrders.find((o) => o.item === "Silicates");
    expect(silicates).toMatchObject({ id: "npc-buy-silicates-daily", unitPrice: 24, totalQtyPerDay: 1000000, remainingQty: 1000000 });
  });

  it("has a chat log with every channel", () => {
    expect(Object.keys(state.chatLog).sort()).toEqual([...CHAT_CHANNELS].sort());
  });
});

describe("normalizeGlobalState repairs an older state and changes nothing it does not need to (Bug #588)", () => {
  it("adds what an old save lacks and keeps what it has", () => {
    const old = { market: { npcBuyOrders: [{ id: "npc-buy-silicates-daily", item: "Silicates", unitPrice: 24, totalQtyPerDay: 1000000, remainingQty: 5, lastResetDate: "2026-09-20" }] } };
    const state = normalizeGlobalState(old);
    expect(state.market.orderBook).toEqual([]);
    expect(state.market.npcBuyOrders).toHaveLength(6);
    expect(state.market.npcBuyOrders.find((o) => o.id === "npc-buy-silicates-daily").remainingQty).toBe(5);
  });

  it("is the same applied twice as once", () => {
    const once = normalizeGlobalState(freshGlobalState());
    expect(JSON.parse(JSON.stringify(normalizeGlobalState(structuredClone(once))))).toEqual(JSON.parse(JSON.stringify(once)));
  });
});
