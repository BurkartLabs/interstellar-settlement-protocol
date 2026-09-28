// AB#2484 (Board review item 31): what a mission asks for, and how much of it is still to do. Pure, so the page, a
// test and the server can all read it.
//
// ─── THE PATTERN FOR EVERY MISSION TYPE ────────────────────────────────────────────────────────────────────────────
// A player should never have to work out what a contract still needs. Every kind of mission therefore answers two
// questions, here, and the Assignments views (views/assignments.js) show only what these functions return:
//
//   1. missionTarget(mission): the whole of what it asks, e.g. "400 Silicates". Shown BEFORE the player accepts: on
//      the offer card in the agent's office and in the briefing.
//   2. missionProgress(mission, context): how much is done, and how much REMAINS, e.g. "250 Silicates still needed".
//      Shown WHILE it is active: on the active contract's card and in the briefing. It is worked out from the
//      corporation's state on every render and never stored, so it follows progress as it happens (the mining:updated
//      event redraws the contracts), and it reaches 0 exactly when the server would accept the contract as complete.
//
// A new mission kind (a `kind` on the offer; data/missions.json templates, built in server/game/corporation.js) adds a
// case to both functions. It does not add a template of its own to the views. Today there are two kinds:
//   - a quota (the default): mine or source `quota.amount` of `quota.resource` and deliver it. Progress is the stock
//     at the station it is handed in at, the agent's station, which is the stock complete-mission takes
//     (server/routes/missions.js).
//   - "time-served" (the Salvage Assignment): serve `hoursRequired` hours from `acceptedAt`. Progress is time.
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const HOUR = 3_600_000;
const title = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
const count = (n) => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString("en-US");

/** Hours and minutes, e.g. "3 h 20 min", "45 min". */
export function hoursText(ms) {
  const mins = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/** { amount, unit, text }: the whole of what `mission` asks, shown before it is accepted. Null if it asks nothing. */
export function missionTarget(mission) {
  if (!mission) return null;
  if (mission.kind === "time-served") {
    const hours = Number(mission.hoursRequired) || 0;
    return { amount: hours, unit: "hours", text: `${hours} ${hours === 1 ? "hour" : "hours"} of service` };
  }
  const amount = Number(mission.quota?.amount) || 0;
  if (!amount) return null;
  const unit = title(mission.quota.resource);
  return { amount, unit, text: `${count(amount)} ${unit}` };
}

/**
 * { target, done, remaining, pct, complete, remainingText, doneText } for an active `mission`, from the corporation's
 * state now. `context`: { inventory } (corp.inventory, by station), `stationId` (where it is handed in: the agent's
 * station), `now`. Null for a mission that asks nothing.
 */
export function missionProgress(mission, { inventory = {}, stationId, now = Date.now() } = {}) {
  const target = missionTarget(mission);
  if (!target) return null;
  if (mission.kind === "time-served") {
    const requiredMs = target.amount * HOUR;
    const doneMs = Math.min(requiredMs, Math.max(0, now - Number(mission.acceptedAt || now)));
    const remainingMs = requiredMs - doneMs;
    return {
      target, done: doneMs / HOUR, remaining: remainingMs / HOUR,
      pct: requiredMs ? Math.round((doneMs / requiredMs) * 100) : 100,
      complete: remainingMs <= 0,
      remainingText: remainingMs > 0 ? `${hoursText(remainingMs)} still to serve` : "Time served",
      doneText: `${hoursText(doneMs)} of ${target.text}`
    };
  }
  const have = Math.max(0, Number(inventory?.[stationId]?.[mission.quota.resource]) || 0);
  const done = Math.min(have, target.amount);
  const remaining = target.amount - done;
  return {
    target, done, remaining,
    pct: Math.min(100, Math.floor((done / target.amount) * 100)),
    complete: remaining <= 0,
    remainingText: remaining > 0 ? `${count(remaining)} ${target.unit} still needed` : `Quota met: ${target.text}`,
    doneText: `${count(done)} of ${target.text} in stock`
  };
}
