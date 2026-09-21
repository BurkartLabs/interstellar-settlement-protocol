import { describe, it, expect, beforeEach, afterEach } from "vitest";

// starmap.js preloads planet images when it is imported; node has no Image.
globalThis.Image ??= class { set src(_v) {} };
const { canvasBackingSize, createStarmapController } = await import("../../public/scripts/starmap.js");

// Bug #1286: setCanvasSize floored the backing store at 500px. On a phone the canvas is 292px wide, so the map was
// drawn into the left ~170px while clicks were still tested at full scale: tapping a drawn star missed it.

const SYSTEMS = [
  { id: "sol", name: "Sol", bodies: [] },
  { id: "alpha-centauri", name: "Alpha Centauri", bodies: [] },
  { id: "barnards-star", name: "Barnard's Star", bodies: [] },
  { id: "wolf-359", name: "Wolf 359", bodies: [] },
  { id: "tau-ceti", name: "Tau Ceti", bodies: [] },
  { id: "epsilon-eridani", name: "Epsilon Eridani", bodies: [] }
];

/** A 2D context that draws nothing and records where each star's core dot is drawn, in backing-store pixels. */
function recordingContext() {
  let scale = 1;
  const cores = [];
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "setTransform") return (a) => { scale = a; };
      if (prop === "arc") return (x, y, r) => { if (r === 7 || r === 10) cores.push({ x: x * scale, y: y * scale }); };
      if (prop === "measureText") return () => ({ width: 40 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
      if (prop === "getImageData") return () => ({ data: [] });
      return () => {};
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
  return { ctx, cores, reset() { cores.length = 0; } };
}

/** A canvas laid out in a CSS box of clientWidth x (style height - border), with a 1px border like #starmap-canvas. */
function fakeCanvas(clientWidth, context) {
  const handlers = {};
  const canvas = {
    width: 300, height: 150, hidden: false, style: {}, clientLeft: 1, clientTop: 1,
    clientWidth,
    get clientHeight() { return parseInt(this.style.height || "152", 10) - 2; },
    getContext: () => context.ctx,
    getBoundingClientRect() {
      return { left: 16, top: 200, width: clientWidth + 2, height: this.clientHeight + 2 };
    },
    addEventListener(type, fn) { handlers[type] = fn; },
    handlers
  };
  return canvas;
}

function mountAt(clientWidth, devicePixelRatio) {
  globalThis.window = { devicePixelRatio, innerHeight: 812, addEventListener() {} };
  const context = recordingContext();
  const canvas = fakeCanvas(clientWidth, context);
  const detailsEl = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
  const fallbackEl = { hidden: true, innerHTML: "" };
  const controller = createStarmapController({ canvas, fallbackEl, detailsEl });
  context.reset();
  controller.mount(SYSTEMS);
  return { canvas, detailsEl, cores: [...context.cores] };
}

/** Taps where a star is drawn: backing pixels -> CSS pixels in the content box -> client coordinates. */
function tapDrawnStar(canvas, core) {
  const rect = canvas.getBoundingClientRect();
  const cssX = core.x * (canvas.clientWidth / canvas.width);
  const cssY = core.y * (canvas.clientHeight / canvas.height);
  canvas.handlers.click({ clientX: rect.left + cssX, clientY: rect.top + cssY });
}

describe("canvasBackingSize (Bug #1286)", () => {
  it("follows the CSS box at every width, with no floor", () => {
    expect(canvasBackingSize(292, 558, 1)).toEqual({ width: 292, height: 558, dpr: 1 });
    expect(canvasBackingSize(719, 558, 1)).toEqual({ width: 719, height: 558, dpr: 1 });
  });

  it("multiplies by devicePixelRatio, clamped to 1..2", () => {
    expect(canvasBackingSize(292, 558, 2)).toEqual({ width: 584, height: 1116, dpr: 2 });
    expect(canvasBackingSize(292, 558, 1.5)).toEqual({ width: 438, height: 837, dpr: 1.5 });
    expect(canvasBackingSize(292, 558, 3).dpr).toBe(2);
    expect(canvasBackingSize(292, 558, undefined).dpr).toBe(1);
  });
});

describe("Starmap canvas on a phone (Bug #1286)", () => {
  let savedWindow;
  beforeEach(() => { savedWindow = globalThis.window; });
  afterEach(() => { globalThis.window = savedWindow; });

  for (const dpr of [1, 1.5, 2, 3]) {
    it(`at 292px wide and devicePixelRatio ${dpr}, the backing store is clientWidth x dpr`, () => {
      const { canvas } = mountAt(292, dpr);
      const used = Math.min(2, dpr);
      expect(canvas.width).toBe(Math.round(292 * used));
      expect(canvas.height).toBe(Math.round(canvas.clientHeight * used));
    });
  }

  for (const [label, width, dpr] of [["a phone", 292, 1], ["a phone, dpr 2", 292, 2], ["a phone, dpr 3", 292, 3], ["a desktop", 719, 1]]) {
    it(`on ${label}, tapping where Tau Ceti is drawn opens Tau Ceti`, () => {
      const { canvas, detailsEl, cores } = mountAt(width, dpr);
      expect(cores).toHaveLength(SYSTEMS.length);
      const tau = cores[SYSTEMS.findIndex((s) => s.id === "tau-ceti")];
      // The whole cluster is drawn across the canvas, not squeezed into part of it.
      expect(tau.x / canvas.width).toBeCloseTo(0.72, 2);
      tapDrawnStar(canvas, tau);
      expect(detailsEl.innerHTML).toContain("Tau Ceti");
    });
  }
});
