import { describe, it, expect } from "vitest";
import { createStarfield } from "../../public/scripts/starfield.js";

// AB#964 (ISP-268): the starfield's loop stops while the tab is hidden and under prefers-reduced-motion, and starts
// again when the tab is shown. Driven with a fake window, document and canvas: frames and timers run when the test says.

function world({ hidden = false, reduced = false } = {}) {
  const frames = new Map(), timers = new Map(), listeners = {}, mediaListeners = [];
  let seq = 0, painted = 0;
  const ctx = { clearRect: () => { painted++; }, beginPath() {}, arc() {}, fill() {}, fillStyle: "" };
  const media = { get matches() { return w.reduced; }, addEventListener: (_, fn) => mediaListeners.push(fn) };
  const w = {
    reduced,
    innerWidth: 375, innerHeight: 667,
    matchMedia: () => media,
    requestAnimationFrame: (fn) => { frames.set(++seq, fn); return seq; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (fn) => { timers.set(++seq, fn); return seq; },
    clearTimeout: (id) => timers.delete(id),
    addEventListener() {}
  };
  const doc = { hidden, addEventListener: (type, fn) => { listeners[type] = fn; } };
  const canvas = { getContext: () => ctx, width: 0, height: 0 };
  const field = createStarfield(canvas, { win: w, doc });
  let now = 1000;
  /** Run whatever is scheduled: the waiting frames, then the waiting timers (each schedules the next frame). */
  const tick = () => {
    for (const [id, fn] of [...frames]) { frames.delete(id); fn((now += 200)); }
    for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
  };
  return {
    field, tick, w, doc,
    painted: () => painted,
    scheduled: () => frames.size + timers.size,
    setHidden: (h) => { doc.hidden = h; listeners.visibilitychange?.(); },
    setReduced: (r) => { w.reduced = r; mediaListeners.forEach((fn) => fn()); }
  };
}

describe("ISP-268 the starfield stops when it cannot be seen or should not move (AB#964)", () => {
  it("runs while the tab is shown, stops when it is hidden, and starts again when it is shown", () => {
    const s = world();
    expect(s.field.running()).toBe(true);
    s.tick(); s.tick();
    const before = s.painted();
    expect(before).toBeGreaterThan(1);

    s.setHidden(true);
    expect(s.field.running()).toBe(false);
    expect(s.scheduled()).toBe(0);
    s.tick(); s.tick();
    expect(s.painted()).toBe(before); // nothing drawn, nothing woken, while hidden

    s.setHidden(false);
    expect(s.field.running()).toBe(true);
    s.tick();
    expect(s.painted()).toBeGreaterThan(before);
  });

  it("a tab opened hidden does not start the loop until it is shown", () => {
    const s = world({ hidden: true });
    expect(s.field.running()).toBe(false);
    expect(s.scheduled()).toBe(0);
    s.setHidden(false);
    expect(s.field.running()).toBe(true);
  });

  it("under prefers-reduced-motion the field is drawn once, still, and no loop runs; turning it off starts the drift", () => {
    const s = world({ reduced: true });
    expect(s.field.running()).toBe(false);
    expect(s.scheduled()).toBe(0);
    expect(s.painted()).toBeGreaterThan(0); // the still field
    const still = s.painted();
    s.tick();
    expect(s.painted()).toBe(still);

    s.setReduced(false);
    expect(s.field.running()).toBe(true);
    s.setReduced(true);
    expect(s.field.running()).toBe(false);
    expect(s.scheduled()).toBe(0);
  });
});
