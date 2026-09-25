import { describe, it, expect, vi, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, listAccountNotifications } from "../../server/gameState.js";

// AB#717: POST /gameplay/transfer-resources moves up to 10 lines, all or nothing, and records each transfer.
// AB#985 (ISP-278): dispatch debits the origin and the fee at once, but delivery is a shipment that arrives on a
// later tick (30 min in-system here) rather than landing on the same request.
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
  return { corp, transfer, set, accountId: account.id, accessToken };
}
const snapshot = (corp) => JSON.stringify({ inv: corp.inventory, credits: corp.finances.credits, history: corp.logisticsHistory || [], shipments: corp.shipments || [] });

describe("bulk transfers (AB#717)", () => {
  it("debits the origin and the fee once, and dispatches a shipment; nothing is at the destination yet", async () => {
    const { corp, transfer } = await corpAtEarthWithMarsStock();
    const res = await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 100 }, { item: "Nickel", quantity: 40 }, { item: "Carbon", quantity: 5 }] });
    expect(res.status).toBe(200);
    const c = corp();
    expect(c.inventory["mars-orbital-dock"]).toEqual({ Silicates: 20, Carbon: 10 });
    // Nothing has arrived: the goods are in neither inventory (ISP-278 acceptance #1).
    expect(c.inventory["earth-station-prime"]).toEqual({ Silicates: 5 });
    expect(c.finances.credits).toBe(10_000 - 145 * 2);
    expect(c.finances.expensesByCategory["transfer-fees"]).toBe(290);
    expect(c.logisticsHistory || []).toEqual([]); // recorded on arrival, not on dispatch
    expect(c.shipments).toHaveLength(1);
    expect(c.shipments[0]).toMatchObject({
      fromStationId: "mars-orbital-dock", toStationId: "earth-station-prime", fee: 290, status: "in-transit",
      lines: [{ item: "Silicates", quantity: 100 }, { item: "Nickel", quantity: 40 }, { item: "Carbon", quantity: 5 }]
    });
    expect(typeof c.shipments[0].id).toBe("string");
    expect(c.shipments[0].arrivesAt - c.shipments[0].dispatchedAt).toBe(30 * 60_000); // same system: sameSystemTransitMinutes
    expect(res.body.shipment).toMatchObject({ id: c.shipments[0].id, fee: 290 });
  });

  it("puts the newest dispatch first", async () => {
    const { corp, transfer } = await corpAtEarthWithMarsStock();
    expect((await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 1 }] })).status).toBe(200);
    expect((await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Nickel", quantity: 2 }] })).status).toBe(200);
    expect(corp().shipments.map((s) => s.lines[0].item)).toEqual(["Nickel", "Silicates"]);
  });

  it("moves nothing when any line fails: inventory, credits and shipments unchanged", async () => {
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
    expect(corp().inventory["mars-orbital-dock"].Carbon).toBeUndefined();
    expect(corp().shipments[0]).toMatchObject({ lines: [{ item: "Carbon", quantity: 15 }] });
  });
});

