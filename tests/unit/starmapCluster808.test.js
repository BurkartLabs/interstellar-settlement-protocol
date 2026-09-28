import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { navigationFor, lanePairs } from "../../public/scripts/navigation.js";

// ISP-116 (AB#808): the cluster view stays legible as the catalog grows: every system named with no two names
// overlapping on a desktop canvas, only the current system, the selected one and their neighbours named on a phone
// (docs/design/starmap-20.md), lanes only between adjacent systems, a locked system drawn apart and naming its gate
// when selected, and the list fallback covering every system.
const read = (rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8"));
const SYSTEMS = read("data/systems.json");
const RESEARCH = read("data/research.json").nodes;
const DEEP_STAR = RESEARCH.find((n) => n.id === "tt-deep-star-navigation").name;

globalThis.Image ??= class { set src(_v) {} }; // starmap.js preloads planet images
globalThis.window ??= { devicePixelRatio: 1, innerHeight: 900, innerWidth: 1440, addEventListener() {} };
const { planClusterLabels, createStarmapController } = await import("../../public/scripts/starmap.js");

/** An 11px Inter line is about 6.2px a character; the test only needs widths of the right size. */
const widthOf = (text, size) => text.length * size * 0.56;
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function entriesAt(width, height, { current = "sol", selected = null, compact = false } = {}) {
  const nav = navigationFor(SYSTEMS);
  const adjacent = (id) => SYSTEMS.find((s) => s.id === id)?.adjacent || [];
  const neighbours = new Set(adjacent(selected || current)); // the selected system's, as drawClusterView takes them
  return SYSTEMS.map((s) => {
    const isSelected = s.id === selected;
    const size = compact ? 14 : isSelected ? 12 : 11;
    const lines = [s.name, ...(s.id === current ? ["YOU ARE HERE"] : [])];
    if (isSelected && !compact && !nav.canReachSystem([], current, s.id)) lines.push(`Requires ${nav.travelResearchName(RESEARCH, s.id)}`);
    return {
      id: s.id, x: s.mapPosition.x * width, y: s.mapPosition.y * height, r: (isSelected ? 10 : 7) + 4,
      widths: lines.map((t) => widthOf(t, size)), size, gap: (isSelected ? 10 : 7) + 10,
      current: s.id === current, selected: isSelected, neighbour: neighbours.has(s.id)
    };
  });
}

describe("the cluster view's names (ISP-116)", () => {
  // The canvas at 1440x900 is the Starmap panel's width by min(62vh, 560px) (e2e/starmap-cluster-808.spec.js prints it);
  // the design's desktop sketch is 1050x560.
  for (const [w, h] of [[1058, 560], [1050, 560]]) {
    it(`names every system on a ${w}x${h} canvas, and no two names overlap or cover a star`, () => {
      const entries = entriesAt(w, h);
      const plan = planClusterLabels({ entries, compact: false, canvasWidth: w, canvasHeight: h });
      expect([...plan.keys()].sort()).toEqual(SYSTEMS.map((s) => s.id).sort());
      const boxes = [...plan.entries()];
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) expect(overlaps(boxes[i][1].box, boxes[j][1].box), `${boxes[i][0]} / ${boxes[j][0]}`).toBe(false);
      }
    });
  }

  it("on a phone names the current system, the selected one and its neighbours only, overlapping none and inside the canvas", () => {
    const sol = SYSTEMS.find((s) => s.id === "sol");
    const check = (plan, allowed, must) => {
      const named = [...plan.keys()];
      for (const id of must) expect(named, `${id} is named`).toContain(id);
      for (const id of named) expect(allowed, `${id} may be named`).toContain(id);
      const boxes = [...plan.values()].map((p) => p.box);
      for (let i = 0; i < boxes.length; i += 1) {
        expect(boxes[i].left).toBeGreaterThanOrEqual(0);
        expect(boxes[i].right).toBeLessThanOrEqual(324);
        for (let j = i + 1; j < boxes.length; j += 1) expect(overlaps(boxes[i], boxes[j]), `${named[i]} / ${named[j]}`).toBe(false);
      }
      return named;
    };
    const home = planClusterLabels({ entries: entriesAt(324, 320, { compact: true }), compact: true, canvasWidth: 324, canvasHeight: 320 });
    const homeNamed = check(home, ["sol", ...sol.adjacent], ["sol"]);
    expect(homeNamed.length, "Sol and at least two neighbours").toBeGreaterThanOrEqual(3);
    for (const far of SYSTEMS.filter((s) => s.id !== "sol" && !sol.adjacent.includes(s.id))) {
      const picked = planClusterLabels({ entries: entriesAt(324, 320, { selected: far.id, compact: true }), compact: true, canvasWidth: 324, canvasHeight: 320 });
      check(picked, ["sol", far.id, ...far.adjacent], ["sol", far.id]);
    }
  });

  it("keeps a name that finds no clear place on the canvas, rather than off its edge", async () => {
    const { clusterLabelAt } = await import("../../public/scripts/starmap.js");
    const label = clusterLabelAt({ widths: [250], size: 14, x: 40, y: 40, gap: 17, placed: [{ left: 0, right: 324, top: 0, bottom: 320 }], stars: [], canvasWidth: 324, canvasHeight: 320 });
    expect(label.clear).toBe(false);
    expect(label.box.left).toBeGreaterThanOrEqual(0);
    expect(label.box.right).toBeLessThanOrEqual(324);
  });

  it("puts the names that matter first: the current system keeps its first choice however crowded the rest", () => {
    const entries = entriesAt(1058, 560);
    const alone = planClusterLabels({ entries: entries.filter((e) => e.current), compact: false, canvasWidth: 1058, canvasHeight: 560 });
    const all = planClusterLabels({ entries, compact: false, canvasWidth: 1058, canvasHeight: 560 });
    expect(all.get("sol")).toEqual(alone.get("sol"));
  });
});

