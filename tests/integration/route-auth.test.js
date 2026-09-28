import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { routes, fill } from "../helpers/routes.js";
import { PUBLIC_ROUTES, DEV_ONLY_ROUTES, PUBLIC_SOCKET } from "../security/public-surface.js";

// Bug #423: POST /api/dev/set-credits let anyone set any corporation's balance, because nothing checked that a route
// outside /api/accounts/:accountId required a login. AB#956 (ISP-260) extends the proof to every surface since: every
// Express route and every socket.io event is enumerated at runtime, and each one either refuses a request without a
// login or is listed in tests/security/public-surface.js with its reason. Every route with an :accountId refuses a
// second account's token (OWASP API1, broken object-level authorisation). A route or event nobody listed fails the build.

const { app, io } = await getApp();
const all = routes(app._router.stack);
const keyOf = (r) => `${r.method} ${r.path}`;
const listed = (key) => Boolean(PUBLIC_ROUTES[key] || DEV_ONLY_ROUTES[key]);

/** What a route answers to a request with no login: a hostile body, every :param filled. */
async function answerWithoutLogin(r) {
  return (await request(app)[r.method.toLowerCase()](fill(r.path)).send({ accountId: "dummy", credits: 999999999 })).status;
}

describe("every route requires a login unless it is listed as public (Bug #423, AB#956)", () => {
  const keys = all.map(keyOf);
  const scoped = all.filter((r) => r.path.includes(":accountId"));

  it(`finds the routes: ${all.length} in all, ${scoped.length} scoped to an account, ${keys.filter(listed).length} public or dev-only`, () => {
    expect(all.length).toBeGreaterThan(100);
    expect(keys).toContain("POST /api/auth/login");
    expect(keys).toContain("POST /api/accounts/:accountId/gameplay/hire");
    expect(new Set(keys).size, "a route is registered twice").toBe(keys.length);
  });

  it("has no route that sets credits from a request body", () => {
    expect(all.map((r) => r.path)).not.toContain("/api/dev/set-credits");
  });

  for (const r of all) {
    const key = keyOf(r);
    if (listed(key)) continue;
    it(`${key} refuses a request with no login`, async () => {
      const status = await answerWithoutLogin(r);
      expect([401, 403], `${key} answered ${status} without a login: protect it, or list it in tests/security/public-surface.js with the reason`).toContain(status);
    });
  }

  it("lists nothing as public that does not exist, and gives every entry a reason", () => {
    const present = new Set(keys);
    const entries = Object.entries({ ...PUBLIC_ROUTES, ...DEV_ONLY_ROUTES });
    expect(entries.filter(([k]) => !present.has(k)).map(([k]) => k)).toEqual([]);
    expect(entries.filter(([, why]) => typeof why !== "string" || why.trim().length < 10).map(([k]) => k)).toEqual([]);
  });
});

describe("every route with an :accountId refuses another account's token (AB#956)", () => {
  const scoped = all.filter((r) => r.path.includes(":accountId") && !listed(keyOf(r)));
  let owner, intruder;

  beforeAll(async () => {
    owner = await registerAccount(app);
    intruder = await registerAccount(app);
  });

  it("the two accounts are real and different", () => {
    expect(owner.account.id).toBeTruthy();
    expect(intruder.account.id).not.toBe(owner.account.id);
  });

  it(`covers all ${scoped.length} account-scoped routes`, () => {
    expect(scoped.length).toBeGreaterThan(50);
  });

  for (const r of scoped) {
    const key = keyOf(r);
    it(`${key} refuses the second account (403)`, async () => {
      const res = await request(app)[r.method.toLowerCase()](fill(r.path, owner.account.id))
        .set("Authorization", `Bearer ${intruder.accessToken}`)
        .send({ accountId: owner.account.id, credits: 999999999 });
      expect(res.status, `${key} answered ${res.status} to another account's token`).toBe(403);
    });
  }
});

describe("every socket.io event requires a login unless it is listed as public (AB#956)", () => {
  let url, events = [], serverSocket = null;
  const sockets = [];
  const open = (auth) => new Promise((resolve, reject) => {
    const s = connect(url, { transports: ["websocket"], forceNew: true, ...(auth ? { auth } : {}) });
    sockets.push(s);
    s.once("state:init", () => resolve(s));
    s.once("connect_error", reject);
  });

  beforeAll(async () => {
    url = await serverUrl();
    // Listen after server/realtime.js's own handler, so the socket it has just set up is the one read.
    const captured = new Promise((resolve) => io.once("connection", resolve));
    await open();
    serverSocket = await captured;
    events = serverSocket.eventNames().filter((e) => typeof e === "string");
  });

  afterAll(() => {
    for (const s of sockets) s.close();
  });

  it("finds the events a client can send, and connecting is listed as public", () => {
    expect(events).toContain("chat:send");
    expect(PUBLIC_SOCKET.connection).toBeTruthy();
  });

  it("gives every event a reason to be public or a checkSocketAuth re-check in its handler", () => {
    const unguarded = events.filter((e) => !PUBLIC_SOCKET[e]
      && !serverSocket.listeners(e).every((handler) => /checkSocketAuth\(socket\)/.test(String(handler))));
    expect(unguarded, "list the event in tests/security/public-surface.js or re-check the token in its handler").toEqual([]);
  });

  it("lists no socket event as public that is not registered", () => {
    expect(Object.keys(PUBLIC_SOCKET).filter((e) => e !== "connection" && !events.includes(e))).toEqual([]);
  });

  it("chat:send from a socket with no login reaches nobody; from a signed-in one it does", async () => {
    const { accessToken } = await registerAccount(app);
    const player = await open({ token: accessToken });
    const stranger = await open();
    const heard = [];
    player.on("chat:new", (m) => heard.push(m.content));
    const quiet = () => new Promise((resolve) => setTimeout(resolve, 400));
    stranger.emit("chat:send", { channel: "global", content: "from nobody" });
    await quiet();
    expect(heard).toEqual([]);
    player.emit("chat:send", { channel: "global", content: "from a player" });
    await quiet();
    expect(heard).toEqual(["from a player"]);
  });
});

describe("the check fails on a route nobody protected or listed (AB#956)", () => {
  it("a seeded unauthenticated route is found, answers without a login, and is not on the list", async () => {
    app.get("/api/seeded-open-route", (_req, res) => res.json({ open: true }));
    // Move it in front of the catch-all 404 (server/index.js), where a route registered at start-up would be.
    const stack = app._router.stack;
    const seeded = stack.pop();
    const notFound = stack.findLastIndex((l) => !l.route && /nothing is at that address/.test(String(l.handle)));
    stack.splice(notFound, 0, seeded);
    try {
      const found = routes(stack).find((r) => r.path === "/api/seeded-open-route");
      expect(found).toEqual({ method: "GET", path: "/api/seeded-open-route" });
      expect(listed(keyOf(found))).toBe(false);
      const status = await answerWithoutLogin(found);
      expect(status).toBe(200);
      expect([401, 403]).not.toContain(status); // exactly what the per-route check above fails on
    } finally {
      stack.splice(stack.indexOf(seeded), 1);
    }
  });
});
