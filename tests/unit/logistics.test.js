import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { navigationFor } from "../../public/scripts/navigation.js";
import {
  transferQuantity, parseTransferRequest, planTransfer, recordTransfer, transferFee, describeLines,
  stationHops, feePerUnit, transitMinutes, describeHops, MAX_TRANSFER_LINES, LOGISTICS_HISTORY_LIMIT
} from "../../public/scripts/logistics.js";

// AB#717: the transfer rules the server enforces and the Logistics tab shows.
// ISP-112 (AB#804): jumps are counted on data/systems.json's routes.
const NAVIGATION = navigationFor(JSON.parse(fs.readFileSync(new URL("../../data/systems.json", import.meta.url), "utf8")));

const STATIONS = {
  "earth-station-prime": { name: "Earth Station Prime", systemId: "sol" },
  "mars-orbital-dock": { name: "Mars Orbital Dock", systemId: "sol" },
  "kestrel-platform": { name: "Kestrel Platform", systemId: "epsilon-eridani" }
};
// AB#718: the rates as data/economy.json holds them. 2 a unit within a system (the old flat fee), 3 more a jump.
const RATES = { sameSystemFeePerUnit: 2, perJumpFeePerUnit: 3, sameSystemTransitMinutes: 30, perJumpTransitMinutes: 120 };

describe("transferQuantity (AB#717)", () => {
  it.each([
    ["abc", null], [NaN, null], ["NaN", null], [-5, null], [0, null], [undefined, null], [null, null], ["", null],
    [Infinity, null], [true, null], [{}, null], [[3], null], [0.5, null],
    [2.5, null], ["2.5", null], [1, 1], ["7", 7], [60, 60]
  ])("%s gives %s", (input, expected) => {
    expect(transferQuantity(input)).toBe(expected);
  });
});

describe("parseTransferRequest (AB#717)", () => {
  it("reads up to 10 lines and merges an item named twice", () => {
    const r = parseTransferRequest({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 60 }, { item: "Nickel", quantity: "5" }, { item: "Silicates", quantity: 40 }] });
    expect(r).toEqual({ ok: true, fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 100 }, { item: "Nickel", quantity: 5 }] });
  });

  it("still reads the single-line body the old client sent", () => {
    expect(parseTransferRequest({ fromStationId: "mars-orbital-dock", item: "Silicates", quantity: 3 }))
      .toEqual({ ok: true, fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 3 }] });
  });

  it.each([
    [{}, "Choose the station to move goods from."],
    [{ fromStationId: "mars-orbital-dock" }, "Add at least one item to move."],
    [{ fromStationId: "mars-orbital-dock", lines: [] }, "Add at least one item to move."],
    [{ fromStationId: "mars-orbital-dock", lines: [{ quantity: 1 }] }, "Line 1 has no item. Pick one from the station's list."],
    [{ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 1 }, { item: "Nickel", quantity: "abc" }] }, "Line 2: enter a whole number of at least 1 to move."],
    [{ fromStationId: "mars-orbital-dock", item: "Silicates" }, "Line 1: enter a whole number of at least 1 to move."]
  ])("refuses %j with a message that names the fix", (body, error) => {
    expect(parseTransferRequest(body)).toEqual({ ok: false, error });
  });

  it(`refuses more than ${MAX_TRANSFER_LINES} lines, and says to split`, () => {
    const lines = Array.from({ length: MAX_TRANSFER_LINES + 1 }, (_, i) => ({ item: `Item ${i}`, quantity: 1 }));
    expect(parseTransferRequest({ fromStationId: "mars-orbital-dock", lines }).error).toMatch(/at most 10 lines; you sent 11\. Split it into two transfers\./);
    expect(parseTransferRequest({ fromStationId: "mars-orbital-dock", lines: lines.slice(0, 10) }).ok).toBe(true);
  });

  // AB#1170: only a blank item is missing. One too long to be any item is still an item, and planTransfer answers it
  // the way it answers any item the station does not hold.
  it.each([41, 65, 10_000])("reads an item of %i characters as an item the station does not hold", (length) => {
    const parsed = parseTransferRequest({ fromStationId: "mars-orbital-dock", lines: [{ item: "x".repeat(length), quantity: 1 }] });
    expect(parsed.ok).toBe(true);
    expect(planTransfer({ ...parsed, toStationId: "earth-station-prime", credits: 1000, stations: STATIONS, rates: RATES, navigation: NAVIGATION, inventory: { "mars-orbital-dock": { Silicates: 40 } } }))
      .toEqual({ ok: false, error: "Mars Orbital Dock holds none of that item. Pick one from its list." });
  });

  it("never repeats the request's text back", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    for (const body of [{ fromStationId: hostile }, { fromStationId: "x", lines: [{ item: hostile, quantity: "abc" }] }]) {
      expect(JSON.stringify(parseTransferRequest(body))).not.toContain(hostile);
    }
  });
});