// The controller on a fake canvas that records what it writes and draws.
const saved = globalThis.window;
afterEach(() => { globalThis.window = saved; });
function mapAt(width, height, { unlockedTech = [], graphics = true } = {}) {
  globalThis.window = { devicePixelRatio: 1, innerHeight: height, addEventListener() {} };
  const writes = [];
  const lines = [];
  const gradient = { addColorStop() {} };
  let at = null;
  const ctx = new Proxy({}, {
    get: (t, p) => {
      if (p in t) return t[p];
      if (p === "measureText") return (text) => ({ width: widthOf(String(text), 11) });
      if (p === "fillText") return (text, x, y) => writes.push({ text: String(text), x, y, font: t.font, fill: t.fillStyle });
      if (p === "moveTo") return (x, y) => { at = [x, y]; };
      if (p === "lineTo") return (x, y) => { lines.push([at, [x, y], t.lineDashSet]); };
      if (p === "setLineDash") return (d) => { t.lineDashSet = d.length > 0; };
      if (String(p).startsWith("create")) return () => gradient;
      return () => {};
    },
    set: (t, p, v) => { t[p] = v; return true; }
  });
  const handlers = {};
  const canvas = {
    width: 1, height: 1, hidden: false, style: {}, clientWidth: width,
    get clientHeight() { return height; },
    getContext: () => (graphics ? ctx : null),
    getBoundingClientRect() { return { left: 0, top: 0, width, height }; },
    addEventListener(type, fn) { handlers[type] = fn; }
  };
  const detailsEl = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
  const fallbackEl = { hidden: true, innerHTML: "" };
  const map = createStarmapController({ canvas, fallbackEl, detailsEl, researchCatalog: RESEARCH, getCorpLevel: () => 1, getSystemsCatalog: () => SYSTEMS });
  map.mount(SYSTEMS);
  map.setUnlockedTech(new Set(unlockedTech));
  return { map, writes, lines, handlers, fallbackEl, canvas, detailsEl };
}

describe("the cluster view on its canvas (ISP-116)", () => {
  // Bug AB#2318 (fixed as #2328): the lanes were every pair closer than 42% of the canvas width, so a phone's tall canvas
  // and a desktop's wide one drew different maps. They are the jump graph now, the same at every aspect ratio.
  it("draws a lane for each pair of adjacent systems and no other, on a wide canvas and a phone's tall one", () => {
    for (const [w, h] of [[1050, 558], [358, 520]]) {
      const { lines } = mapAt(w, h);
      const pos = new Map(SYSTEMS.map((s) => [`${Math.round(s.mapPosition.x * w)},${Math.round(s.mapPosition.y * h)}`, s.id]));
      const key = ([a, b]) => [pos.get(`${Math.round(a[0])},${Math.round(a[1])}`), pos.get(`${Math.round(b[0])},${Math.round(b[1])}`)].sort().join("|");
      const drawn = new Set(lines.filter(([a, b]) => pos.has(`${Math.round(a[0])},${Math.round(a[1])}`) && pos.has(`${Math.round(b[0])},${Math.round(b[1])}`)).map(key));
      expect([...drawn].sort(), `${w}x${h}`).toEqual(lanePairs(SYSTEMS).map((p) => [...p].sort().join("|")).sort());
    }
  });

  it("names a locked system's gate when it is selected: in its panel, and under its name back on the cluster", () => {
    const { writes, handlers, detailsEl } = mapAt(1050, 558);
    const locked = SYSTEMS.find((s) => s.accessResearch === "tt-deep-star-navigation");
    writes.length = 0;
    handlers.click({ clientX: locked.mapPosition.x * 1050, clientY: locked.mapPosition.y * 558 }); // opens the system
    expect(detailsEl.innerHTML).toContain(`Requires ${DEEP_STAR}`);
    const back = writes.find((w) => w.text.endsWith("Back To Cluster"));
    expect(back, "the system view's way back").toBeTruthy();
    writes.length = 0;
    handlers.click({ clientX: back.x + 20, clientY: back.y - 4 });
    const texts = writes.map((w) => w.text);
    expect(texts).toContain(`Requires ${DEEP_STAR}`);
    expect(texts.indexOf(`Requires ${DEEP_STAR}`)).toBe(texts.indexOf(locked.name) + 1); // the line under its name
  });

  it("says nothing of a gate under a reachable system's name", () => {
    const { writes } = mapAt(1050, 558);
    expect(writes.some((w) => w.text.startsWith("Requires "))).toBe(false); // Sol, selected at mount, needs none
  });

  it("lists every system in the fallback, each with whether it can be reached or the research it needs", () => {
    const { fallbackEl } = mapAt(1050, 558, { graphics: false });
    const html = fallbackEl.innerHTML;
    for (const s of SYSTEMS) expect(html, s.name).toContain(`data-system-id="${s.id}"`);
    expect(html).toContain(`Requires ${DEEP_STAR}.`);
    expect(html).toContain("You are here.");
  });
});
