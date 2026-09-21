import { describe, it, expect } from "vitest";
import {
  transferQuantity, parseTransferRequest, planTransfer, recordTransfer, transferFee, describeLines,
  LOGISTICS_FEE_PER_UNIT, MAX_TRANSFER_LINES, LOGISTICS_HISTORY_LIMIT
} from "../../public/scripts/logistics.js";

// AB#717: the transfer rules the server enforces and the Logistics tab shows.
const STATIONS = { "earth-station-prime": { name: "Earth Station Prime" }, "mars-orbital-dock": { name: "Mars Orbital Dock" } };

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

  it("never repeats the request's text back", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    for (const body of [{ fromStationId: hostile }, { fromStationId: "x", lines: [{ item: hostile, quantity: "abc" }] }]) {
      expect(JSON.stringify(parseTransferRequest(body))).not.toContain(hostile);
    }
  });
});

describe("planTransfer (AB#717)", () => {
  const base = { fromStationId: "mars-orbital-dock", toStationId: "earth-station-prime", credits: 1000, stations: STATIONS,
    inventory: { "mars-orbital-dock": { Silicates: 40, Nickel: 10 } } };

  it("allows a transfer the corporation can make, with its fee", () => {
    expect(planTransfer({ ...base, lines: [{ item: "Silicates", quantity: 40 }, { item: "Nickel", quantity: 10 }] })).toEqual({ ok: true, fee: 100 });
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
    expect(transferFee([{ quantity: 40 }, { quantity: 10 }])).toBe(50 * LOGISTICS_FEE_PER_UNIT);
    expect(transferFee([])).toBe(0);
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
