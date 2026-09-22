import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mutateState, dataDir } from "../../server/gameState.js";

// Bug #1447: the world state's 300 ms debounce restarted on every change, so while changes kept coming nothing was
// written, and a crash lost everything since the last quiet moment.
const onDisk = () => JSON.parse(fs.readFileSync(path.join(dataDir, "state.json"), "utf8")).saveProbe;

describe("the world state is written while it keeps changing (Bug #1447)", () => {
  afterEach(() => vi.useRealTimers());

  it("a change every 100 ms still reaches disk within 300 ms of the first unsaved one", () => {
    vi.useFakeTimers();
    let n = 0;
    for (let i = 0; i < 30; i++) {
      mutateState((s) => { s.saveProbe = ++n; });
      vi.advanceTimersByTime(100);
      // By 300 ms after the first change, a write has happened, and the file is never more than 300 ms behind.
      if (i >= 2) expect(onDisk(), `after ${(i + 1) * 100} ms`).toBeGreaterThanOrEqual(n - 3);
    }
    vi.advanceTimersByTime(300);
    expect(onDisk()).toBe(30);
  });

  it("one change is written once, 300 ms later, not before", () => {
    vi.useFakeTimers();
    vi.advanceTimersByTime(1000); // nothing pending from the test before
    mutateState((s) => { s.saveProbe = "single"; });
    vi.advanceTimersByTime(299);
    expect(onDisk()).not.toBe("single");
    vi.advanceTimersByTime(1);
    expect(onDisk()).toBe("single");
  });
});
