import { describe, it, expect } from "vitest";

// starmap.js preloads planet images when it is imported; node has no Image.
globalThis.Image ??= class { set src(_v) {} };
const { systemViewLayout, rightBackButtonY, backButtonTarget, targetHit, backButtonRow, backButtonsBottom } = await import("../../public/scripts/starmap.js");

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
  // AB#1326: the orbits on a desktop canvas now fit its height (h / 2 - 76), which is what stops them crossing its edges.
  it("on a desktop canvas the button stays at (102, 36) round a centred star, and the orbits fit the height", () => {
    const layout = systemViewLayout(881, 393, BUTTON_W);
    expect(layout).toEqual({ cx: 881 / 2, cy: 393 / 2, orbitLimit: 393 / 2 - 56 - 20, button: { x: 102, y: 36 } });
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

// Bug #4687: on a phone the belt view's "Back To Cluster", pulled left to stay on the canvas, was drawn over "Back To
// System". The right-hand button drops a row when the two would touch, and no tap lands on both.
describe("two back buttons never overlap (Bug #4687)", () => {
  it("keeps one row on a wide canvas and drops the right button a row on a phone's", () => {
    expect(rightBackButtonY(108, 138, 250, 130)).toBe(36);
    const y = rightBackButtonY(108, 138, 197, 130);
    expect(y).toBeGreaterThan(36);
    const left = backButtonTarget("back-to-system", 108, 36, 138);
    const right = backButtonTarget("back-to-cluster", 197, y, 130);
    for (let x = 60; x <= 262; x += 2) for (let ty = 10; ty <= y + 30; ty += 2) expect(targetHit(left, x, ty) && targetHit(right, x, ty)).toBe(false);
  });
});

// AB#2482: a moon's view has three back buttons, Back To Planet, Back To System and Back To Cluster.
describe("a row of back buttons (AB#2482)", () => {
  const overlap = (a, b, wa, wb) => {
    const ta = backButtonTarget("a", a.x, a.y, wa);
    const tb = backButtonTarget("b", b.x, b.y, wb);
    return Math.abs(ta.x - tb.x) * 2 < ta.w + tb.w && Math.abs(ta.y - tb.y) * 2 < ta.h + tb.h;
  };
  const widths = [130, 138, 130]; // at a phone's font

  it("on a desktop canvas, three buttons in one row at the usual places", () => {
    // The labels at a desktop's 10px font are about 100px wide (a phone's larger font makes them about 130).
    expect(backButtonRow([100, 104, 106], 900)).toEqual([{ x: 108, y: 36 }, { x: 250, y: 36 }, { x: 392, y: 36 }]);
  });

  it("on a phone's canvas, packed from the left edge in rows; no two targets overlap and all stay on the canvas", () => {
    for (const canvas of [292, 307, 343]) {
      const placed = backButtonRow(widths, canvas);
      expect(placed[0]).toEqual({ x: 6 + widths[0] / 2, y: 36 });
      for (let i = 0; i < placed.length; i += 1) {
        expect(placed[i].x + widths[i] / 2, `button ${i} at ${canvas}`).toBeLessThanOrEqual(canvas);
        expect(placed[i].x - widths[i] / 2).toBeGreaterThanOrEqual(0);
        for (let j = 0; j < i; j += 1) expect(overlap(placed[i], placed[j], widths[i], widths[j]), `${j} and ${i} at ${canvas}`).toBe(false);
      }
      expect(Math.max(...placed.map((p) => p.y))).toBeGreaterThan(36); // three do not fit one row there
    }
  });

  it("packed, two share the first row on a 307px canvas (a 375px phone's), and the lowest edge is where the moon must clear", () => {
    const placed = backButtonRow(widths, 307);
    expect(placed.map((p) => p.y)).toEqual([36, 36, 78]);
    expect(backButtonsBottom(placed)).toBe(78 + 14 + 6);
    expect(backButtonsBottom(backButtonRow([100, 104, 106], 900))).toBe(36 + 14 + 6);
    expect(backButtonsBottom([])).toBe(0);
  });
});
