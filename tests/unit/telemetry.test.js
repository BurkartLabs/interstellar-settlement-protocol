import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { telemetryRow, recordTelemetry, pruneTelemetry, resetTelemetryPrune, RETENTION_DAYS, TELEMETRY_EVENTS } from "../../server/telemetry.js";
import { startTelemetry, resetTelemetry, noteVerb, noteLevel, noteFunnelStep, noteError, flush, scrubMessage, errorHash, sourceOf, distinctId, ID_KEY, NOT_A_CRASH } from "../../public/scripts/telemetry.js";
import { dayNReturn, renderDayN } from "../../scripts/telemetry-d3.mjs";

// ISP-256 (AB#952): the minimum telemetry. The server keeps only the listed events with exactly their properties; the
// page sends them at their triggers under an anonymous id; D3 return comes from the stored rows alone.
const ID = "0123456789abcdef0123456789abcdef";
const SID = "fedcba9876543210fedcba9876543210";
const ev = (event, props, over = {}) => ({ event, distinct_id: ID, session_id: SID, app_version: "0.4", platform: "web-desktop", props, ...over });
const DAY = 86_400_000;

describe("the server keeps only the listed events, exactly (AB#952)", () => {
  it("keeps each listed event with its own properties, and nothing else about the request", () => {
    const samples = {
      app_open: { source: "login" }, verb_first: { latency_ms: 4816 }, verb_repeat: { count_in_session: 2 },
      session_end: { duration_s: 300, actions: 7 }, error: { message: "TypeError: x is undefined", hash: "af76b49f" },
      funnel_step: { step: "licence" }, rank_up: { level: 3 }
    };
    expect(Object.keys(samples).sort()).toEqual(Object.keys(TELEMETRY_EVENTS).sort());
    for (const [name, props] of Object.entries(samples)) {
      expect(telemetryRow(ev(name, props), 1000)).toEqual({ at: 1000, event: name, distinct_id: ID, session_id: SID, app_version: "0.4", platform: "web-desktop", props });
    }
  });

  it("drops an unknown event, a bad id, a wrong type, a missing or extra property, and anything that is not an object", () => {
    expect(telemetryRow(ev("purchase", { sku: "x" }))).toBeNull();
    expect(telemetryRow(ev("__proto__", {}))).toBeNull();
    expect(telemetryRow(ev("app_open", { source: "login" }, { distinct_id: "acc-123" }))).toBeNull(); // not an account id
    expect(telemetryRow(ev("app_open", { source: "login" }, { session_id: "x" }))).toBeNull();
    expect(telemetryRow(ev("app_open", { source: "login" }, { platform: "ios" }))).toBeNull();
    expect(telemetryRow(ev("app_open", { source: "login" }, { app_version: "<script>" }))).toBeNull();
    expect(telemetryRow(ev("verb_first", { latency_ms: "5" }))).toBeNull();
    expect(telemetryRow(ev("verb_first", { latency_ms: -1 }))).toBeNull();
    expect(telemetryRow(ev("rank_up", { level: 1.5 }))).toBeNull();
    expect(telemetryRow(ev("app_open", {}))).toBeNull();
    expect(telemetryRow(ev("app_open", { source: "login", email: "qa@example.test" }))).toBeNull();
    expect(telemetryRow(ev("error", { message: "x".repeat(301), hash: "af76b49f" }))).toBeNull();
    expect(telemetryRow(ev("funnel_step", { step: "Licence!" }))).toBeNull();
    for (const bad of [null, "app_open", [], 7]) expect(telemetryRow(bad)).toBeNull();
  });

  it("writes one file a day, counts what it dropped, and deletes files past the retention", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-telemetry-unit-"));
    resetTelemetryPrune();
    const now = Date.UTC(2026, 8, 29, 12);
    const folder = path.join(dir, "telemetry");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "2026-06-30.jsonl"), "{}\n"); // 91 days before
    fs.writeFileSync(path.join(folder, "2026-07-01.jsonl"), "{}\n"); // 90 days before: kept
    expect(recordTelemetry([ev("app_open", { source: "direct" }), ev("nope", {})], { now, dir })).toEqual({ accepted: 1, dropped: 1 });
    expect(fs.readdirSync(folder).sort()).toEqual(["2026-07-01.jsonl", "2026-09-29.jsonl"]);
    const [row] = fs.readFileSync(path.join(folder, "2026-09-29.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(row).toMatchObject({ at: now, event: "app_open", props: { source: "direct" } });
    expect(RETENTION_DAYS).toBe(90);
    expect(pruneTelemetry(now + 2 * DAY, dir)).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("the page sends each event at its trigger, under an anonymous id (AB#952)", () => {
  afterEach(() => resetTelemetry());

  function fakeWindow({ referrer = "http://game.test/login.html", coarse = false } = {}) {
    const listeners = {};
    const docListeners = {};
    const store = new Map();
    const sent = [];
    const beacons = [];
    const win = {
      location: { origin: "http://game.test" },
      document: { referrer, visibilityState: "visible", addEventListener: (n, f) => { docListeners[n] = f; } },
      localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
      matchMedia: () => ({ matches: coarse }),
      navigator: { sendBeacon: (_url, blob) => { beacons.push(blob); return true; } },
      addEventListener: (n, f) => { listeners[n] = f; },
      setInterval: () => 1,
      clearInterval: () => {}
    };
    const fetchFn = (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return Promise.resolve({}); };
    return { win, fetchFn, listeners, docListeners, store, sent, beacons };
  }
  const events = (sent) => sent.flatMap((s) => s.body.events);

  it("app_open with where the page came from, the platform, and one id this browser keeps", () => {
    const w = fakeWindow({ coarse: true });
    startTelemetry({ version: "0.4", win: w.win, now: () => 1000, fetchFn: w.fetchFn });
    const [open] = events(w.sent);
    expect(open).toMatchObject({ event: "app_open", props: { source: "login" }, platform: "web-mobile", app_version: "0.4" });
    expect(open.distinct_id).toMatch(/^[0-9a-f]{32}$/);
    expect(w.store.get(ID_KEY)).toBe(open.distinct_id);
    expect(w.sent[0].url).toBe("/api/telemetry");
  });

  it("verb_first once with its latency, then verb_repeat with the count; rank_up only on a rise; each step once", () => {
    const w = fakeWindow();
    let clock = 1000;
    startTelemetry({ version: "0.4", win: w.win, now: () => clock, fetchFn: w.fetchFn });
    noteLevel(0);
    clock = 5816; noteVerb(); noteVerb();
    noteLevel(1); noteLevel(1); noteLevel(0);
    noteFunnelStep("licence"); noteFunnelStep("licence"); noteFunnelStep("Bad Step");
    flush();
    const sent = events(w.sent).map((e) => [e.event, e.props]);
    expect(sent).toEqual([
      ["app_open", { source: "login" }],
      ["verb_first", { latency_ms: 4816 }],
      ["verb_repeat", { count_in_session: 2 }],
      ["rank_up", { level: 1 }],
      ["funnel_step", { step: "licence" }]
    ]);
  });

  it("session_end once as a beacon when the page goes, and errors scrubbed, capped, and never a browser notice", async () => {
    const w = fakeWindow();
    let clock = 0;
    startTelemetry({ version: "0.4", win: w.win, now: () => clock, fetchFn: w.fetchFn });
    noteError("ResizeObserver loop completed with undelivered notifications.");
    for (let i = 0; i < 8; i++) noteError(`TypeError at https://game.test/?account=acc-1 #${i}`);
    clock = 65_000;
    w.listeners.pagehide();
    w.win.document.visibilityState = "hidden";
    w.docListeners.visibilitychange();
    expect(w.beacons).toHaveLength(1);
    const beaconed = (await Promise.all(w.beacons.map((b) => b.text()))).flatMap((s) => JSON.parse(s).events);
    const all = [...events(w.sent), ...beaconed];
    expect(all.filter((e) => e.event === "session_end").map((e) => e.props)).toEqual([{ duration_s: 65, actions: 0 }]);
    const errors = all.filter((e) => e.event === "error");
    expect(errors).toHaveLength(5);
    expect(errors[0].props.message).toBe("TypeError at <url> #0");
    expect(NOT_A_CRASH.some((re) => re.test("ResizeObserver loop limit exceeded"))).toBe(true);
  });

  it("keeps no URL, email or account id in an error, and hashes the same message the same way", () => {
    expect(scrubMessage("failed at https://x.test/?account=acc-9 for qa@example.test (acc-123)")).toBe("failed at <url> for <email> (<account>)");
    expect(scrubMessage("")).toBe("unknown error");
    expect(errorHash("a")).toBe(errorHash("a"));
    expect(errorHash("a")).toMatch(/^[0-9a-f]{8}$/);
    expect(errorHash("a")).not.toBe(errorHash("b"));
  });

  it("names the source by this site's page, else external or direct; keeps one id per browser", () => {
    expect(sourceOf("http://game.test/register.html", "http://game.test")).toBe("register");
    expect(sourceOf("http://game.test/", "http://game.test")).toBe("game");
    expect(sourceOf("https://reddit.com/r/x", "http://game.test")).toBe("external");
    expect(sourceOf("", "http://game.test")).toBe("direct");
    const store = new Map([[ID_KEY, ID]]);
    expect(distinctId({ getItem: (k) => store.get(k), setItem: () => {} })).toBe(ID);
    expect(distinctId({ getItem: () => { throw new Error("blocked"); } }, () => SID)).toBe(SID);
  });
});

describe("D3 return from the stored rows (AB#952)", () => {
  const open = (id, day, hour = 12) => ({ event: "app_open", distinct_id: id.padEnd(32, "0"), at: Date.UTC(2026, 8, day, hour) });
  it("counts a player back on the third UTC day after its first open; a cohort still inside it is pending", () => {
    const rows = [
      open("a", 1), open("a", 4, 23), // back on day 3
      open("b", 1), open("b", 2), open("b", 5), // back on days 1 and 4, not 3
      open("c", 2), open("c", 5, 0), // back on day 3
      open("d", 27), // day 3 not over yet
      { event: "verb_first", distinct_id: "e".padEnd(32, "0"), at: Date.UTC(2026, 8, 1) } // not an open
    ];
    const r = dayNReturn(rows, 3, Date.UTC(2026, 8, 29, 12));
    expect(r.cohorts.map((c) => [c.cohort, c.players, c.returned, c.pending])).toEqual([
      ["2026-09-01", 2, 1, false], ["2026-09-02", 1, 1, false], ["2026-09-27", 1, 0, true]
    ]);
    expect(r.overall).toEqual({ players: 3, returned: 2, rate: 2 / 3 });
    expect(renderDayN(r)).toMatch(/2026-09-27\s+1\s+0\s+pending/);
    expect(dayNReturn(rows, 1, Date.UTC(2026, 8, 29)).overall.returned).toBe(1); // b, on day 1
  });
});
