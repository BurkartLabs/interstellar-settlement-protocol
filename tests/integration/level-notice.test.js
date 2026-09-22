import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, listAccountNotifications, startExtractorCycle } from "../../server/gameState.js";

// Bug #1260: reaching a corporation level told the player nothing, and the new caps changed silently. Each level
// reached is now a notification, sent live to the account's own sockets, once.
let app, url;
const sockets = [];
beforeAll(async () => {
  ({ app } = await getApp());
  url = await serverUrl();
});
afterAll(() => { for (const s of sockets) s.close(); });
afterEach(() => vi.restoreAllMocks());

async function player() {
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => { state.corp.finances.credits = 500000; });
  const api = authed(app, accessToken);
  return { id: account.id, token: accessToken, play: (path, body = {}) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body) };
}

async function socket(token) {
  const s = connect(url, { transports: ["websocket"], forceNew: true, auth: token === undefined ? {} : { token } });
  sockets.push(s);
  const heard = [];
  s.onAny((event, payload) => heard.push({ event, payload }));
  await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
  return heard;
}

const levelNotices = (id) => listAccountNotifications(id).notifications.filter((n) => n.type === "level");
const heardLevels = (heard) => heard.filter((x) => x.event === "notifications:new" && x.payload?.notification?.type === "level");
const settle = async (heard, count) => {
  for (let i = 0; i < 60 && heardLevels(heard).length < count; i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 150));
};

describe("reaching a level (Bug #1260)", () => {
  it("the fifth hire after an office adds one Level 1 notification, live to the player only; the next hire adds none", async () => {
    const a = await player();
    const other = await player();
    const heard = { A: await socket(a.token), other: await socket(other.token), anonymous: await socket() };

    expect((await a.play("rent-office", { stationId: "earth-station-prime", durationDays: 7 })).status).toBe(200);
    expect((await a.play("hire", { count: 4 })).status).toBe(200);
    expect(levelNotices(a.id)).toEqual([]);
    expect((await a.play("hire", { count: 1 })).status).toBe(200);
    await settle(heard.A, 1);

    const corp = getAccountById(a.id).state.corp;
    expect(corp.level).toBe(1);
    const [notice, ...more] = levelNotices(a.id);
    expect(more).toEqual([]);
    expect(notice.title).toBe("Corporation Level 1");
    // The figures are the sidebar's: Employees x / employeeCap, Building Slots, Fleet Cap.
    expect(notice.body).toContain(`Employee cap ${corp.employeeCap}, building slots ${corp.buildingSlots}, fleet cap ${corp.fleet.cap}.`);
    expect(notice.body).toContain(`Market sector opened: ${corp.unlocks.marketSectors.join(", ")}.`);
    expect(heardLevels(heard.A).map((x) => x.payload)).toEqual([{ accountId: a.id, notification: notice }]);
    expect(heardLevels(heard.other)).toEqual([]);
    expect(heardLevels(heard.anonymous)).toEqual([]);

    expect((await a.play("hire", { count: 1 })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(levelNotices(a.id)).toHaveLength(1);
    expect(heardLevels(heard.A)).toHaveLength(1);
  });

  it("a mutation that reaches two levels at once tells the player about each, in order", async () => {
    const a = await player();
    const heard = await socket(a.token);
    mutateAccountState(a.id, (state) => {
      const corp = state.corp;
      corp.offices = [{ stationId: "earth-station-prime", rentedUntil: Date.now() + 86_400_000 }];
      corp.employeeCount = 5;
      corp.miningLeases = [...(corp.miningLeases || []), { id: "lease-mars", body: "Mars" }];
      corp.buildings = [...(corp.buildings || []), { name: "Basic Extractor Yard", tier: 1, status: "Operational" }];
      corp.mining.silicateExtractors = [{ id: "ext-1", leaseId: "lease-mars", active: false, totalMined: 300 }];
    });
    await settle(heard, 2);
    expect(getAccountById(a.id).state.corp.level).toBe(2);
    // Newest first in the list, so Level 2 is on top; they were sent Level 1 then Level 2.
    expect(levelNotices(a.id).map((n) => n.title)).toEqual(["Corporation Level 2", "Corporation Level 1"]);
    expect(heardLevels(heard).map((x) => x.payload.notification.title)).toEqual(["Corporation Level 1", "Corporation Level 2"]);
  });

  it("a level held from before this fix is not announced on the next action", async () => {
    const a = await player();
    // As a save from before the fix: already Level 1, its unlocks granted, never told.
    mutateAccountState(a.id, (state) => {
      state.corp.offices = [{ stationId: "earth-station-prime", rentedUntil: Date.now() + 86_400_000 }];
      state.corp.employeeCount = 5;
      state.corp.level = 1;
    });
    expect(levelNotices(a.id)).toEqual([]);
    expect((await a.play("hire", { count: 1 })).status).toBe(200);
    getAccountById(a.id);
    expect(levelNotices(a.id)).toEqual([]);
  });

  it("a level reached on a read (mining settled when the account is loaded) is announced too, once", async () => {
    const a = await player();
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no extractor downtime
    const t0 = Date.now();
    mutateAccountState(a.id, (state) => {
      const corp = state.corp;
      corp.offices = [{ stationId: "earth-station-prime", rentedUntil: t0 + 30 * 86_400_000 }];
      corp.employeeCount = 5;
      corp.miningLeases = [...(corp.miningLeases || []), { id: "lease-mars", body: "Mars" }];
      corp.buildings = [...(corp.buildings || []), { name: "Basic Extractor Yard", tier: 1, status: "Operational" }];
      const ex = { id: "ext-1", leaseId: "lease-mars", active: false, totalMined: 290, totalSpent: 0, minedRemainder: 0 };
      corp.mining.silicateExtractors = [ex];
    });
    mutateAccountState(a.id, (state) => {
      startExtractorCycle(state.corp.mining.silicateExtractors[0], { now: t0, hours: 1, throughputPerHour: 600, operationCostPerHour: 0, startupCost: 0 });
    });
    expect(getAccountById(a.id).state.corp.level).toBe(1);
    expect(levelNotices(a.id).map((n) => n.title)).toEqual(["Corporation Level 1"]);

    vi.spyOn(Date, "now").mockReturnValue(t0 + 60 * 60 * 1000);
    const corp = getAccountById(a.id).state.corp; // a read, no mutation
    expect(corp.level).toBe(2);
    expect(levelNotices(a.id).map((n) => n.title)).toEqual(["Corporation Level 2", "Corporation Level 1"]);
    getAccountById(a.id);
    expect(levelNotices(a.id)).toHaveLength(2);
  });
});
