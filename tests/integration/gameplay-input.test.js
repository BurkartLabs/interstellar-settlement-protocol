import { describe, it, expect } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { GAMEPLAY_INPUT } from "../../server/gameplayInput.js";

// AB#731: every gameplay route refuses hostile numbers and ids with a 400, before anything changes.
const PREFIX = "/api/accounts/:accountId/gameplay";
const HOSTILE = [
  ["abc", "abc"], ["NaN", "NaN"], ["NaN (a number, sent as null)", NaN], ["Infinity", "Infinity"], ["-5", -5], ["0", 0],
  ["2.5", 2.5], ["a missing field", undefined], ["a 10,000-character string", "x".repeat(10_000)]
];

/** A request each route's checks accept: every other field valid while one is made hostile. */
const BASELINE = {
  "POST /hire": { body: { count: 1 } },
  "POST /rent-office": { body: { stationId: "earth-station-prime", durationDays: 7 } },
  "POST /renew-office": { body: { stationId: "earth-station-prime", durationDays: 7 } },
  "POST /purchase-lease": { body: { body: "Mars" } },
  "POST /transfer-resources": { body: { fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 1 }] } },
  "GET /shipments": {},
  "GET /shipments/:shipmentId": { params: { shipmentId: "shp-731" } },
  "POST /travel": { body: { toStationId: "mars-orbital-dock" } },
  "POST /lease/:leaseId/build-extractor": { params: { leaseId: "lease-731" } },
  "POST /lease/:leaseId/start-mining": { params: { leaseId: "lease-731" }, body: { amount: 40, hours: 24, extractorId: "ext-731" } },
  "POST /lease/:leaseId/stop-mining": { params: { leaseId: "lease-731" }, body: { extractorId: "ext-731" } },
  "POST /build-assembly-facility": {},
  "POST /build-mining-probe": {},
  "POST /build-refinery": {},
  "POST /build": { body: { buildingId: "basic-extractor-yard", leaseId: "lease-731" } }, // ISP-94
  "GET /belt-compositions": {},
  "POST /scout-belt": { body: { beltKey: "sol:belt" } },
  "POST /launch-expedition": { body: { beltKey: "sol:belt", duration: "short" } },
  "POST /start-refinery": { body: { refineryId: "ref-731", chainId: "silicates-chain", inputQuantity: 100 } },
  "POST /accept-mission": { body: { missionId: "ms-log-001" } },
  "POST /abandon-mission": { body: { missionId: "ms-log-002" } },
  "POST /complete-mission": { body: { missionId: "ms-log-001" } },
  "POST /queue-rnd": { body: { techId: "tt-basic-extraction" } },
  "POST /queue-ceo": { body: { programId: "ceo-negotiation-fundamentals" } }
};

/** What the input check says when it refuses this field: the refusal must be its, not a game rule's. */
function refusalFor(key, name, label) {
  const entry = GAMEPLAY_INPUT[key];
  if (entry.custom === "transfer") return { fromStationId: label === "a missing field" ? "Choose the station to move goods from." : "That source station does not exist.", "lines.0.item": /Line 1 has no item|holds none of that item/, "lines.0.quantity": "Line 1: enter a whole number of at least 1 to move." }[name];
  if (entry.oneOf) return label === "a missing field" ? "Choose one destination" : entry.oneOf[name].label;
  return (entry.params?.[name] || entry.body?.[name]).label;
}

/** The fields of a route that take input, as [where, name, optional]; transfer lines are addressed as lines.0.item. */
function fieldsOf(key) {
  const entry = GAMEPLAY_INPUT[key];
  if (entry.custom === "transfer") return [["body", "fromStationId", false], ["body", "lines.0.item", false], ["body", "lines.0.quantity", false]];
  return [
    ...Object.entries(entry.params || {}).map(([n, s]) => ["params", n, Boolean(s.optional)]),
    ...Object.entries(entry.oneOf || {}).map(([n]) => ["body", n, false]),
    ...Object.entries(entry.body || {}).map(([n, s]) => ["body", n, Boolean(s.optional)])
  ];
}

function withField(base, where, name, value) {
  const copy = JSON.parse(JSON.stringify(base));
  copy.body = copy.body || {};
  copy.params = copy.params || {};
  if (name === "lines.0.item" || name === "lines.0.quantity") {
    const f = name.split(".")[2];
    if (value === undefined) delete copy.body.lines[0][f]; else copy.body.lines[0][f] = value;
    return copy;
  }
  // For travel, the hostile value goes in the one destination field that is sent.
  if (name === "toSystemId") delete copy.body.toStationId;
  if (value === undefined) delete copy[where][name]; else copy[where][name] = value;
  return copy;
}

