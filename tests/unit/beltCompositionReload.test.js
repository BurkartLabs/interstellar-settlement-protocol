import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { starmapMiningState } from "../../public/scripts/beltCompositions.js";

// starmap.js preloads planet images when it is imported; node has no Image.
globalThis.Image ??= class { set src(_v) {} };
const { createStarmapController, scoutedBeltLoadingHtml } = await import("../../public/scripts/starmap.js");

// Bug #1264: after a reload a scouted belt showed no composition and no Scout button. The page fetched the
// compositions without waiting, drew the Starmap with none, and nothing gave them to the Starmap when they arrived;
// the belt panel drew a composition only when it had one and the 'unknown' text only when unscouted, so this state
// drew neither.

/** A 2D context that draws nothing and records where each label is written. */
function recordingContext() {
  const labels = [];
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "fillText") return (text, x, y) => { labels.push({ text, x, y }); };
      if (prop === "measureText") return () => ({ width: 40 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
      return () => {};
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
  return { ctx, labels };
}

/** A desktop-width canvas (wider than the 500px floor, so drawing and clicks share units). */
function fakeCanvas(context) {
  const handlers = {};
  return {
    width: 300, height: 150, hidden: false, style: {}, clientWidth: 719,
    get clientHeight() { return parseInt(this.style.height || "400", 10); },
    getContext: () => context.ctx,
    getBoundingClientRect() { return { left: 0, top: 0, width: 719, height: this.clientHeight }; },
    addEventListener(type, fn) { handlers[type] = fn; },
    handlers
  };
}

let systems;
let savedWindow;
beforeAll(async () => {
  savedWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, innerHeight: 900, addEventListener() {} };
  const { app } = await getApp();
  const res = await request(app).get("/api/bootstrap");
  systems = res.body.world.systems;
});
afterAll(() => { globalThis.window = savedWindow; });

/** Mounts the Starmap, opens Sol and taps where its asteroid belt is drawn; returns the controller and the panel. */
function openSolBelt() {
  const context = recordingContext();
  const canvas = fakeCanvas(context);
  const detailsEl = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
  const controller = createStarmapController({ canvas, fallbackEl: { hidden: true }, detailsEl });
  controller.mount(systems);
  controller.setUnlockedTech(new Set(["tt-asteroid-prospecting"]));
  const sol = context.labels.find((l) => l.text === "Sol");
  canvas.handlers.click({ clientX: sol.x - 16, clientY: sol.y + 4 }); // the star sits left of its label
  const belt = [...context.labels].reverse().find((l) => l.text === "Asteroid Belt");
  canvas.handlers.click({ clientX: belt.x - 8, clientY: belt.y + 4 }); // the label is drawn at (x + 8, y - 4)
  return { controller, detailsEl };
}

const scouted = { corp: { asteroidMining: { scoutedBelts: ["sol:belt"] } } };

describe("a scouted belt after a reload (Bug #1264)", () => {
  it("before the compositions arrive, the panel says the belt is scouted and its composition is loading", () => {
    const { controller, detailsEl } = openSolBelt();
    controller.setAsteroidMining(starmapMiningState(scouted, {}));
    expect(detailsEl.innerHTML).toContain("Asteroid Belt");
    expect(detailsEl.innerHTML).toContain("Loading composition");
    expect(detailsEl.innerHTML).not.toContain("Material Composition");
  });

  it("when they arrive, the open panel shows the composition", () => {
    const { controller, detailsEl } = openSolBelt();
    controller.setAsteroidMining(starmapMiningState(scouted, {}));
    controller.setAsteroidMining(starmapMiningState(scouted, { "sol:belt": { Silicates: 35, Carbon: 25 } }));
    expect(detailsEl.innerHTML).toContain("Material Composition");
    expect(detailsEl.innerHTML).toContain("Silicates: 35%");
    expect(detailsEl.innerHTML).not.toContain("Loading composition");
  });

  it("the Starmap's mining state carries the fetched compositions and the corporation's belts", () => {
    const state = starmapMiningState(
      { corp: { fleet: { cap: 3 }, asteroidMining: { probeCount: 2, scoutedBelts: ["sol:belt"], maxDeployments: 2 } } },
      { "sol:belt": { Silicates: 35 } }
    );
    expect(state).toEqual({
      probeCount: 2, maxProbes: 3, maxDeployments: 2, activeExpeditions: [],
      scoutedBelts: ["sol:belt"], beltCompositions: { "sol:belt": { Silicates: 35 } }
    });
    expect(starmapMiningState({}, undefined).beltCompositions).toEqual({});
  });

  it("the loading line is a line, not nothing", () => {
    expect(scoutedBeltLoadingHtml()).toMatch(/Loading composition/);
  });

  // app.js cannot load in node (it binds the DOM on import), so these read its source; the reload itself is looked at
  // in the browser (the PR's screenshots). A reload runs boot -> restoreAuthenticatedSession -> enterGame, not
  // refreshFromServer, which is where the first version of this fix went and why it did not work.
  // AB#1826: normalised, so a slice means the same on a CRLF checkout as an LF one — on CRLF "\n}\n" never matched
  // and body() silently returned the rest of the file. It throws rather than ever slicing to -1 again.
  const app = readFileSync(new URL("../../public/scripts/app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const body = (signature) => {
    const at = app.indexOf(signature);
    const end = app.indexOf("\n}\n", at);
    if (at < 0 || end < 0) throw new Error(`app.js has no complete ${signature}...}`);
    return app.slice(at, end);
  };

  it("every entry into the game (log in, register, restore after a reload) fetches the compositions for the Starmap", () => {
    const enter = body("function enterGame(");
    expect(enter).toMatch(/appState\.beltCompositions = \{\};/);
    expect(enter).toMatch(/if \(appState\.accountId\) loadBeltCompositionsIntoStarmap\(\);/);
    expect(body("async function restoreAuthenticatedSession(")).toMatch(/enterGame\(/);
    expect(body("async function refreshFromServer(")).toMatch(/loadBeltCompositionsIntoStarmap\(\);/);
  });

  it("when the fetch resolves, the compositions go to the Starmap", () => {
    expect(body("function loadBeltCompositionsIntoStarmap(")).toMatch(
      /refreshBeltCompositions\(\)\.then\(\(\) => starmap\.setAsteroidMining\(starmapMiningState\(appState\.data, appState\.beltCompositions\)\)\)/
    );
    // AB#1826: renderAllViews, not updateAllViews — updateAllViews only times renderAllViews (Bug #729's bench).
    expect(body("function renderAllViews(")).toMatch(/starmap\.setAsteroidMining\(starmapMiningState\(data, appState\.beltCompositions\)\)/);
  });
});
