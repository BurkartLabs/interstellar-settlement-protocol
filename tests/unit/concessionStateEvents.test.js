import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NOTE_EVENTS, STATE_EVENTS } from "../../server/concessions.js";

// Bug #4854: a holder's state at a moment is read from the concession register's last STATE event. An event nobody put
// in either list would be read wrongly one way or the other, so every event server/concessions.js writes is held to
// exactly one list: a state it leaves the holder in, or a note that changes nothing.
const source = readFileSync(new URL("../../server/concessions.js", import.meta.url), "utf8");

/** Every event name a note(...) call in concessions.js can write, including both arms of a ternary. */
function writtenEvents() {
  const names = new Set();
  for (const m of source.matchAll(/\bnote\(\s*[^,]+,\s*[^,]+,\s*([^,]+),/g)) {
    const written = m[1].includes("?") ? m[1].slice(m[1].indexOf("?") + 1) : m[1]; // a ternary's arms, not its test
    for (const lit of written.matchAll(/"([a-z-]+)"/g)) names.add(lit[1]);
  }
  return [...names].sort();
}

describe("the concession register's events are each a state or a note (Bug #4854)", () => {
  it("finds the events the file writes (the scan is not empty)", () => {
    expect(writtenEvents()).toEqual(expect.arrayContaining(["granted", "lapsed", "lease-modifier", "petitioned", "challenged"]));
  });

  it("classifies every written event exactly once", () => {
    const states = Object.keys(STATE_EVENTS);
    for (const e of writtenEvents()) {
      expect([states.includes(e), NOTE_EVENTS.includes(e)].filter(Boolean), `${e} must be in STATE_EVENTS or NOTE_EVENTS`).toHaveLength(1);
    }
  });

  it("a lease-discount change is a note, never a state", () => {
    expect(NOTE_EVENTS).toContain("lease-modifier");
    expect(Object.hasOwn(STATE_EVENTS, "lease-modifier")).toBe(false);
    expect(Object.values(STATE_EVENTS).sort()).toEqual(["grace", "granted", "granted", "granted", "lapsed"]);
  });
});
