import { describe, it, expect } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, getState, listAccountMessages, listAccountNotifications } from "../../server/gameState.js";
import { GAMEPLAY_INPUT, ACCOUNT_INPUT, MARKET_INPUT, FORUM_INPUT, onStep } from "../../server/gameplayInput.js";

// AB#732: every route that changes state outside /gameplay is checked by the same input middleware as AB#731, before
// its handler; the rest are named here with the reason they are out of scope. A new route fails this file until it is
// in one or the other.
const TABLES = [
  { prefix: "/api/accounts/:accountId/gameplay", routes: GAMEPLAY_INPUT },
  { prefix: "/api/accounts/:accountId", routes: ACCOUNT_INPUT },
  { prefix: "/api/market", routes: MARKET_INPUT },
  { prefix: "/api/forums", routes: FORUM_INPUT }
];

const OUT_OF_SCOPE = {
  "POST /api/auth/register": "validates its own body (email, password, names: Bug #433)",
  "POST /api/auth/login": "validates its own body; answers only yes or no",
  "POST /api/auth/refresh": "reads only the isp_refresh cookie; the body is not read (AB#757)",
  "POST /api/auth/logout": "reads only the isp_refresh cookie; the body is not read (AB#757)",
  "GET /api/auth/session": "no input",
  "GET /healthz": "the health probe, with no input (AB#735)",
  "GET /how-to-start": "a static page, with no input (AB#748)",
  "GET /api/bootstrap": "a public read with no input",
  "GET /api/corporations/:corpId/credit-rating": "a read; its one input, a public corporation id, is only ever compared with existing ids (AB#842)",
  "GET /api/corporations/:corpId/cap-table": "a read; its one input, a public corporation id, is only ever compared with existing ids (AB#851)",
  "GET /api/conglomerates": "a read with no input: the public directory (ISP-197, AB#891)",
  "GET /api/stations": "a static catalog",
  "GET /api/systems": "a static catalog (ISP-112, AB#804)",
  "GET /api/buildings": "a static catalog",
  "GET /api/ceo-insight": "a static catalog",
  "GET /api/mission-agents": "a static catalog",
  "GET /api/research": "a static catalog",
  "POST /api/auth/dummy-login": "dev only (ISP_DEV=1), the shared demo account",
  "POST /api/auth/dummy-reset": "dev only (ISP_DEV=1)",
  "GET /kanban/api": "the developer kanban board, dev only",
  "POST /kanban/api": "the developer kanban board, dev only",
  "POST /api/auth/verify-email": "validates its own body: a token string of the right length and alphabet, or nothing verifies (AB#987)",
  "POST /api/auth/resend-verification": "validates its own body: a non-string email finds no account, and the answer is the same either way (AB#987)",
  "GET /api/dev/outbox": "dev only (ISP_DEV=1), the test mail outbox, with no input (AB#987)",
  "POST /api/auth/forgot-password": "validates its own body: a non-string email finds no account, and the answer is the same either way (AB#988)",
  "POST /api/auth/reset-password": "validates its own body: the password rule first, then a token string of the right shape (AB#988)"
};

/** Registered today and removed by a pull request not yet merged; skipped once gone. */
const REMOVED_ELSEWHERE = {
  "POST /api/dev/set-credits": "Bug #423, removed by !151",
  "POST /api/combat/simulate": "Bug #1036, removed by !147 (no client caller)"
};

