import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { readFileSync as readCatalog } from "node:fs";
// ISP-112 (AB#804): the cluster view's positions come from data/systems.json.
const SYSTEMS_CATALOG = JSON.parse(readCatalog(new URL("../../data/systems.json", import.meta.url), "utf8"));

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
  const rects = [];
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
      if (prop === "roundRect") return (x, y, w, h) => { rects.push({ x, y, w, h }); };
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
      return () => {};
    },
    set(target, prop, value) { if (prop === "font") font = value; else target[prop] = value; return true; }
  });
  return { ctx, labels, arcs, rects, reset() { labels.length = 0; arcs.length = 0; rects.length = 0; } };
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
  const controller = createStarmapController({ canvas, fallbackEl: { hidden: true }, detailsEl, getSystemsCatalog: () => SYSTEMS_CATALOG });
  controller.mount(systems);
  return { canvas, context, detailsEl, controller };
}

/** The star a cluster label belongs to: its core dot (radius 7, or 10 when selected) sits radius + 10 px before the
 * label, or after it when the label is drawn to the left. */
function starOf(context, label) {
  const cores = context.arcs.filter((a) => a.r === 7 || a.r === 10);
  const beside = cores.find((a) => Math.abs(a.y - (label.y - 1)) < 1 &&
    (Math.abs(a.x + a.r + 10 - label.x) < 1 || Math.abs(a.x - a.r - 10 - (label.x + label.width)) < 1));
  if (beside) return beside;
  // ISP-82 (AB#771): a name that would cross another is drawn above or below its star instead; it is then the star
  // nearest the name's box.
  const reach = (a) => Math.hypot(Math.min(Math.max(a.x, label.x), label.x + label.width) - a.x, Math.min(Math.max(a.y, label.y - 10), label.y + 3) - a.y);
  return cores.reduce((best, a) => (reach(a) < reach(best) ? a : best));
}

