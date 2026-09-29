// public/scripts/telemetry.js (ISP-256, AB#952): the minimum events process/TELEMETRY.md asks for, sent to the game's own
// server (POST /api/telemetry; server/telemetry.js says what it keeps). Identity is a random id this browser keeps for
// itself in localStorage, never the account id or email, and a session id per visit. It is sent with plain fetch, not
// apiFetch, so no Authorization header ever ties an event to an account. Nothing here may break the game: every
// failure is swallowed, and an event that cannot be sent is lost.
//
//   app_open      the game entered (enterGame), source: where the page came from
//   verb_first    the first committing action of a session (an Allocate: the server's receipt, only on success), latency_ms
//   verb_repeat   every later one, count_in_session
//   session_end   the page hidden or closed, duration_s and actions (sent again if it comes back; the last one counts)
//   error         an uncaught error, message (URLs, emails and account ids removed) and a hash of it
//   funnel_step   a walkthrough step shown, step (its id), once a session
//   rank_up       the corporation's level rose, level
export const TELEMETRY_ENDPOINT = "/api/telemetry";
export const ID_KEY = "isp.telemetry.id";
export const SESSION_GAP_MS = 30 * 60_000; // hidden this long, and coming back is a new session
const BATCH = 20;
const FLUSH_MS = 10_000;
const MAX_ERRORS = 5; // a loop throwing every frame sends five, not thousands

let t = null;

function hex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }
export function randomId(cryptoObj = globalThis.crypto) {
  const b = new Uint8Array(16);
  cryptoObj.getRandomValues(b);
  return hex(b);
}

/** This browser's id: kept in localStorage, made once. A storage that refuses gives an id for this page only. */
export function distinctId(storage, make = randomId) {
  try {
    const kept = storage?.getItem(ID_KEY);
    if (/^[0-9a-f]{32}$/.test(kept || "")) return kept;
    const id = make();
    storage?.setItem(ID_KEY, id);
    return id;
  } catch {
    return make();
  }
}

/** "web-mobile" on a touch-first screen, else "web-desktop". */
export function platformOf(win) {
  try { return win.matchMedia("(pointer: coarse)").matches ? "web-mobile" : "web-desktop"; } catch { return "web-desktop"; }
}

/** Where the page came from: one of this site's pages by name, "external", or "direct". */
export function sourceOf(referrer, origin) {
  if (!referrer) return "direct";
  try {
    const u = new URL(referrer);
    if (u.origin !== origin) return "external";
    const name = u.pathname.replace(/^\/+|\.html$/g, "").replace(/[^a-z0-9-]/gi, "").toLowerCase();
    return (name || "game").slice(0, 40);
  } catch {
    return "external";
  }
}

/** An error message fit to store: no URLs (they carry ?account=), emails or account ids; at most 300 characters. */
export function scrubMessage(message) {
  const text = String(message ?? "")
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(/\bacc(?:ount)?[-_=:][\w-]+/gi, "<account>")
    .trim();
  return (text || "unknown error").slice(0, 300);
}

/** An 8-hex-digit hash (FNV-1a) of a scrubbed message, so the same error groups without storing more of it. */
export function errorHash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

function newSession(now) {
  t.session = randomId();
  t.startedAt = now;
  t.actions = 0;
  t.funnel = new Set();
  t.errors = 0;
}

/** One event on the queue, with the identity fields; flushed in batches. */
export function track(event, props) {
  if (!t) return;
  t.queue.push({ event, distinct_id: t.distinct, session_id: t.session, app_version: t.version, platform: t.platform, props });
  if (t.queue.length >= BATCH) flush();
}

