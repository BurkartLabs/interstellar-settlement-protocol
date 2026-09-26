// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isNeutralStation, neutralStationCounts, stationBadgeBox, systemStationMarkers } from "../../public/scripts/stationMarkers.js";

// ISP-119 (AB#811): neutral stations on the starmap. A count per system on the cluster view and a marker per neutral
// station on the system view, both read from the catalog's `jurisdiction` field (AB#810), and a marker opens the
// station's modal. The controller tests use a fixture station list, so a marker can only come from the field.
// Under jsdom, URL is jsdom's, which node's fs does not take: the path is built from this file's directory.
const read = (rel) => JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../..", rel), "utf8"));
const SYSTEMS = read("data/systems.json");
const STATIONS = read("data/stations.json").stations;
const SOL = SYSTEMS.find((s) => s.id === "sol");

globalThis.Image ??= class { set src(_v) {} };
const { planClusterLabels, createStarmapController } = await import("../../public/scripts/starmap.js");

const FIXTURE = [
  { id: "fixture-neutral", name: "Fixture Neutral Dock", designation: "FIX-001", systemId: "sol", body: "Mars", tier: 1, jurisdiction: "neutral", buildingIds: ["orbital-executive-suites"] },
  { id: "fixture-moon", name: "Fixture Moon Dock", designation: "FIX-002", systemId: "sol", body: "Luna", tier: 1, jurisdiction: "neutral", buildingIds: [] },
  { id: "fixture-owned", name: "Fixture Owned Dock", designation: "FIX-003", systemId: "sol", body: "Venus", tier: 1, jurisdiction: "conglomerate", buildingIds: [] },
  { id: "fixture-unset", name: "Fixture Unset Dock", designation: "FIX-004", systemId: "sol", body: "Jupiter", tier: 1, buildingIds: [] }
];

describe("which stations are marked (AB#811)", () => {
  it("only those the catalog marks neutral, counted per system", () => {
    expect(FIXTURE.map(isNeutralStation)).toEqual([true, true, false, false]);
    expect([...neutralStationCounts(FIXTURE)]).toEqual([["sol", 2]]);
    // The real catalog: every station is neutral (AB#810), so every system counts its own.
    const counts = neutralStationCounts(STATIONS);
    expect(counts.get("sol")).toBe(3);
    for (const system of SYSTEMS) expect(counts.get(system.id), system.id).toBe(STATIONS.filter((s) => s.systemId === system.id).length);
  });

  it("each on the body it orbits, a moon's on its planet, and none for a body the system lacks", () => {
    const withGhost = [...FIXTURE, { id: "ghost", systemId: "sol", body: "Vulcan", jurisdiction: "neutral" }];
    expect(systemStationMarkers(SOL, withGhost).map((m) => [m.station.id, m.bodyId])).toEqual([["fixture-neutral", "mars"], ["fixture-moon", "earth"]]);
  });
});

describe("the cluster view's count badges (AB#811)", () => {
  /** The desktop cluster at 1058x560 with every name planned around the real badges, as drawClusterView does. */
  function planned(width, height) {
    const counts = neutralStationCounts(STATIONS);
    const entries = SYSTEMS.map((s) => ({
      id: s.id, x: s.mapPosition.x * width, y: s.mapPosition.y * height, r: 11,
      widths: [s.name.length * 6.2, ...(s.id === "sol" ? ["YOU ARE HERE".length * 5.2] : [])], size: 11, gap: 17,
      current: s.id === "sol", selected: false, neighbour: SOL.adjacent.includes(s.id)
    }));
    const badges = SYSTEMS.filter((s) => counts.has(s.id)).map((s) => stationBadgeBox({ x: s.mapPosition.x * width, y: s.mapPosition.y * height, starRadius: 7, textWidth: 6 }));
    return { plan: planClusterLabels({ entries, compact: false, canvasWidth: width, canvasHeight: height, reserved: badges }), badges };
  }
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  it("every system is still named on a desktop canvas, and no name crosses a badge", () => {
    const { plan, badges } = planned(1058, 560);
    expect([...plan.keys()].sort()).toEqual(SYSTEMS.map((s) => s.id).sort());
    for (const [id, label] of plan) for (const badge of badges) expect(overlaps(label.box, badge), id).toBe(false);
  });

  it("a badge stays on the canvas: to the right of a star too near the left edge", () => {
    const box = stationBadgeBox({ x: 20, y: 160, starRadius: 7, textWidth: 8 });
    expect(box.left).toBeGreaterThanOrEqual(2);
    expect(stationBadgeBox({ x: 400, y: 160, starRadius: 7, textWidth: 8 }).right).toBeLessThanOrEqual(400);
  });
});

