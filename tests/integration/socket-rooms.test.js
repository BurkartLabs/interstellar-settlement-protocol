import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import jwt from "jsonwebtoken";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { serverCode } from "../helpers/serverSource.js";
import { mutateAccountState, mutateState } from "../../server/gameState.js";

// Bug #1021: per-account events went to every socket with io.emit: every corporation's finances every 30 seconds,
// every corporation's inventory and credits on each mining tick, every notification's text. Each authenticated
// socket now joins its account's room and per-account events go only there; global events still reach everyone.
let url, server, mod;
const sockets = [];

beforeAll(async () => {
  mod = await getApp();
  ({ server } = mod);
  url = await serverUrl();
});
afterAll(async () => {
  for (const s of sockets) s.close();
  await new Promise((resolve) => server.close(resolve));
});

async function player() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.employeeCap = 20;
    state.corp.employeeCount = 0;
    state.corp.finances.credits = 100000;
    state.corp.offices = [{ stationId: "earth-station-prime", rentedUntil: Date.now() + 7 * 86_400_000 }];
  });
  return { id: account.id, token: accessToken, api: authed(app, accessToken) };
}

async function socket(token) {
  const s = connect(url, { transports: ["websocket"], forceNew: true, auth: token === undefined ? {} : { token } });
  sockets.push(s);
  await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
  return s;
}

/** Every `event` that `s` receives while `action` runs, and for `ms` after. */
async function heard(s, event, action, ms = 300) {
  const got = [];
  const on = (payload) => got.push(payload);
  s.on(event, on);
  await action();
  await new Promise((resolve) => setTimeout(resolve, ms));
  s.off(event, on);
  return got;
}

/**
 * Every `event` `s` receives from now until `stop()`, which waits `ms` more first (AB#2056). Start it before the
 * action and stop it once the event that must arrive has arrived, so a check that nothing else came, or that it came
 * once, is timed from the delivery instead of from the action.
 */
function collect(s, event) {
  const got = [];
  const on = (payload) => got.push(payload);
  s.on(event, on);
  return {
    async stop(ms = 300) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      s.off(event, on);
      return got;
    }
  };
}

const noAction = async () => {};

/**
 * The first `event` on `s` that `match` accepts, once `action` has run; rejects after `ms` (AB#2015). For what must
 * arrive: a fixed window says "not yet" on a loaded machine, and waiting for the event itself does not.
 */