function routes(stack, prefix = "") {
  return stack.flatMap((layer) => {
    if (layer.route) return Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${prefix + layer.route.path}`);
    if (layer.name === "router" && layer.handle?.stack) {
      const mount = (layer.regexp.source.match(/^\^\\\/([^\\?]+)/) || [])[1];
      return routes(layer.handle.stack, mount ? `${prefix}/${mount.replace(/\\\//g, "/")}` : prefix);
    }
    return [];
  });
}

/** The table entry for a registered route, by the longest mount it falls under. */
function entryFor(route) {
  const [method, path] = route.split(" ");
  for (const t of TABLES) {
    if (path !== t.prefix && !path.startsWith(`${t.prefix}/`)) continue;
    const rest = path.slice(t.prefix.length) || "/";
    if (t.routes[`${method} ${rest}`]) return t.routes[`${method} ${rest}`];
    if (t.prefix.endsWith("/gameplay") || rest.startsWith("/gameplay/")) continue;
    return null;
  }
  return undefined;
}

describe("every route is checked or named as out of scope (AB#732)", async () => {
  const { app } = await getApp();
  const all = routes(app._router.stack);

  it("finds the routes", () => {
    expect(all.length).toBeGreaterThan(50);
    expect(all).toContain("POST /api/market/orders");
  });

  it("puts each registered route in a table or on the out-of-scope list", () => {
    const loose = all.filter((r) => !entryFor(r) && !OUT_OF_SCOPE[r] && !REMOVED_ELSEWHERE[r]);
    expect(loose).toEqual([]);
  });

  it("lists nothing that is not a route, except what other open pull requests add", () => {
    const stale = TABLES.flatMap((t) => Object.entries(t.routes)
      .filter(([, e]) => !e.elsewhere)
      .map(([k]) => { const [m, p] = k.split(" "); return `${m} ${t.prefix}${p === "/" ? "" : p}`; })
      .filter((r) => !all.includes(r)));
    expect(stale).toEqual([]);
    expect(Object.keys(OUT_OF_SCOPE).filter((r) => !all.includes(r) && !r.startsWith("POST /api/auth/dummy") && !r.includes("kanban"))).toEqual([]);
  });

  it("has no investment route (deleted by !138) and no unchecked route that sets credits", () => {
    expect(all.filter((r) => r.includes("/api/investments"))).toEqual([]);
  });
});

// ── The hostile table, against every field of every route in the three new tables ──
const HOSTILE = [
  ["abc", "abc"], ["NaN", "NaN"], ["NaN (a number, sent as null)", NaN], ["Infinity", "Infinity"], ["-5", -5], ["0", 0],
  ["2.5", 2.5], ["a missing field", undefined], ["a 10,000-character string", "x".repeat(10_000)]
];

const BASELINE = {
  "/api/accounts/:accountId": {
    "POST /notifications/:notificationId/read": { params: { notificationId: "n-732" } },
    "GET /corporations": { query: { name: "Frontier" } },
    "POST /conglomerates": { body: { name: "Baseline Frontier Group", emblem: 1, colour: 1 } },
    "POST /conglomerates/:conglomerateId/invitations": { params: { conglomerateId: "cgl-732" }, body: { corpId: "corp-732" } },
    "POST /conglomerates/:conglomerateId/invitations/:invitationId/:answer": { params: { conglomerateId: "cgl-732", invitationId: "cinv-732", answer: "accept" } },
    "POST /conglomerates/:conglomerateId/applications": { params: { conglomerateId: "cgl-732" } },
    "POST /conglomerates/:conglomerateId/applications/:applicationId/:answer": { params: { conglomerateId: "cgl-732", applicationId: "capp-732", answer: "decline" } },
    "POST /conglomerates/:conglomerateId/leave": { params: { conglomerateId: "cgl-732" } },
    "POST /conglomerates/:conglomerateId/members/:corpId/role": { params: { conglomerateId: "cgl-732", corpId: "corp-732" }, body: { role: "director" } },
    "POST /conglomerates/:conglomerateId/members/:corpId/remove": { params: { conglomerateId: "cgl-732", corpId: "corp-732" } },
    "POST /conglomerates/:conglomerateId/founder": { params: { conglomerateId: "cgl-732" }, body: { corpId: "corp-732" } },
    "POST /conglomerates/:conglomerateId/identity": { params: { conglomerateId: "cgl-732" }, body: { emblem: 1, colour: 1 } },
    "POST /conglomerates/:conglomerateId/dissolve": { params: { conglomerateId: "cgl-732" } },
    "POST /conglomerates/:conglomerateId/level": { params: { conglomerateId: "cgl-732" }, body: { level: 2 } },
    "GET /conglomerates/:conglomerateId/treasury": { params: { conglomerateId: "cgl-732" } },
    "GET /conglomerates/:conglomerateId/hangar": { params: { conglomerateId: "cgl-732" } },
    "POST /conglomerates/:conglomerateId/hangar/deposit": { params: { conglomerateId: "cgl-732" }, body: { stationId: "earth-station-prime", item: "Silicates", quantity: 10 } },
    "POST /conglomerates/:conglomerateId/hangar/withdraw": { params: { conglomerateId: "cgl-732" }, body: { stationId: "earth-station-prime", item: "Silicates", quantity: 10 } },
    "POST /conglomerates/:conglomerateId/treasury/deposit": { params: { conglomerateId: "cgl-732" }, body: { amount: 100 } },
    "POST /conglomerates/:conglomerateId/treasury/withdraw": { params: { conglomerateId: "cgl-732" }, body: { amount: 100 } },
    "POST /conglomerates/:conglomerateId/treasury/withdrawals/:withdrawalId/block": { params: { conglomerateId: "cgl-732", withdrawalId: "cwd-732" } },
    "GET /finances/statements": { query: { days: "7" } },
    "POST /messages/send": { body: { toCorpName: "Frontier", subject: "s", body: "b" } },
    "POST /messages/draft": { body: { subject: "s", body: "b" } },
    "DELETE /messages/draft/:draftId": { params: { draftId: "d-732" } },
    "GET /conversations": { query: { limit: "10" } },
    "POST /conversations/send": { body: { toCorpId: "corp-910-nobody", body: "b" } },
    "GET /conversations/:conversationId/messages": { params: { conversationId: "cv_910" } },
    "POST /conversations/:conversationId/read": { params: { conversationId: "cv_910" } },
    "POST /messages/:messageId/read": { params: { messageId: "m-732" } },
    "POST /messages/:messageId/move": { params: { messageId: "m-732" }, body: { folder: "archive" } },
    "POST /loans/quote": { body: { productId: "dsdb-90", principal: 5000 } }, // ISP-149 (AB#843): a quote changes nothing
    "POST /loans/accept": { body: { quoteId: "lq-732" } }, // no such quote: refused, nothing lent
    "POST /loans/:loanId/payoff": { params: { loanId: "loan-732" } }, // no such loan: 404, nothing taken
    "POST /bonds/issue": { body: { quantity: 100, couponPct30: 6, maturityDays: 60, windowHours: 24 } }, // AB#848: level 0, refused
    "POST /bonds/preview": { body: { quantity: 100, couponPct30: 6, maturityDays: 60 } }, // AB#850: changes nothing
    "POST /equity/list": {}, // AB#852: level 0, refused, nothing listed
    "POST /equity/offerings": { body: { quantity: 500 } }, // not listed: refused
    "POST /equity/payout-ratio": { body: { payoutRatioPct: 30 } }, // AB#853: not listed, refused
    "POST /equity/offerings/:offeringId/buy": { params: { offeringId: "so-732" }, body: { quantity: 5 } }, // no such offering: 404
    "POST /bonds/:seriesId/subscribe": { params: { seriesId: "bond-732" }, body: { units: 5 } }, // no such series: 404
    "GET /loan-offers": {}, // ISP-152 (AB#846)
    "GET /player-loans": {}, // ISP-153 (AB#847)
    "POST /loan-offers": { body: { principal: 5000, ratePct30: 3.25, termDays: 30, minGrade: "BBB" } },
    "POST /loan-offers/:offerId/cancel": { params: { offerId: "lo-732" } }, // no such offer: 404
    "POST /loan-offers/:offerId/accept": { params: { offerId: "lo-732" } }
  },
  "/api/market": {
    "POST /orders": { body: { type: "sell", item: "Silicates", quantity: 1, unitPrice: 30 } },
    "POST /orders/:orderId/buy": { params: { orderId: "ord-732" }, body: { quantity: 1 } },
    "POST /orders/:orderId/cancel": { params: { orderId: "ord-732" } },
    "POST /npc-orders/:orderId/sell": { params: { orderId: "npc-buy-silicates-daily" }, body: { quantity: 1 } },
    "GET /history/:item": { params: { item: "Silicates" } }
  },
  "/api/forums": {
    "POST /threads": { body: { category: "General", title: "t", body: "b" } },
    "POST /threads/:threadId/replies": { params: { threadId: "thr-732" }, body: { content: "c" } },
    "POST /threads/:threadId/like": { params: { threadId: "thr-732" } }
  }
};

/**
 * Whether the input check must refuse this value itself. Numbers and catalog ids refuse everything in the table. Free
 * text takes any string within its limit ("abc" is a fine subject), and a reference the route looks up (a message, a
 * thread) takes any well-formed string: the route answers 404 for one that does not exist, changing nothing.
 */
function checkRefuses(spec, where, value) {
  if (value === undefined) return !spec.optional;
  const sent = where === "body" ? value : String(value); // path and query values arrive as strings
  if (spec.kind === "choice") return !spec.values.includes(sent); // AB#853: 0 is a good payout ratio; the list decides
  if (["int", "id", "word"].includes(spec.kind)) return true;
  if (spec.kind === "text") return typeof sent !== "string" || sent.length > spec.max;
  if (spec.kind === "ref") return typeof sent !== "string" || sent.length > 64 || sent.trim() === "";
  if (spec.kind === "decimal") return !onStep(sent, spec); // AB#846: 2.5 is a good rate, -5 and Infinity are not
  return true;
}

describe("hostile input on the market, account and forum routes is refused before anything changes (AB#732)", async () => {
  const { app } = await getApp();
  const registered = routes(app._router.stack);
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = "earth-station-prime";
    state.corp.inventory = { "earth-station-prime": { Silicates: 500 } };
    state.corp.finances.credits = 1_000_000;
  });
  const api = authed(app, accessToken);
  const snapshot = () => JSON.stringify({
    state: getAccountById(account.id).state,
    messages: listAccountMessages(account.id),
    notifications: listAccountNotifications(account.id),
    market: getState().market,
    forums: getState().forums
  });
  const send = (prefix, key, { body, params = {}, query }) => {
    const [method, pattern] = key.split(" ");
    const path = prefix.replace(":accountId", account.id) + pattern.replace(/:(\w+)/g, (_, p) => encodeURIComponent(params[p] ?? ""));
    const req = method === "GET" ? api.get(path) : method === "DELETE" ? api.delete(path) : api.post(path);
    if (query) req.query(query);
    return method === "GET" || method === "DELETE" ? req : req.send(body ?? {});
  };

  const cases = [];
  for (const t of TABLES.slice(1)) {
    for (const [key, entry] of Object.entries(t.routes)) {
      const [m, p] = key.split(" ");
      if (!registered.includes(`${m} ${t.prefix}${p === "/" ? "" : p}`)) continue; // added by another open PR
      for (const where of ["params", "query", "body"]) {
        for (const [name, spec] of Object.entries(entry[where] || {})) {
          for (const [label, value] of HOSTILE) {
            if (!checkRefuses(spec, where, value)) continue;
            cases.push([`${key}`, name, label, t.prefix, where, value, spec]);
          }
        }
      }
    }
  }

  it("covers the fields of every route in the three tables", () => {
    expect(cases.length).toBeGreaterThan(80);
  });

  it.each(cases)("%s: %s as %s gets 400 from the input check and nothing changes", async (key, name, _label, prefix, where, value, spec) => {
    const base = JSON.parse(JSON.stringify(BASELINE[prefix][key]));
    base[where] = base[where] || {};
    if (value === undefined) delete base[where][name]; else base[where][name] = value;
    const before = snapshot();
    const res = await send(prefix, key, base);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(spec.message || spec.label);
    expect(res.body.error).not.toContain("xxxxxxxxxx");
    expect(snapshot()).toBe(before);
  });

  it.each([
    ["/api/accounts/:accountId", "POST /messages/:messageId/read", { params: { messageId: "m-does-not-exist" } }],
    ["/api/accounts/:accountId", "POST /notifications/:notificationId/read", { params: { notificationId: "n-does-not-exist" } }],
    ["/api/accounts/:accountId", "DELETE /messages/draft/:draftId", { params: { draftId: "d-does-not-exist" } }],
    ["/api/market", "POST /orders/:orderId/buy", { params: { orderId: "ord-does-not-exist" }, body: { quantity: 1 } }],
    ["/api/forums", "POST /threads/:threadId/replies", { params: { threadId: "thr-does-not-exist" }, body: { content: "hello" } }]
  ])("%s %s: a well-formed id that does not exist is left to the route, and nothing changes", async (prefix, key, req) => {
    const before = snapshot();
    const res = await send(prefix, key, req);
    // The route's own answer: 404, or 200 where deleting what is not there is already done.
    expect(key.startsWith("DELETE") ? [200, 404] : [404]).toContain(res.status);
    expect(snapshot()).toBe(before);
  });

  it("checks the login before the input: no token and a hostile body get 401", async () => {
    for (const path of ["/api/market/orders", "/api/forums/threads"]) {
      const res = await request(app).post(path).send({ quantity: "abc", title: "x".repeat(10_000) });
      expect(res.status, path).toBe(401);
    }
  });
});