function routes(stack, prefix = "") {
  return stack.flatMap((layer) => {
    if (layer.route) return Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${prefix + layer.route.path}`);
    if (layer.name === "router" && layer.handle?.stack) return routes(layer.handle.stack, prefix);
    return [];
  });
}

async function playerWithEverything() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.currentStationId = "earth-station-prime";
    corp.miningLeases = [{ id: "lease-731", body: "Earth", slots: 2, extractorIds: ["ext-731"] }];
    corp.mining = { ...(corp.mining || {}), silicateExtractors: [{ id: "ext-731", leaseId: "lease-731", active: false, totalMined: 0, totalSpent: 0 }] };
    corp.refineries = [{ id: "ref-731", name: "Refinery #1", tier: 1, active: false, chainId: null }];
    corp.inventory = { "mars-orbital-dock": { Silicates: 50 } };
    // Two active contracts: the abandon baseline gives one up, and complete still has the other.
    corp.activeMissions = [
      { id: "ms-log-001", title: "Silicate Requisition Order", quota: { resource: "Silicates", amount: 400 }, reward: "12,000 Credits" },
      { id: "ms-log-002", title: "Nickel Freight Manifest", quota: { resource: "Nickel", amount: 300 }, reward: "15,000 Credits" }
    ];
  });
  const api = authed(app, accessToken);
  const state = () => JSON.stringify(getAccountById(account.id).state);
  const send = (key, { body = {}, params = {} }) => {
    const [method, pattern] = key.split(" ");
    const path = PREFIX.replace(":accountId", account.id) + pattern.replace(/:(\w+)/g, (_, p) => encodeURIComponent(params[p] ?? ""));
    return method === "GET" ? api.get(path) : api.post(path).send(body);
  };
  return { app, send, state };
}

describe("every gameplay route has input checks (AB#731)", async () => {
  const { app } = await getApp();
  const registered = routes(app._router.stack).filter((r) => r.includes(`${PREFIX}/`)).map((r) => r.replace(PREFIX, ""));

  it("finds the gameplay routes", () => {
    expect(registered.length).toBeGreaterThanOrEqual(20);
    expect(registered).toContain("POST /hire");
  });

  it("describes every registered gameplay route, and nothing that is not one", () => {
    expect(registered.filter((r) => !GAMEPLAY_INPUT[r])).toEqual([]);
    expect(Object.keys(GAMEPLAY_INPUT).filter((k) => !registered.includes(k))).toEqual([]);
  });

  it("has no route that grants research outside the R&D queue", () => {
    expect(registered).not.toContain("POST /complete-rnd");
  });

  it("has no unleased route that builds or runs an extractor, skipping office and lease checks (AB#1121)", () => {
    expect(registered).not.toContain("POST /build-extractor");
    expect(registered).not.toContain("POST /mine");
  });

  it("has a baseline for every route in this test", () => {
    expect(Object.keys(BASELINE).sort()).toEqual(Object.keys(GAMEPLAY_INPUT).sort());
  });
});

/**
 * Whether the input check must itself refuse this value. Catalog ids, numbers and choices refuse everything in the
 * table; a `ref` (an id the route looks up and 404s for itself, e.g. shipmentId) only refuses empty or oversized —
 * "abc" is a well-formed id the check lets through, for the route to answer 404 on (tested separately below).
 */
function checkRefuses(key, name, where, value) {
  const entry = GAMEPLAY_INPUT[key];
  if (entry.custom === "transfer") return true; // transfer's bespoke fields always refuse in this table
  const spec = entry.oneOf?.[name] || entry.params?.[name] || entry.body?.[name];
  if (value === undefined) return !spec.optional;
  const sent = where === "body" ? value : String(value); // params arrive as strings (encodeURIComponent)
  return spec.kind !== "ref" || typeof sent !== "string" || sent.length > 64 || sent.trim() === "";
}

describe("hostile input is refused before anything changes (AB#731)", async () => {
  const player = await playerWithEverything();
  const labels = Object.values(GAMEPLAY_INPUT).flatMap((e) => [...Object.values(e.body || {}), ...Object.values(e.params || {}), ...Object.values(e.oneOf || {})]).map((s) => s.label);
  const cases = Object.keys(GAMEPLAY_INPUT).flatMap((key) => fieldsOf(key).flatMap(([where, name, optional]) =>
    HOSTILE.filter(([label]) => !(optional && label === "a missing field")).filter(([, value]) => checkRefuses(key, name, where, value)).map(([label, value]) => [key, name, label, where, value])));

  it("covers every field of every route", () => {
    expect(cases.length).toBeGreaterThan(150);
  });

  it.each(cases)("%s: %s as %s gets 400 and the account is unchanged", async (key, name, label, where, value) => {
    const before = player.state();
    const res = await player.send(key, withField(BASELINE[key], where, name, value));
    expect(res.status).toBe(400);
    const expected = refusalFor(key, name, label);
    if (expected instanceof RegExp) expect(res.body.error).toMatch(expected); else expect(res.body.error).toContain(expected);
    expect(res.body.error).not.toContain("xxxxxxxxxx");
    expect(player.state()).toBe(before);
  });

  it.each(Object.keys(BASELINE))("%s: the baseline passes the input checks", async (key) => {
    const res = await player.send(key, BASELINE[key]);
    // The route may still refuse on the game's rules (credits, slots); it must not be the input check refusing.
    if (res.status === 400) expect(labels.some((l) => String(res.body.error).includes(l)), `${key}: ${res.body.error}`).toBe(false);
  });

  it("GET /shipments/:shipmentId: a well-formed id that does not exist is left to the route, and nothing changes", async () => {
    const before = player.state();
    const res = await player.send("GET /shipments/:shipmentId", { params: { shipmentId: "shp-does-not-exist" } });
    expect(res.status).toBe(404);
    expect(player.state()).toBe(before);
  });

  it("a request with no login is refused before its input is read", async () => {
    const res = await request(player.app).post("/api/accounts/acc-nobody/gameplay/hire").send({ count: "abc" });
    expect([401, 403]).toContain(res.status);
  });
});
