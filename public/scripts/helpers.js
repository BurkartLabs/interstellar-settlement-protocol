// AB#738 (ISP-52): the shared formatting helpers, moved out of app.js so each is defined once. They are not merged
// with each other: fmtCredits ("1,234"), toCurrency ("$1,234"), formatDuration ("1h 5m" / "5m 3s" / "3s") and
// formatDurationHours ("1h 5m", "0h") each render differently on screen, and this split changes no behaviour.
import { utcTime } from "./timeFormat.js"; // ISP-249 (AB#945): one format for every timestamp

export function toCurrency(number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(number);
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
