import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// AB#717: POST /gameplay/transfer-resources moves up to 10 lines, all or nothing, and records each transfer.
async function corpAtEarthWithMarsStock() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = "earth-station-prime";
    state.corp.inventory = { "mars-orbital-dock": { Silicates: 120, Nickel: 40, Carbon: 15 }, "earth-station-prime": { Silicates: 5 } };
    state.corp.finances.credits = 10_000;
    state.corp.finances.expensesByCategory = {};
  });
  const corp = () => getAccountById(account.id).state.corp;
  const transfer = (body) => authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/transfer-resources`).send(body);
  const set = (fn) => mutateAccountState(account.id, (state) => fn(state.corp));
  return { corp, transfer, set };
}
const snapshot = (corp) => JSON.stringify({ inv: corp.inventory, credits: corp.finances.credits, history: corp.logisticsHistory || [] });

describe("bulk transfers (AB#717)", () => {
  it("moves several resources in one request, charges one fee and records it", async () => {
    const { corp, transfer } = await corpAtEarthWithMarsStock();
    const res = await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 100 }, { item: "Nickel", quantity: 40 }, { item: "Carbon", quantity: 5 }] });
    expect(res.status).toBe(200);
    const c = corp();
    expect(c.inventory["mars-orbital-dock"]).toEqual({ Silicates: 20, Carbon: 10 });
    expect(c.inventory["earth-station-prime"]).toMatchObject({ Silicates: 105, Nickel: 40, Carbon: 5 });
    expect(c.finances.credits).toBe(10_000 - 145 * 2);
    expect(c.finances.expensesByCategory["transfer-fees"]).toBe(290);
    expect(c.logisticsHistory[0]).toMatchObject({ from: "mars-orbital-dock", to: "earth-station-prime", fee: 290,
      lines: [{ item: "Silicates", quantity: 100 }, { item: "Nickel", quantity: 40 }, { item: "Carbon", quantity: 5 }] });
    expect(typeof c.logisticsHistory[0].time).toBe("number");
  });

  it("puts the newest transfer first", async () => {
    const { corp, transfer } = await corpAtEarthWithMarsStock();
    expect((await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 1 }] })).status).toBe(200);
    expect((await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Nickel", quantity: 2 }] })).status).toBe(200);
    expect(corp().logisticsHistory.map((h) => h.lines[0].item)).toEqual(["Nickel", "Silicates"]);
  });

  it("moves nothing when any line fails: inventory, credits and history unchanged", async () => {
    const { corp, transfer } = await corpAtEarthWithMarsStock();
    const before = snapshot(corp());
    const res = await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 100 }, { item: "Nickel", quantity: 41 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Mars Orbital Dock holds 40 Nickel; you asked to move 41. Move 40 or fewer.");
    expect(snapshot(corp())).toBe(before);
  });

  it("moves nothing when the fee cannot be paid", async () => {
    const { corp, transfer, set } = await corpAtEarthWithMarsStock();
    set((c) => { c.finances.credits = 100; });
    const before = snapshot(corp());
    const res = await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 120 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("The fee is 240 credits (2 per unit for 120 units); you have 100. Move fewer units or sell goods first.");
    expect(snapshot(corp())).toBe(before);
  });

  it("still takes the single-line body", async () => {
    const { corp, transfer } = await corpAtEarthWithMarsStock();
    expect((await transfer({ fromStationId: "mars-orbital-dock", item: "Carbon", quantity: 15 })).status).toBe(200);
    expect(corp().inventory["earth-station-prime"].Carbon).toBe(15);
  });
});

describe("transfer input is refused before anything changes (AB#717)", () => {
  it.each([
    ["abc", "abc"], ["NaN", "NaN"], ["-5", -5], ["0", 0], ["a missing field", undefined], ["an object", { $gt: 0 }], ["Infinity", "Infinity"]
  ])("quantity %s: 400, and nothing moves", async (_label, quantity) => {
    const { corp, transfer } = await corpAtEarthWithMarsStock();
    const before = snapshot(corp());
    const line = quantity === undefined ? { item: "Silicates" } : { item: "Silicates", quantity };
    const res = await transfer({ fromStationId: "mars-orbital-dock", lines: [line] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Line 1: enter a whole number of at least 1 to move.");
    expect(snapshot(corp())).toBe(before);
  });

  it("floors 2.5 to 2", async () => {
    const { corp, transfer } = await corpAtEarthWithMarsStock();
    expect((await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Nickel", quantity: 2.5 }] })).status).toBe(200);
    expect(corp().inventory["earth-station-prime"].Nickel).toBe(2);
    expect(corp().logisticsHistory[0].lines).toEqual([{ item: "Nickel", quantity: 2 }]);
  });

  it.each([
    ["a station not in data/stations.json", { fromStationId: "pirate-base" }, "That source station does not exist. Choose one from the Logistics tab."],
    ["a prototype key", { fromStationId: "__proto__" }, "That source station does not exist. Choose one from the Logistics tab."],
    ["the station it is docked at", { fromStationId: "earth-station-prime" }, "You are docked at Earth Station Prime, the source. Move goods from another station, or travel first."],
    ["eleven lines", { lines: Array.from({ length: 11 }, (_, i) => ({ item: `Item ${i}`, quantity: 1 })) }, "A transfer carries at most 10 lines; you sent 11. Split it into two transfers."]
  ])("refuses %s, naming the fix, and nothing moves", async (_label, over, error) => {
    const { corp, transfer } = await corpAtEarthWithMarsStock();
    const before = snapshot(corp());
    const res = await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 1 }], ...over });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(error);
    expect(snapshot(corp())).toBe(before);
  });

  it("refuses in transit, naming the fix, and nothing moves", async () => {
    const { corp, transfer, set } = await corpAtEarthWithMarsStock();
    set((c) => { c.currentStationId = null; });
    const before = snapshot(corp());
    const res = await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("You are in transit. Dock at a station, then move goods to it.");
    expect(snapshot(corp())).toBe(before);
    expect(corp().inventory["earth-station-prime"]).toEqual({ Silicates: 5 });
  });
});