/** Send what is queued: fetch with keepalive, or sendBeacon when the page is going away. */
export function flush({ beacon = false } = {}) {
  if (!t || !t.queue.length) return;
  while (t.queue.length) {
    const body = JSON.stringify({ events: t.queue.splice(0, BATCH) });
    try {
      if (beacon && t.win.navigator?.sendBeacon) t.win.navigator.sendBeacon(TELEMETRY_ENDPOINT, new Blob([body], { type: "application/json" }));
      else t.fetch(TELEMETRY_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    } catch { /* lost; telemetry never breaks the game */ }
  }
}

function endSession(now) {
  if (t.ended) return; // leaving fires pagehide and then visibilitychange: one session_end, not two
  t.ended = true;
  track("session_end", { duration_s: Math.max(0, Math.round((now - t.startedAt) / 1000)), actions: t.actions });
  flush({ beacon: true });
}

/**
 * Start telemetry for this page, once: app_open, then the listeners for session_end and errors. `version` is the
 * server's (bootstrap); the rest default to the browser's own and are injectable for tests.
 */
export function startTelemetry({ version, win = globalThis.window, now = () => Date.now(), fetchFn = globalThis.fetch?.bind(globalThis) } = {}) {
  if (t || !win) return;
  const v = /^[0-9A-Za-z.+-]{1,20}$/.test(String(version ?? "")) ? String(version) : "unknown";
  t = { win, now, fetch: fetchFn, version: v, platform: platformOf(win), distinct: distinctId(win.localStorage), queue: [], level: null, sentFirst: false, hiddenAt: null, ended: false };
  newSession(now());
  track("app_open", { source: sourceOf(win.document?.referrer, win.location?.origin) });
  flush();
  t.timer = win.setInterval?.(() => flush(), FLUSH_MS);
  win.document?.addEventListener?.("visibilitychange", () => {
    if (win.document.visibilityState === "hidden") {
      t.hiddenAt = now();
      endSession(t.hiddenAt);
    } else if (t.hiddenAt !== null && now() - t.hiddenAt >= SESSION_GAP_MS) {
      newSession(now());
      t.sentFirst = false;
      track("app_open", { source: "resume" });
      flush();
    }
    if (win.document.visibilityState !== "hidden") { t.hiddenAt = null; t.ended = false; }
  });
  win.addEventListener?.("pagehide", () => endSession(now()));
  win.addEventListener?.("error", (e) => noteError(e?.message || e?.error?.message));
  win.addEventListener?.("unhandledrejection", (e) => noteError(e?.reason?.message || String(e?.reason ?? "")));
}

/** A committing action succeeded (the server's receipt was shown): verb_first once a session, then verb_repeat. */
export function noteVerb() {
  if (!t) return;
  t.actions += 1;
  if (!t.sentFirst) {
    t.sentFirst = true;
    track("verb_first", { latency_ms: Math.max(0, Math.round(t.now() - t.startedAt)) });
  } else {
    track("verb_repeat", { count_in_session: t.actions });
  }
}

/** A walkthrough step was shown: funnel_step, once per step a session. */
export function noteFunnelStep(step) {
  if (!t || !/^[a-z][a-z0-9_-]{0,39}$/.test(String(step)) || t.funnel.has(step)) return;
  t.funnel.add(step);
  track("funnel_step", { step });
}

/** The corporation's level as the page now holds it: the first value is the baseline, a rise is rank_up. */
export function noteLevel(level) {
  if (!t) return;
  const n = Number(level);
  if (!Number.isInteger(n) || n < 0) return; // a new corporation is level 0; reaching 1 is its first rank_up
  if (t.level !== null && n > t.level) track("rank_up", { level: n });
  t.level = t.level === null ? n : Math.max(t.level, n);
}

/**
 * Browser notices that arrive as error events but are not crashes: a ResizeObserver whose callback changed layout again
 * (the browser defers it to the next frame; nothing is lost). Counted, they would read as a crash every session and bury
 * the crash-free rate TELEMETRY.md pages the Board on (found by e2e/telemetry.spec.js).
 */
export const NOT_A_CRASH = [/^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/];

/** An uncaught error: at most MAX_ERRORS a session, scrubbed and hashed. Browser notices that are not crashes are skipped. */
export function noteError(message) {
  if (!t || t.errors >= MAX_ERRORS || NOT_A_CRASH.some((re) => re.test(String(message ?? "")))) return;
  t.errors += 1;
  const text = scrubMessage(message);
  track("error", { message: text, hash: errorHash(text) });
}

/** Test hook: forget the running telemetry. */
export function resetTelemetry() {
  if (t?.timer) t.win.clearInterval?.(t.timer);
  t = null;
}
