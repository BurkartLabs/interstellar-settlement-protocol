// AB#738 (ISP-52): the shared formatting helpers, moved out of app.js so each is defined once. They are not merged
// with each other: fmtCredits ("1,234"), toCurrency ("¤1,234"), formatDuration ("1h 5m" / "5m 3s" / "3s") and
// formatDurationHours ("1h 5m", "0h") each render differently on screen, and this split changes no behaviour.
import { utcTime } from "./timeFormat.js"; // ISP-249 (AB#945): one format for every timestamp

// AB#2314: credits, in the credits sign every newer screen uses (constructionPanel.js: "¤63,000"). This was Intl's USD
// currency style from before that convention, so the same screen said "¤63,000" in one row and "$63,000 credits" in
// the next. Rounded and grouped exactly as before; only the sign changed, and a negative keeps its minus in front.
const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export function toCurrency(number) {
  const text = WHOLE.format(number);
  return text.startsWith("-") ? `-¤${text.slice(1)}` : `¤${text}`;
}


export function deepClone(input) {
  if (typeof structuredClone === "function") {
    return structuredClone(input);
  }
  return JSON.parse(JSON.stringify(input));
}

/** ISP-249 (AB#945): the guide's UTC time (public/scripts/timeFormat.js), not the viewer's locale. */
export function formatTime(ts) {
  return utcTime(ts);
}

export function formatDuration(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtCredits(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString();
}

export function fmtSignedCredits(n) {
  const v = Math.round(Number(n) || 0);
  if (v > 0) return "+" + v.toLocaleString();
  return v.toLocaleString();
}

export function fmtTimestamp(t) {
  return utcTime(t); // ISP-249 (AB#945)
}

// Ledger names whose words are not simply capitalised (AB#712 books CEO programs as ceo-insight).
const LEDGER_LABELS = { "ceo-insight": "CEO Insight" };

export function prettifyLedgerLabel(key) {
  if (Object.hasOwn(LEDGER_LABELS, key)) return LEDGER_LABELS[key];
  return String(key)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatDurationHours(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0h";
  }
  const totalMinutes = Math.max(0, Math.floor(ms / (1000 * 60)));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

/** ISP-249 (AB#945): today's time alone, else the date and time, in UTC with the in-fiction year. */
export function formatInboxDate(ts) {
  return ts ? utcTime(ts) : "";
}

/**
 * AB#2468: how much of the window the fixed bars cover, at its top and at its bottom. On a phone the navigation is two
 * rows fixed along the top (.app-nav, the open group's tab row and the ☰); a fixed bar in the window's lower half
 * covers its bottom instead. Takes each bar's { top, bottom } and the window's height; returns where the clear part of
 * the window starts and ends.
 */
export function fixedBarEdges(rects, viewportHeight) {
  let top = 0;
  let bottom = viewportHeight;
  for (const r of rects || []) {
    if (!r || !Number.isFinite(r.top) || !(r.bottom > r.top)) continue;
    if (r.top < viewportHeight / 2) top = Math.max(top, r.bottom);
    else bottom = Math.min(bottom, r.top);
  }
  return { top, bottom };
}

/** The fixed navigation bars on the page now, measured (none on a desktop, where the navigation is a column). */
export function fixedBarRects(root = document) {
  return [...root.querySelectorAll(".app-nav, .nav-group__tabs, .app-nav__menu")]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).position === "fixed")
    .map((el) => el.getBoundingClientRect());
}