async function first(s, event, action, match = () => true, ms = 5000) {
  let on;
  const arrived = new Promise((resolve) => {
    on = (payload) => { if (match(payload)) resolve(payload); };
    s.on(event, on);
  });
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no ${event} within ${ms}ms`)), ms); });
  try {
    await action();
    return await Promise.race([arrived, timeout]);
  } finally {
    clearTimeout(timer);
    s.off(event, on);
  }
}

// AB#2056: each test waits for the event that must arrive (first, AB#2015), and times its "nothing else" and "exactly
// once" checks from that arrival (collect), so a late delivery on a loaded machine is not read as a missing one.
describe("per-account events reach only that account's sockets (Bug #1021)", () => {
  it("sends each corporation's finances only to its own sockets, and none to an anonymous one", async () => {
    const a = await player();
    const b = await player();
    const [sa, sb, anon] = [await socket(a.token), await socket(b.token), await socket()];
    const [onA, onB, onAnon] = [collect(sa, "finance:updated"), collect(sb, "finance:updated"), collect(anon, "finance:updated")];
    const tick = () => mod.financialSnapshotTick();
    const [mine] = await Promise.all([first(sa, "finance:updated", tick, (p) => p?.accountId === a.id), first(sb, "finance:updated", noAction, (p) => p?.accountId === b.id)]);
    const [gotA, gotB, gotAnon] = await Promise.all([onA.stop(), onB.stop(), onAnon.stop()]);
    expect(gotA.every((p) => p.accountId === a.id), "A heard another corporation's finances").toBe(true);
    expect(gotB.every((p) => p.accountId === b.id), "B heard another corporation's finances").toBe(true);
    expect(gotAnon).toEqual([]);
    expect(typeof mine.finances.credits).toBe("number");
  });

  it("sends mining updates (inventory and credits) only to the owner", async () => {
    const a = await player();
    const b = await player();
    const [sa, anon] = [await socket(a.token), await socket()];
    const [onA, onAnon] = [collect(sa, "mining:updated"), collect(anon, "mining:updated")];
    await first(sa, "mining:updated", () => mod.miningTick(), (p) => p?.accountId === a.id);
    const [gotA, gotAnon] = await Promise.all([onA.stop(), onAnon.stop()]);
    expect(gotA.every((p) => p.accountId === a.id)).toBe(true);
    expect(gotA.some((p) => p.accountId === b.id)).toBe(false);
    expect(gotAnon).toEqual([]);
  });

  it("sends a notification's text only to the corporation it belongs to", async () => {
    const a = await player();
    const b = await player();
    const [sa, sb, anon] = [await socket(a.token), await socket(b.token), await socket()];
    const [onA, onB, onAnon] = [collect(sa, "notifications:new"), collect(sb, "notifications:new"), collect(anon, "notifications:new")];
    const hire = () => a.api.post(`/api/accounts/${a.id}/gameplay/hire`).send({ count: 2 });
    await first(sa, "notifications:new", hire, (p) => p?.accountId === a.id);
    const [gotA, gotB, gotAnon] = await Promise.all([onA.stop(), onB.stop(), onAnon.stop()]);
    expect(gotA.map((p) => p.accountId)).toEqual([a.id]);
    expect(gotB).toEqual([]);
    expect(gotAnon).toEqual([]);
  });

  it("still sends global events to everyone, signed in or not", async () => {
    const a = await player();
    const [sa, anon] = [await socket(a.token), await socket()];
    const [onA, onAnon] = [collect(sa, "market:updated"), collect(anon, "market:updated")];
    mutateState((draft) => { for (const o of draft.market.npcBuyOrders) o.lastResetDate = ""; });
    const reset = () => mod.checkAndResetNpcBuyOrders();
    await Promise.all([first(sa, "market:updated", reset), first(anon, "market:updated", noAction)]);
    const [gotA, gotAnon] = await Promise.all([onA.stop(), onAnon.stop()]);
    expect(gotA.length).toBe(1);
    expect(gotAnon.length).toBe(1);
  });
});

// ISP-67: the anonymous and expired-token edges around the boundary Bug #710 and Bug #1021 already built.
describe("an anonymous socket keeps working and sees only the signed-out view (ISP-67)", () => {
  it("gets the public events and none of the per-account ones, in the same run that produces both", async () => {
    const a = await player();
    const anon = await socket();
    const activity = async () => {
      mod.financialSnapshotTick();
      mod.miningTick();
      mutateState((draft) => { for (const o of draft.market.npcBuyOrders) o.lastResetDate = ""; });
      mod.checkAndResetNpcBuyOrders();
    };
    // AB#2056: the same shape as the four above: wait for the public event, then time the per-account checks from it.
    const events = ["finance:updated", "mining:updated", "notifications:new", "market:updated"];
    const on = events.map((e) => collect(anon, e));
    await first(anon, "market:updated", activity);
    const [finance, mining, notifications, market] = await Promise.all(on.map((c) => c.stop()));
    expect(finance).toEqual([]);
    expect(mining).toEqual([]);
    expect(notifications).toEqual([]);
    expect(market.length).toBe(1);
  });
});

describe("an expired token drops the socket back to anonymous, not the connection (ISP-67)", () => {
  it("stops per-account events, says auth:expired, and a fresh token restores them", async () => {
    const a = await player();
    const soonToExpire = jwt.sign({ sub: a.id, kind: "access" }, process.env.JWT_SECRET, { expiresIn: 1 });
    const s = await socket(soonToExpire);
    // Let the 1-second token actually expire while the connection stays open, rather than forging an already-expired
    // one: the point of this story is a socket that was authenticated and stops being so mid-connection.
    await new Promise((resolve) => setTimeout(resolve, 1300));

    // AB#2015: wait for auth:expired itself rather than a fixed window, and only then give finance:updated 300ms more,
    // so the check that nothing reached the expired socket starts from a known point instead of racing the delivery.
    const financeOnExpired = [];
    const onFinance = (payload) => financeOnExpired.push(payload);
    s.on("finance:updated", onFinance);
    await first(s, "auth:expired", () => mod.financialSnapshotTick());
    await new Promise((resolve) => setTimeout(resolve, 300));
    s.off("finance:updated", onFinance);
    expect(financeOnExpired).toEqual([]);

    // The account's other sockets are unaffected: a fresh connection with a good token still gets its events.
    const fresh = await socket(a.token);
    const restored = await first(fresh, "finance:updated", () => mod.financialSnapshotTick(), (p) => p?.accountId === a.id);
    expect(restored.accountId).toBe(a.id);
  });

  it("also fails closed on writes: chat:send from an expired-token socket is dropped, not sent as the account", async () => {
    const a = await player();
    const soonToExpire = jwt.sign({ sub: a.id, kind: "access" }, process.env.JWT_SECRET, { expiresIn: 1 });
    const s = await socket(soonToExpire);
    await new Promise((resolve) => setTimeout(resolve, 1300));

    const anon = await socket();
    const got = await heard(anon, "chat:new", () => s.emit("chat:send", { channel: "global", content: "should not send" }));
    expect(got).toEqual([]);
  });
});

// Structural guard: a new io.emit of an account's data would broadcast it again. Every io.emit left in the server must
// be one of the global events; everything else goes through emitToAccount.
// combat:newReport is global: the report goes into the global state every client already receives, and names no account.
const GLOBAL_EVENTS = ["market:updated", "forums:updated", "chat:new", "combat:newReport"];

describe("the server broadcasts only global events (Bug #1021)", () => {
  it("has no io.emit outside the global events", () => {
    const source = serverCode(); // AB#1815: index.js and the modules it was split into
    const events = [...source.matchAll(/\bio\.emit\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(events.length).toBeGreaterThan(0);
    expect(events.filter((e) => !GLOBAL_EVENTS.includes(e))).toEqual([]);
  });
});
