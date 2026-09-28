import { describe, it, expect } from "vitest";
import { scheduleRndQueue, nextRndStart, rndItemStatus, rndItemEndsAt, formatHoursMinutes, rndQueueRoom, RND_QUEUE_LIMIT } from "../../public/scripts/rndQueue.js";

// Bug #1258: Corporate R&D researches one technology at a time.
const H = 3_600_000;
const T0 = 1_800_000_000_000;
const item = (techId, durationHours, startedAt) => ({ id: `rnd-${techId}`, techId, name: techId, durationHours, startedAt });

describe("the R&D schedule (Bug #1258)", () => {
  it("two items queued together run one after the other: at 3 h only the first is done, at 7 h both", () => {
    const queue = [];
    queue.push(item("safety", 3, nextRndStart(queue, T0)));
    queue.push(item("forecast", 4, nextRndStart(queue, T0)));
    expect(queue.map((i) => i.startedAt)).toEqual([T0, T0 + 3 * H]);

    expect(rndItemStatus(queue[1], T0 + H)).toEqual({ state: "queued", startsInMs: 2 * H, remainingMs: 6 * H });
    expect(queue.map((i) => rndItemStatus(i, T0 + 3 * H).state)).toEqual(["done", "running"]);
    expect(queue.map((i) => rndItemStatus(i, T0 + 7 * H - 1).state)).toEqual(["done", "running"]);
    expect(queue.map((i) => rndItemStatus(i, T0 + 7 * H).state)).toEqual(["done", "done"]);
  });

  it("an item queued after the one ahead has already finished starts now, not in the past", () => {
    const queue = [item("safety", 3, T0)];
    expect(nextRndStart(queue, T0 + 5 * H)).toBe(T0 + 5 * H);
    expect(nextRndStart([], T0)).toBe(T0);
  });

  it("a queue saved before the fix, all started together, is pushed back in order and never finished early", () => {
    // Three items queued at the same moment ran in parallel before the fix.
    const queue = [item("a", 2, T0), item("b", 3, T0), item("c", 4, T0 + 60_000)];
    scheduleRndQueue(queue, T0 + H);
    expect(queue.map((i) => i.startedAt)).toEqual([T0, T0 + 2 * H, T0 + 5 * H]);
    expect(queue.map((i) => rndItemEndsAt(i))).toEqual([T0 + 2 * H, T0 + 5 * H, T0 + 9 * H]);
    // Never earlier than it would have finished before: each end is at or after its old parallel end.
    expect(rndItemEndsAt(queue[2])).toBeGreaterThanOrEqual(T0 + 60_000 + 4 * H);
    // Scheduling again changes nothing.
    const again = scheduleRndQueue(queue.map((i) => ({ ...i })), T0 + 3 * H);
    expect(again.map((i) => i.startedAt)).toEqual(queue.map((i) => i.startedAt));
  });

  it("an item is never moved earlier, and an item with no start takes now", () => {
    const queue = [item("a", 1, T0), item("b", 1, T0 + 10 * H), item("c", 1, 0)];
    scheduleRndQueue(queue, T0 + 12 * H);
    expect(queue.map((i) => i.startedAt)).toEqual([T0, T0 + 10 * H, T0 + 12 * H]);
  });

  it("when the head completes and is removed, the next keeps its place and runs to its own end", () => {
    const queue = scheduleRndQueue([item("a", 3, T0), item("b", 4, T0)], T0);
    const rest = queue.slice(1);
    scheduleRndQueue(rest, T0 + 3 * H);
    expect(rest[0].startedAt).toBe(T0 + 3 * H);
    expect(rndItemStatus(rest[0], T0 + 3 * H)).toEqual({ state: "running", startsInMs: 0, remainingMs: 4 * H });
  });

  it("formats time as the queue cards show it", () => {
    expect(formatHoursMinutes(2 * H + 5 * 60_000 + 59_000)).toBe("2h 5m");
    expect(formatHoursMinutes(-5)).toBe("0h 0m");
  });
});

describe("the R&D queue holds the item in progress and one behind it (AB#2476)", () => {
  it("room while fewer than two are unfinished; full with one running and one waiting, until the running one ends", () => {
    expect(RND_QUEUE_LIMIT).toBe(2);
    expect(rndQueueRoom([], T0)).toEqual({ ok: true, pending: 0 });
    expect(rndQueueRoom(undefined, T0).ok).toBe(true);
    const running = item("safety", 3, T0);
    expect(rndQueueRoom([running], T0 + H)).toEqual({ ok: true, pending: 1 });
    const full = rndQueueRoom([running, item("forecast", 4, T0 + 3 * H)], T0 + H);
    expect(full).toMatchObject({ ok: false, pending: 2, freesAt: T0 + 3 * H });
    expect(full.finishing.techId).toBe("safety");
  });

  it("a finished item the tick has not removed yet takes no place, so the waiting one rolls forward and there is room", () => {
    const queue = [item("safety", 3, T0), item("forecast", 4, T0 + 3 * H)];
    expect(rndQueueRoom(queue, T0 + 3 * H - 1).ok).toBe(false);
    expect(rndQueueRoom(queue, T0 + 3 * H)).toEqual({ ok: true, pending: 1 });
  });

  it("a queue saved longer than the limit keeps its items and takes nothing new until it is below it", () => {
    // Three items saved the old way, all stamped T0: scheduled, they end at 2 h, 5 h and 9 h.
    const queue = [item("a", 2, T0), item("b", 3, T0), item("c", 4, T0)];
    const room = rndQueueRoom(queue, T0 + H);
    expect(room).toMatchObject({ ok: false, pending: 3, freesAt: T0 + 5 * H });
    expect(room.finishing.techId).toBe("b");
    expect(queue.map((i) => i.startedAt)).toEqual([T0, T0, T0]); // measured on a copy: the saved queue is untouched
    expect(rndQueueRoom(queue, T0 + 5 * H).ok).toBe(true);
  });
});