describe("planTransfer (AB#717)", () => {
  const base = { fromStationId: "mars-orbital-dock", toStationId: "earth-station-prime", credits: 1000, stations: STATIONS, rates: RATES, navigation: NAVIGATION,
    inventory: { "mars-orbital-dock": { Silicates: 40, Nickel: 10 } } };

  it("allows a transfer the corporation can make, with its fee", () => {
    expect(planTransfer({ ...base, lines: [{ item: "Silicates", quantity: 40 }, { item: "Nickel", quantity: 10 }] })).toEqual({ ok: true, fee: 100, hops: 0 });
  });

  it.each([
    ["an unknown source", { fromStationId: "nowhere" }, "That source station does not exist. Choose one from the Logistics tab."],
    ["a prototype key as the source", { fromStationId: "__proto__" }, "That source station does not exist. Choose one from the Logistics tab."],
    ["no destination (in transit)", { toStationId: null }, "You are in transit. Dock at a station, then move goods to it."],
    ["the same station", { toStationId: "mars-orbital-dock" }, "You are docked at Mars Orbital Dock, the source. Move goods from another station, or travel first."],
    ["an item not held there", { lines: [{ item: "Carbon", quantity: 1 }] }, "Mars Orbital Dock holds none of that item. Pick one from its list."],
    ["more than is held", { lines: [{ item: "Silicates", quantity: 60 }] }, "Mars Orbital Dock holds 40 Silicates; you asked to move 60. Move 40 or fewer."],
    ["a fee that cannot be paid", { credits: 50, lines: [{ item: "Silicates", quantity: 40 }] }, "The fee is 80 credits (2 per unit for 40 units); you have 50. Move fewer units or sell goods first."]
  ])("refuses %s, naming the fix", (_label, over, error) => {
    expect(planTransfer({ ...base, lines: [{ item: "Silicates", quantity: 1 }], ...over })).toEqual({ ok: false, error });
  });

  it("refuses the whole request when any one line cannot be moved", () => {
    const r = planTransfer({ ...base, lines: [{ item: "Silicates", quantity: 40 }, { item: "Nickel", quantity: 11 }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/holds 10 Nickel; you asked to move 11/);
  });
});

describe("the fee, the history and the words (AB#717)", () => {
  it("charges the per-unit fee on every unit, in one function", () => {
    expect(transferFee(RATES, 0, [{ quantity: 40 }, { quantity: 10 }])).toBe(50 * 2);
    expect(transferFee(RATES, 3, [{ quantity: 40 }, { quantity: 10 }])).toBe(50 * 11);
    expect(transferFee(RATES, 2, [])).toBe(0);
  });

  it(`keeps the last ${LOGISTICS_HISTORY_LIMIT} transfers, newest first`, () => {
    let h = [];
    for (let i = 1; i <= LOGISTICS_HISTORY_LIMIT + 5; i += 1) h = recordTransfer(h, { time: i, from: "a", to: "b", lines: [{ item: "Silicates", quantity: i }], fee: 2 * i });
    expect(h).toHaveLength(LOGISTICS_HISTORY_LIMIT);
    expect(h[0]).toEqual({ time: LOGISTICS_HISTORY_LIMIT + 5, from: "a", to: "b", lines: [{ item: "Silicates", quantity: LOGISTICS_HISTORY_LIMIT + 5 }], fee: 2 * (LOGISTICS_HISTORY_LIMIT + 5) });
    expect(h.at(-1).time).toBe(6);
  });

  it("describes a transfer's lines", () => {
    expect(describeLines([{ item: "Silicates", quantity: 1200 }, { item: "Nickel", quantity: 40 }])).toBe("1,200 Silicates, 40 Nickel");
  });
});

describe("the fee and the time grow with distance (AB#718)", () => {
  it("counts jumps between the stations' systems: none within one system, null for a station it does not know", () => {
    expect(stationHops(STATIONS, "mars-orbital-dock", "earth-station-prime", NAVIGATION)).toBe(0);
    expect(stationHops(STATIONS, "kestrel-platform", "earth-station-prime", NAVIGATION)).toBe(3);
    expect(stationHops(Object.values(STATIONS).map((s, i) => ({ ...s, id: Object.keys(STATIONS)[i] })), "kestrel-platform", "mars-orbital-dock", NAVIGATION)).toBe(3);
    for (const id of ["nowhere", "__proto__", "constructor", undefined, 7]) expect(stationHops(STATIONS, id, "earth-station-prime", NAVIGATION)).toBeNull();
  });

  it("prices and times a route from the rates: in-system flat, then per jump", () => {
    expect([0, 1, 2, 3].map((h) => feePerUnit(RATES, h))).toEqual([2, 5, 8, 11]);
    expect([0, 1, 2, 3].map((h) => transitMinutes(RATES, h))).toEqual([30, 150, 270, 390]);
    expect([0, 1, 3].map(describeHops)).toEqual(["in system", "1 jump", "3 jumps"]);
  });

  it("charges a transfer across systems by its jumps, and says so when it cannot be paid", () => {
    const from = { fromStationId: "kestrel-platform", toStationId: "earth-station-prime", stations: STATIONS, rates: RATES, navigation: NAVIGATION, inventory: { "kestrel-platform": { Silicates: 100 } } };
    expect(planTransfer({ ...from, credits: 5000, lines: [{ item: "Silicates", quantity: 100 }] })).toEqual({ ok: true, fee: 1100, hops: 3 });
    expect(planTransfer({ ...from, credits: 1000, lines: [{ item: "Silicates", quantity: 100 }] })).toEqual({
      ok: false, error: "The fee is 1,100 credits (11 per unit for 100 units, 3 jumps); you have 1,000. Move fewer units or sell goods first."
    });
  });
});
