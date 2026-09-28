// public/scripts/timeFormat.js: every timestamp the game shows (ISP-249, AB#945; docs/design/BUREAUCRATIC_UI.md,
// "Timestamps"). One format, on the client and in the server's own text: `YYYY-MM-DD HH:MM UTC`, 24-hour, always UTC
// and always saying so, never a weekday. The date is left out only when it is today's. The year is the in-fiction
// year, the real one + 121 (2026 is 2147): only the year is relabelled, so a player coordinating with someone outside
// the game reads the same day and hour. Machines get the real instant: timeHtml wraps the text in
// <time datetime="...Z">. Account and security email, release notes and legal text keep the real year (realUtcTime).
//
// This is the only module that formats a date for display; tests/unit/timeFormat.test.js fails on a locale date
// formatter anywhere else.

export const FICTION_YEAR_OFFSET = 121;
const pad = (n) => String(n).padStart(2, "0");
const valid = (t) => t !== null && t !== undefined && t !== "" && Number.isFinite(new Date(t).getTime());

/** The in-fiction year of a real UTC year. */
export function fictionYear(realYear) {
  return Number(realYear) + FICTION_YEAR_OFFSET;
}

/** "2147-09-30": the in-fiction date of `t`, UTC. */
export function utcDate(t) {
  if (!valid(t)) return "—";
  const d = new Date(t);
  return `${fictionYear(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "14:05 UTC". */
export function utcClock(t) {
  if (!valid(t)) return "—";
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/**
 * "2147-09-30 14:05 UTC", or "14:05 UTC" when `t` falls on today's UTC date (at `now`). Text a server writes into a
 * notification or a ledger is read later, so it passes { withDate: true }.
 */
export function utcTime(t, { now = Date.now(), withDate = false } = {}) {
  if (!valid(t)) return "—";
  const d = new Date(t);
  const today = new Date(now).toISOString().slice(0, 10) === d.toISOString().slice(0, 10);
  const clock = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  return today && !withDate ? clock : `${utcDate(t)} ${clock}`;
}

/** A deadline: "in 1 h 55 min (2147-09-27 11:55 UTC)" within a day of `now`, else its time with the date. */
export function deadline(t, now = Date.now()) {
  if (!valid(t)) return "—";
  const ms = new Date(t).getTime() - now;
  const at = utcTime(t, { now, withDate: true });
  if (ms <= 0 || ms >= 86_400_000) return at;
  const mins = Math.ceil(ms / 60_000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return `in ${h ? `${h} h ` : ""}${m} min (${at})`;
}

/** The time as HTML: the displayed text in a <time> whose datetime is the real ISO instant. */
export function timeHtml(t, opts) {
  if (!valid(t)) return "—";
  return `<time datetime="${new Date(t).toISOString()}">${utcTime(t, opts)}</time>`;
}

/** Outside the fiction (account email, release notes, legal): the real year, same format. */
export function realUtcTime(t) {
  if (!valid(t)) return "—";
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