// A canvas that records names (fillText) and each diamond (a translate followed by a quarter-turn rotate).
function recordingCanvas(width, height) {
  const labels = [];
  const diamonds = [];
  let lastTranslate = null;
  let font = '11px "Inter", sans-serif';
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop === "font") return font;
      if (prop in target) return target[prop];
      if (prop === "fillText") return (text, x, y) => labels.push({ text, x, y });
      if (prop === "measureText") return (text) => ({ width: String(text).length * 6 });
      if (prop === "translate") return (x, y) => { lastTranslate = { x, y }; };
      if (prop === "rotate") return (angle) => { if (lastTranslate && Math.abs(angle - Math.PI / 4) < 1e-9) diamonds.push(lastTranslate); lastTranslate = null; };
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
      return () => {};
    },
    set(target, prop, value) { if (prop === "font") font = value; else target[prop] = value; return true; }
  });
  const handlers = {};
  const canvas = {
    width: 1, height: 1, hidden: false, style: {}, clientWidth: width,
    get clientHeight() { return height; },
    getContext: () => ctx,
    getBoundingClientRect() { return { left: 0, top: 0, width, height }; },
    addEventListener(type, fn) { handlers[type] = fn; },
    handlers
  };
  return { canvas, labels, diamonds, reset() { labels.length = 0; diamonds.length = 0; } };
}

function mapWith(stations, width = 1058, height = 560) {
  globalThis.window.devicePixelRatio = 1;
  const rec = recordingCanvas(width, height);
  const detailsEl = document.createElement("section");
  const map = createStarmapController({ canvas: rec.canvas, fallbackEl: { hidden: true }, detailsEl, getSystemsCatalog: () => SYSTEMS });
  map.mount(SYSTEMS);
  map.setStations(stations, "earth-station-prime", "sol");
  return { map, rec, detailsEl };
}
const openSystem = (rec, system) => {
  const { x, y } = system.mapPosition;
  rec.reset();
  rec.canvas.handlers.click({ clientX: x * rec.canvas.clientWidth, clientY: y * rec.canvas.clientHeight });
};

afterEach(() => document.getElementById("starmap-station-modal")?.remove());

describe("the starmap draws what the fixture's field says (AB#811)", () => {
  it("the cluster view draws a count beside Sol from the fixture: its two neutral stations, not the four it lists", () => {
    const { rec } = mapWith(FIXTURE);
    const texts = rec.labels.map((l) => l.text);
    expect(texts).toContain("2");
    expect(texts).not.toContain("4");
    expect(rec.diamonds.length).toBe(1); // one badge: only Sol has stations in the fixture
  });

  it("Sol's system view marks the two neutral ones, on Mars and on Earth for Luna's, and a marker opens that station's modal", () => {
    const { rec } = mapWith(FIXTURE);
    openSystem(rec, SOL);
    expect(rec.diamonds.length).toBe(2);
    for (const [i, name] of [[0, "Fixture Neutral Dock"], [1, "Fixture Moon Dock"]]) {
      document.getElementById("starmap-station-modal")?.remove();
      const { rec: again } = mapWith(FIXTURE);
      openSystem(again, SOL);
      const marker = again.diamonds[i];
      again.canvas.handlers.click({ clientX: marker.x, clientY: marker.y });
      const modal = document.getElementById("starmap-station-modal");
      expect(modal, name).not.toBeNull();
      expect(modal.textContent).toContain(name);
    }
  });

  it("with the real catalog, every station of Sol has a marker in its system view", () => {
    const { rec } = mapWith(STATIONS);
    openSystem(rec, SOL);
    expect(rec.diamonds.length).toBe(STATIONS.filter((s) => s.systemId === "sol").length);
  });
});
