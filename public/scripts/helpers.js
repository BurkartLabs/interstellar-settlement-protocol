// AB#738 (ISP-52): the shared formatting helpers, moved out of app.js so each is defined once. They are not merged
// with each other: fmtCredits ("1,234"), toCurrency ("$1,234"), formatDuration ("1h 5m" / "5m 3s" / "3s") and
// formatDurationHours ("1h 5m", "0h") each render differently on screen, and this split changes no behaviour.

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

export function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
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
  if (!t) return "—";
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

export function formatInboxDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