describe("transfer input is refused before anything changes (AB#717)", () => {
  it.each([
    ["abc", "abc"], ["NaN", "NaN"], ["-5", -5], ["0", 0], ["2.5", 2.5], ["a missing field", undefined], ["an object", { $gt: 0 }], ["Infinity", "Infinity"]
  ])("quantity %s: 400, and nothing moves", async (_label, quantity) => {
    const { corp, transfer } = await corpAtEarthWithMarsStock();
    const before = snapshot(corp());
    const line = quantity === undefined ? { item: "Silicates" } : { item: "Silicates", quantity };
    const res = await transfer({ fromStationId: "mars-orbital-dock", lines: [line] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Line 1: enter a whole number of at least 1 to move.");
    expect(snapshot(corp())).toBe(before);
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

  it("ignores a client-supplied arrival time: the server derives it from the two stations", async () => {
    const { corp, transfer } = await corpAtEarthWithMarsStock();
    const res = await transfer({
      fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 1 }],
      arrivesAt: Date.now(), arrivalTime: 0, arrivesInMinutes: 0
    });
    expect(res.status).toBe(200);
    const shipment = corp().shipments[0];
    expect(shipment.arrivesAt - shipment.dispatchedAt).toBe(30 * 60_000);
  });
});

describe("shipment delivery (ISP-278, AB#985)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not deliver before the arrival time, and delivers exactly once at or after it (idempotence)", async () => {
    const { shipmentTick } = await getApp();
    const { corp, transfer, accountId } = await corpAtEarthWithMarsStock();
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 100 }] });
    const shipmentId = corp().shipments[0].id;

    vi.setSystemTime(start + 29 * 60_000); // one minute short of arrival
    await shipmentTick();
    expect(corp().inventory["earth-station-prime"]).toEqual({ Silicates: 5 });
    expect(corp().shipments.find((s) => s.id === shipmentId)?.status).toBe("in-transit");

    vi.setSystemTime(start + 30 * 60_000); // exactly on arrival
    await shipmentTick();
    expect(corp().inventory["earth-station-prime"]).toEqual({ Silicates: 105 });
    expect(corp().logisticsHistory[0]).toMatchObject({ from: "mars-orbital-dock", to: "earth-station-prime", fee: 200, lines: [{ item: "Silicates", quantity: 100 }] });
    expect(corp().shipments.find((s) => s.id === shipmentId)).toBeUndefined(); // delivered, dropped from the in-transit list

    // A second tick after delivery must not credit the destination again.
    await shipmentTick();
    expect(corp().inventory["earth-station-prime"]).toEqual({ Silicates: 105 });
    expect(corp().logisticsHistory).toHaveLength(1);
    void accountId;
  });

  it("fires a notification on arrival", async () => {
    const { shipmentTick } = await getApp();
    const { corp, transfer, accountId } = await corpAtEarthWithMarsStock();
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 10 }] });
    vi.setSystemTime(start + 30 * 60_000);
    await shipmentTick();
    const { notifications } = listAccountNotifications(accountId);
    expect(notifications.some((n) => n.type === "logistics" && /arrived/i.test(n.body))).toBe(true);
    void corp;
  });

  it("survives a server restart: a shipment reloaded from the accounts snapshot still arrives", async () => {
    const { shipmentTick } = await getApp();
    const { writeAccountsSnapshotToDiskNow, accountsStore, loadAccountsSnapshotFromDisk } = await import("../../server/game/store.js");
    const { corp, transfer, accountId } = await corpAtEarthWithMarsStock();
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 30 }] });

    // Serialize the live state to disk, exactly as a running server does on its debounce.
    await writeAccountsSnapshotToDiskNow();
    const onDisk = loadAccountsSnapshotFromDisk();
    const dehydrated = onDisk.accounts[accountId];
    expect(dehydrated.state.corp.shipments).toHaveLength(1);
    expect(dehydrated.state.corp.shipments[0]).toMatchObject({ fromStationId: "mars-orbital-dock", toStationId: "earth-station-prime", status: "in-transit" });

    // Simulate a restart: replace the live in-memory account with exactly what a fresh process would have loaded
    // from disk (loadAccountsStore does this at boot), then let time pass and tick — nothing but the reloaded
    // JSON drives delivery from here.
    accountsStore.accounts[accountId] = dehydrated;
    vi.setSystemTime(start + 30 * 60_000);
    await shipmentTick();

    expect(corp().inventory["earth-station-prime"]).toEqual({ Silicates: 35 });
    expect(corp().shipments).toEqual([]);
  });

  it("holds a shipment rather than losing or delivering it when the destination is no longer a real station", async () => {
    const { shipmentTick } = await getApp();
    const { corp, set, accountId } = await corpAtEarthWithMarsStock();
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    set((c) => {
      c.shipments = [{
        id: "shp-decommissioned-test", fromStationId: "mars-orbital-dock", toStationId: "decommissioned-station",
        lines: [{ item: "Silicates", quantity: 50 }], fee: 100, dispatchedAt: start, arrivesAt: start + 1000, status: "in-transit"
      }];
    });
    vi.setSystemTime(start + 2000);
    await shipmentTick();

    const c = corp();
    expect(c.inventory["decommissioned-station"]).toBeUndefined(); // nothing destroyed, nothing conjured either
    expect(c.shipments).toHaveLength(1);
    expect(c.shipments[0]).toMatchObject({ id: "shp-decommissioned-test", status: "held" });
    const { notifications } = listAccountNotifications(accountId);
    expect(notifications.some((n) => n.type === "logistics" && /held|could not be delivered/i.test(n.body))).toBe(true);
  });
});

describe("shipments are scoped to their own corporation (ISP-278, AB#985)", () => {
  it("lists only the caller's own shipments, and another account's shipment id returns 404", async () => {
    const { app } = await getApp();
    const { corp: corpA, transfer: transferA, accountId: accountIdA, accessToken: tokenA } = await corpAtEarthWithMarsStock();
    const { account: accountB, accessToken: tokenB } = await registerAccount(app);
    await transferA({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 1 }] });
    const shipmentIdA = corpA().shipments[0].id;

    const ownList = await authed(app, tokenA).get(`/api/accounts/${accountIdA}/gameplay/shipments`);
    expect(ownList.status).toBe(200);
    expect(ownList.body.shipments).toHaveLength(1);
    const ownFetch = await authed(app, tokenA).get(`/api/accounts/${accountIdA}/gameplay/shipments/${shipmentIdA}`);
    expect(ownFetch.status).toBe(200);
    expect(ownFetch.body.id).toBe(shipmentIdA);

    const otherList = await authed(app, tokenB).get(`/api/accounts/${accountB.id}/gameplay/shipments`);
    expect(otherList.status).toBe(200);
    expect(otherList.body.shipments).toEqual([]);

    const crossFetch = await authed(app, tokenB).get(`/api/accounts/${accountB.id}/gameplay/shipments/${shipmentIdA}`);
    expect(crossFetch.status).toBe(404);
  });
});
