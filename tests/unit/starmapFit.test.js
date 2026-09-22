import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";

// starmap.js preloads planet images when it is imported; node has no Image.
globalThis.Image ??= class { set src(_v) {} };
const { createStarmapController } = await import("../../public/scripts/starmap.js");

// Bug #1315: with the map drawn at its real width on a phone (#1286), the system view's outer orbits ran past the
// canvas sides (0.42 of 292px plus 56 is 179px from a 146px centre) and labels ran off the right edge. Orbits now
// also fit the width, and a label that would pass the right edge is drawn to the left of its point. A desktop canvas
// is wide enough that neither binds, so its layout is unchanged.

const CHAR_WIDTH = { 9: 5.2, 11: 6.2, 12: 7 }; // close to Inter at these sizes; measured labels ~6px a character

/** A 2D context that draws nothing and records labels (with measured widths) and arcs, in CSS pixels. */
function recordingContext() {
  const labels = [];
  const arcs = [];
  let font = '11px "Inter", sans-serif';
  const gradient = { addColorStop() {} };
  const measure = (text) => String(text).length * (CHAR_WIDTH[parseInt(font.match(/(\d+)px/)?.[1], 10)] || 6.2);
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop === "font") return font;
      if (prop in target) return target[prop];
      if (prop === "fillText") return (text, x, y) => { labels.push({ text, x, y, width: measure(text) }); };
      if (prop === "measureText") return (text) => ({ width: measure(text) });
      if (prop === "arc") return (x, y, r) => { arcs.push({ x, y, r }); };
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
      return () => {};
    },
    set(target, prop, value) { if (prop === "font") font = value; else target[prop] = value; return true; }
  });
  return { ctx, labels, arcs, reset() { labels.length = 0; arcs.length = 0; } };
}

function fakeCanvas(context, width, height) {
  const handlers = {};
  return {
    width: 1, height: 1, hidden: false, style: {}, clientWidth: width,
    get clientHeight() { return parseInt(this.style.height || String(height), 10); },
    getContext: () => context.ctx,
    getBoundingClientRect() { return { left: 0, top: 0, width, height: this.clientHeight }; },
    addEventListener(type, fn) { handlers[type] = fn; },
    handlers
  };
}

let systems;
let savedWindow;
beforeAll(async () => {
  savedWindow = globalThis.window;
  const { app } = await getApp();
  systems = (await request(app).get("/api/bootstrap")).body.world.systems;
});
afterAll(() => { globalThis.window = savedWindow; });

/** A Starmap at width x height (innerHeight sets the canvas height the way setCanvasSize does). */
function mapAt(width, innerHeight) {
  globalThis.window = { devicePixelRatio: 1, innerHeight, addEventListener() {} };
  const context = recordingContext();
  const canvas = fakeCanvas(context, width, 558);
  const detailsEl = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
  const controller = createStarmapController({ canvas, fallbackEl: { hidden: true }, detailsEl });
  controller.mount(systems);
  return { canvas, context, detailsEl, controller };
}

/** The star a cluster label belongs to: its core dot (radius 7, or 10 when selected) sits radius + 10 px before the
 * label, or after it when the label is drawn to the left. */
function starOf(context, label) {
  return context.arcs.find((a) => (a.r === 7 || a.r === 10) && Math.abs(a.y - (label.y - 1)) < 1 &&
    (Math.abs(a.x + a.r + 10 - label.x) < 1 || Math.abs(a.x - a.r - 10 - (label.x + label.width)) < 1));
}

/** Opens a system by tapping its star. */
function openSystem(map, system) {
  const { context, canvas } = map;
  const label = context.labels.find((l) => l.text === system.name);
  const star = starOf(context, label);
  context.reset();
  canvas.handlers.click({ clientX: star.x, clientY: star.y });
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const centred = context.arcs.filter((a) => Math.abs(a.x - width / 2) < 0.01 && Math.abs(a.y - height / 2) < 0.01);
  const rings = centred.slice(3); // after the star's halo, glow and core: one orbit ring per body, in order
  const bodies = (system.bodies || []).filter((b) => b.type === "Planet" || b.type === "Field");
  return bodies.map((body, i) => {
    const angle = (i / Math.max(1, bodies.length)) * Math.PI * 2;
    const reach = body.type === "Field" ? Math.max(10, body.radius + 5) + 8 : Math.max(4, body.radius) + 8;
    return { body, orbit: rings[i].r, x: width / 2 + Math.cos(angle) * rings[i].r, y: height / 2 + Math.sin(angle) * rings[i].r, reach };
  });
}

describe("the Starmap fits a phone's width (Bug #1315)", () => {
  it("at 292px every cluster label ends inside the canvas", () => {
    const { context, canvas } = mapAt(292, 812);
    const labels = context.labels.filter((l) => systems.some((s) => s.name === l.text) || l.text === "YOU ARE HERE");
    expect(labels.length).toBeGreaterThanOrEqual(systems.length);
    for (const l of labels) {
      expect(l.x, l.text).toBeGreaterThanOrEqual(0);
      expect(l.x + l.width, l.text).toBeLessThanOrEqual(canvas.clientWidth);
    }
  });

  it("at 292px, in every system, every body and its glow is inside the canvas and every label ends inside it", () => {
    for (const system of systems) {
      const map = mapAt(292, 812);
      const placed = openSystem(map, system);
      expect(placed.length, system.name).toBeGreaterThan(0);
      for (const p of placed) {
        expect(p.x - p.reach, `${system.name} ${p.body.name}`).toBeGreaterThanOrEqual(0);
        expect(p.x + p.reach, `${system.name} ${p.body.name}`).toBeLessThanOrEqual(292);
      }
      for (const l of map.context.labels.filter((l) => placed.some((p) => p.body.name === l.text))) {
        expect(l.x + l.width, `${system.name} ${l.text}`).toBeLessThanOrEqual(292);
        expect(l.x, `${system.name} ${l.text}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("at 292px a tap on each drawn body opens it", () => {
    for (const system of systems) {
      for (const [i] of (system.bodies || []).filter((b) => b.type === "Planet").entries()) {
        const map = mapAt(292, 812);
        const target = openSystem(map, system).filter((p) => p.body.type === "Planet")[i];
        map.canvas.handlers.click({ clientX: target.x, clientY: target.y });
        expect(map.detailsEl.innerHTML, `${system.name} ${target.body.name}`).toContain(target.body.name);
      }
    }
  });

  it("on a desktop canvas (881x393) the orbits are exactly the old formula", () => {
    for (const system of systems) {
      const map = mapAt(881, 427); // innerHeight 427 gives the 393px canvas seen at 1280x800
      const height = map.canvas.clientHeight;
      expect(height).toBe(393);
      const placed = openSystem(map, system);
      const maxX = Math.max(1, ...placed.map((p) => Number(p.body.x || 0)));
      for (const p of placed) {
        expect(p.orbit, `${system.name} ${p.body.name}`).toBeCloseTo((Number(p.body.x || 0) / maxX) * Math.min(881, height) * 0.42 + 56, 6);
      }
    }
  });

  it("on a desktop canvas no cluster label moves: each starts right of its star", () => {
    const { context } = mapAt(881, 427);
    for (const s of systems) {
      const l = context.labels.find((x) => x.text === s.name);
      const star = starOf(context, l);
      expect(star, s.name).toBeTruthy();
      expect(l.x, s.name).toBeCloseTo(star.x + star.r + 10, 6); // to the right of its star, as before
    }
  });
});