/** Opens a system by tapping its star. */
function openSystem(map, system) {
  const { context, canvas } = map;
  const label = context.labels.find((l) => l.text === system.name);
  const star = starOf(context, label);
  context.reset();
  canvas.handlers.click({ clientX: star.x, clientY: star.y });
  // AB#1287: the orbits' centre is the star's, which is below the middle when the back button needs the room.
  const halo = context.arcs.find((a) => a.r === 60);
  const centred = context.arcs.filter((a) => Math.abs(a.x - halo.x) < 0.01 && Math.abs(a.y - halo.y) < 0.01);
  const rings = centred.slice(3); // after the star's halo, glow and core: one orbit ring per body, in order
  const bodies = (system.bodies || []).filter((b) => b.type === "Planet" || b.type === "Field");
  return bodies.map((body, i) => {
    const angle = (i / Math.max(1, bodies.length)) * Math.PI * 2;
    const reach = body.type === "Field" ? Math.max(10, body.radius + 5) + 8 : Math.max(4, body.radius) + 8;
    return { body, orbit: rings[i].r, x: halo.x + Math.cos(angle) * rings[i].r, y: halo.y + Math.sin(angle) * rings[i].r, reach };
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

  // AB#1326 replaced "the orbits are exactly the old formula": that formula put the outer bodies past the top and
  // bottom edges. The orbits now also fit the height.
  it("on a desktop canvas (881x393) the orbits fit the height too", () => {
    for (const system of systems) {
      const map = mapAt(881, 427); // innerHeight 427 gives the 393px canvas seen at 1280x800
      const height = map.canvas.clientHeight;
      expect(height).toBe(393);
      const placed = openSystem(map, system);
      const maxX = Math.max(1, ...placed.map((p) => Number(p.body.x || 0)));
      const limit = Math.min(Math.min(881, height) * 0.42, 881 / 2 - 76, height / 2 - 76);
      for (const p of placed) {
        expect(p.orbit, `${system.name} ${p.body.name}`).toBeCloseTo((Number(p.body.x || 0) / maxX) * limit + 56, 6);
      }
    }
  });

  // AB#1326: the canvas sizes measured in the bug (1280x800 and 768x1024 in an iframe) and 1280x800 in a window.
  for (const [width, innerHeight] of [[881, 568], [685, 592], [881, 427]]) {
    it(`at ${width}x${innerHeight - 34}, in every system, every body and its glow is inside the top and bottom edges`, () => {
      for (const system of systems) {
        const map = mapAt(width, innerHeight);
        const height = map.canvas.clientHeight;
        for (const p of openSystem(map, system)) {
          expect(p.y - p.reach, `${system.name} ${p.body.name}`).toBeGreaterThanOrEqual(0);
          expect(p.y + p.reach, `${system.name} ${p.body.name}`).toBeLessThanOrEqual(height);
        }
      }
    });
  }

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

// AB#1287: a phone's canvas sits low on the page, so it gets its 320px floor (innerHeight 354 here, with the canvas at
// the top of a fake page). Saturn was drawn over "Back To Cluster", and a tap on it went Back.
describe("the system view's back button is clear of every body on a phone (AB#1287)", () => {
  for (const width of [292, 307]) {
    it(`at ${width}x320, in every system, no body reaches the button, and each planet opens on a tap`, () => {
      for (const system of systems) {
        const map = mapAt(width, 354);
        expect(map.canvas.clientHeight).toBe(320);
        const placed = openSystem(map, system);
        const button = map.context.rects[0];
        expect(button, system.name).toBeTruthy();
        for (const p of placed) {
          const apart = p.x + p.reach < button.x || p.x - p.reach > button.x + button.w ||
            p.y + p.reach < button.y || p.y - p.reach > button.y + button.h;
          expect(apart, `${system.name} ${p.body.name} at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) vs ${JSON.stringify(button)}`).toBe(true);
          expect(p.y + p.reach, `${system.name} ${p.body.name}`).toBeLessThanOrEqual(320);
        }
        map.context.reset();
        map.canvas.handlers.click({ clientX: button.x + button.w / 2, clientY: button.y + button.h / 2 });
        expect(map.context.labels.map((l) => l.text), `${system.name}: the button goes back to the cluster`).toContain("YOU ARE HERE");
        for (const [i, p] of placed.entries()) {
          if (p.body.type !== "Planet") continue;
          const again = mapAt(width, 354);
          const target = openSystem(again, system)[i];
          again.canvas.handlers.click({ clientX: target.x, clientY: target.y });
          expect(again.detailsEl.innerHTML, `${system.name} ${p.body.name}`).toContain(p.body.name);
        }
      }
    });
  }
});

// AB#1337: a body's label that would pass the right edge was drawn to the left of the body whatever was there, so an
// inner planet right of the star (Centauri Prime at 292px) ran its name across it; and a body left of the star ran
// its right-hand label into it (Sol's Asteroid Belt and Jupiter on a phone, the belt at 1280x800 too). A label now
// takes the first place beside, above or below its body that is clear of the star's 60px halo, and when a body is so
// close to the star that none is, the place farthest from it.
describe("a body's label stays clear of the star (AB#1337)", () => {
  /** The box an 11px label covers, from the baseline fillText was given. */
  const boxOf = (l) => ({ left: l.x, right: l.x + l.width, top: l.y - 9, bottom: l.y + 3 });
  const touches = (box, c) => {
    const nx = Math.min(Math.max(c.x, box.left), box.right);
    const ny = Math.min(Math.max(c.y, box.top), box.bottom);
    return Math.hypot(nx - c.x, ny - c.y) < c.r;
  };

  for (const [width, innerHeight] of [[292, 812], [292, 354], [307, 354], [881, 427], [881, 568], [685, 592]]) {
    it(`at ${width}px wide (innerHeight ${innerHeight}), in every system, no body label touches the star's glow or leaves the canvas`, () => {
      for (const system of systems) {
        const map = mapAt(width, innerHeight);
        const placed = openSystem(map, system);
        const halo = map.context.arcs.find((a) => a.r === 60);
        const glow = map.context.arcs.find((a) => a.r === 28 && a.x === halo.x && a.y === halo.y); // the visible glow
        const labels = map.context.labels.filter((l) => placed.some((p) => p.body.name === l.text));
        expect(labels.length, system.name).toBe(placed.length);
        for (const l of labels) {
          const box = boxOf(l);
          const p = placed.find((b) => b.body.name === l.text);
          const where = `${system.name} ${l.text} at ${JSON.stringify(box)}`;
          expect.soft(touches(box, glow), `${where} is on the star's glow`).toBe(false);
          // Into the faint outer halo only when the body is too near the star for any place beside it to clear it,
          // and then above or below the body, never across the star beside it.
          if (touches(box, halo)) expect.soft(Math.abs(l.y - (p.y - 4)), `${where} is beside its body, in the halo`).toBeGreaterThan(1);
          expect.soft(box.left, where).toBeGreaterThanOrEqual(0);
          expect.soft(box.right, where).toBeLessThanOrEqual(width);
          expect.soft(box.top, where).toBeGreaterThanOrEqual(0);
          expect.soft(box.bottom, where).toBeLessThanOrEqual(map.canvas.clientHeight);
        }
      }
    });
  }

  it("at 292px Centauri Prime's name is above or below the planet, off the star, and the other two cases clear the halo", () => {
    const at = (systemName, bodyName) => {
      const map = mapAt(292, 812);
      const system = systems.find((s) => s.name === systemName);
      const placed = openSystem(map, system);
      const halo = map.context.arcs.find((a) => a.r === 60);
      return { p: placed.find((b) => b.body.name === bodyName), l: map.context.labels.find((x) => x.text === bodyName), halo };
    };
    const prime = at("Alpha Centauri", "Centauri Prime");
    expect(Math.abs(prime.l.y - (prime.p.y - 4))).toBeGreaterThan(1); // not beside it, where it ran across the star
    expect(prime.l.x).toBeGreaterThan(prime.halo.x); // on the planet's side of the star
    for (const [s, b] of [["Sol", "Asteroid Belt"], ["Sol", "Jupiter"]]) {
      const { l, halo } = at(s, b);
      expect(touches(boxOf(l), halo), `${s} ${b}`).toBe(false);
    }
  });

  it("on a desktop canvas a body label with room to the right of its body, clear of the star, has not moved", () => {
    let unmoved = 0;
    for (const system of systems) {
      const map = mapAt(881, 427);
      const placed = openSystem(map, system);
      const halo = map.context.arcs.find((a) => a.r === 60);
      for (const p of placed) {
        const l = map.context.labels.find((x) => x.text === p.body.name);
        const right = { left: p.x + 8, right: p.x + 8 + l.width, top: p.y - 4 - 9, bottom: p.y - 4 + 3 };
        if (right.right > 881 - 4 || touches(right, halo)) continue;
        expect(l.x, `${system.name} ${p.body.name}`).toBeCloseTo(p.x + 8, 6);
        expect(l.y, `${system.name} ${p.body.name}`).toBeCloseTo(p.y - 4, 6);
        unmoved += 1;
      }
    }
    expect(unmoved).toBeGreaterThan(20); // nearly every body: only what crossed the star or the edge moves
  });
});

// AB#1344: every back button's click target was a circle of radius 0.55 x its width (67px for "Back To Cluster"), tested
// before any body. AB#1287 moved the orbits clear of the drawn button but not of that circle, so on a phone the belt
// drawn beside the button, in each of the five systems with one, went Back To Cluster when tapped. The planets tests
// above never tapped a belt. A back button's target is now the button as drawn, plus 6px.
describe("a tap on a body opens it, never a back button (AB#1344)", () => {
  const hasBelt = () => systems.filter((s) => (s.bodies || []).some((b) => b.type === "Field"));

  for (const [width, innerHeight] of [[292, 354], [307, 354], [343, 354], [881, 427]]) {
    it(`at ${width}x${innerHeight - 34}, in every system, a tap on each planet and each belt opens it`, () => {
      expect(hasBelt().length).toBeGreaterThanOrEqual(5);
      for (const system of systems) {
        const count = openSystem(mapAt(width, innerHeight), system).length;
        for (let i = 0; i < count; i += 1) {
          const map = mapAt(width, innerHeight);
          const target = openSystem(map, system)[i];
          map.context.reset();
          map.canvas.handlers.click({ clientX: target.x, clientY: target.y });
          const where = `${system.name} ${target.body.name} at (${target.x.toFixed(0)}, ${target.y.toFixed(0)})`;
          expect(map.context.labels.map((l) => l.text), `${where} went back to the cluster`).not.toContain("YOU ARE HERE");
          expect(map.detailsEl.innerHTML, where).toContain(target.body.name);
        }
      }
    });
  }

  it("Back To Cluster takes a tap on the button and up to 6px around it, and nowhere further", () => {
    const system = hasBelt()[0];
    const tapAt = (dx, dy) => {
      const map = mapAt(307, 354);
      openSystem(map, system);
      const b = map.context.rects[0];
      map.context.reset();
      map.canvas.handlers.click({ clientX: b.x + b.w / 2 + dx(b), clientY: b.y + b.h / 2 + dy(b) });
      return map.context.labels.some((l) => l.text === "YOU ARE HERE");
    };
    expect(tapAt(() => 0, () => 0), "the button's centre").toBe(true);
    expect(tapAt((b) => b.w / 2 - 2, (b) => b.h / 2 + 5), "5px below its bottom-right corner").toBe(true);
    expect(tapAt(() => 0, (b) => b.h / 2 + 8), "8px below it").toBe(false);
    expect(tapAt(() => 0, (b) => b.h / 2 + 30), "30px below it, which the old circle took").toBe(false);
  });

  it("a belt's own view, on a phone: Back To System and Back To Cluster each do what they say", () => {
    for (const system of hasBelt()) {
      const open = (button) => {
        const map = mapAt(307, 354);
        const belt = openSystem(map, system).find((p) => p.body.type === "Field");
        map.context.reset();
        map.canvas.handlers.click({ clientX: belt.x, clientY: belt.y });
        const b = map.context.rects[button];
        map.context.reset();
        map.canvas.handlers.click({ clientX: b.x + b.w / 2, clientY: b.y + b.h / 2 });
        return map.context.labels.map((l) => l.text);
      };
      expect(open(0), `${system.name}: Back To System`).toContain("◂ Back To Cluster");
      expect(open(0), `${system.name}: Back To System`).not.toContain("YOU ARE HERE");
      expect(open(1), `${system.name}: Back To Cluster`).toContain("YOU ARE HERE");
    }
  });
});
