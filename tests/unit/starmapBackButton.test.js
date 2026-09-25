import { describe, it, expect } from "vitest";

// starmap.js preloads planet images when it is imported; node has no Image.
globalThis.Image ??= class { set src(_v) {} };
const { systemViewLayout } = await import("../../public/scripts/starmap.js");

// AB#1287: on a phone (a 307x320 canvas: its 320px floor, since the map sits low on the page) the system view's
// "Back To Cluster" button sat where the outer orbits reach, so Saturn was drawn over it and a tap there went Back.
// The layout keeps the button clear of every orbit (the whole circle, glow margin included), moving the button into
// the corner and fitting the orbits beside it only when its usual place is in the way.
const BUTTON_W = 103; // "Back To Cluster" at 10px Inter, plus padding
const BUTTON_H = 28;

function box(layout) {
  return {
    left: layout.button.x - BUTTON_W / 2, right: layout.button.x + BUTTON_W / 2,
    top: layout.button.y - BUTTON_H / 2, bottom: layout.button.y + BUTTON_H / 2
  };
}

/** The distance from the orbits' centre to the nearest point of the button. */
function clearance(layout) {
  const b = box(layout);
  const dx = Math.max(b.left - layout.cx, 0, layout.cx - b.right);
  const dy = Math.max(b.top - layout.cy, 0, layout.cy - b.bottom);
  return Math.hypot(dx, dy);
}

describe("the system view keeps its back button clear of the orbits (AB#1287)", () => {
  it("on a desktop canvas nothing moves: the button stays at (102, 36) and the orbits keep the old formula", () => {
    const layout = systemViewLayout(881, 393, BUTTON_W);
    expect(layout).toEqual({ cx: 881 / 2, cy: 393 / 2, orbitLimit: Math.min(881, 393) * 0.42, button: { x: 102, y: 36 } });
  });

  for (const [w, h] of [[307, 320], [292, 320], [343, 320], [307, 400]]) {
    it(`at ${w}x${h} the outermost orbit clears the button and stays inside the canvas`, () => {
      const layout = systemViewLayout(w, h, BUTTON_W);
      const reach = layout.orbitLimit + 56 + 20; // outermost orbit, plus the body's glow margin
      expect(clearance(layout)).toBeGreaterThanOrEqual(reach - 1e-6);
      expect(layout.cy + reach).toBeLessThanOrEqual(h + 1e-6);
      expect(layout.cx - reach).toBeGreaterThanOrEqual(-1e-6);
      expect(layout.cx + reach).toBeLessThanOrEqual(w + 1e-6);
      const b = box(layout);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.top).toBeGreaterThanOrEqual(0);
    });
  }

  it("at 307x320 the orbits shrink by no more than a tenth to make the room", () => {
    const layout = systemViewLayout(307, 320, BUTTON_W);
    const before = Math.min(307 * 0.42, 307 / 2 - 56 - 20);
    expect(layout.orbitLimit).toBeGreaterThanOrEqual(before * 0.9);
  });
});
