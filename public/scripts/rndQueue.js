// Corporate R&D researches one technology at a time (Bug #1258). Shared by the server, which completes and stamps
// queue items, and the R&D panel, which shows them, so both read the same schedule.

const HOUR_MS = 3_600_000;

function durationMs(item) {
  const hours = Number(item?.durationHours);
  return Number.isFinite(hours) && hours > 0 ? hours * HOUR_MS : 0;
}

/** When an item finishes, from its stored start. */
export function rndItemEndsAt(item) {
  return Number(item?.startedAt || 0) + durationMs(item);
}

/**
 * Put the queue in sequence: each item starts at the later of its own stored start and the end of the item ahead
 * of it. An item is only ever moved later, never earlier, so research queued before this fix (every item stamped
 * with the moment it was queued, all running at once) is pushed back behind the item ahead: not lost, not finished
 * early. An item with no start takes `now`. Mutates and returns the queue.
 */
export function scheduleRndQueue(queue, now) {
  if (!Array.isArray(queue)) return queue;
  let previousEnd = 0;
  for (const item of queue) {
    if (!item || typeof item !== "object") continue;
    const stored = Number(item.startedAt || 0) || now;
    item.startedAt = Math.max(stored, previousEnd);
    previousEnd = rndItemEndsAt(item);
  }
  return queue;
}

/** The start a newly queued item gets: now, or when the last item in the queue finishes if that is later. */
export function nextRndStart(queue, now) {
  const last = Array.isArray(queue) && queue.length ? queue[queue.length - 1] : null;
  return last ? Math.max(now, rndItemEndsAt(last)) : now;
}

/** Where an item stands at `now`: queued (with startsInMs), running (with remainingMs) or done. */
export function rndItemStatus(item, now) {
  const startedAt = Number(item?.startedAt || 0);
  const endsAt = rndItemEndsAt(item);
  if (startedAt > now) return { state: "queued", startsInMs: startedAt - now, remainingMs: endsAt - now };
  if (now < endsAt) return { state: "running", startsInMs: 0, remainingMs: endsAt - now };
  return { state: "done", startsInMs: 0, remainingMs: 0 };
}

/** "3h 12m", as the queue cards show time. */
export function formatHoursMinutes(ms) {
  const safe = Math.max(0, ms);
  return `${Math.floor(safe / HOUR_MS)}h ${Math.floor((safe % HOUR_MS) / 60_000)}m`;
}
