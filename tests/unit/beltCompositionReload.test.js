import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { starmapMiningState } from "../../public/scripts/beltCompositions.js";
import { clientCode } from "../helpers/clientSource.js";

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
    expect(detailsEl.innerHTML).toContain("Silicates <strong>35%</strong>"); // AB#2331: a labelled bar's legend
    expect(detailsEl.innerHTML).not.toContain("Loading composition");
  });

  it("the Starmap's mining state carries the fetched compositions and the corporation's belts", () => {
    const state = starmapMiningState(
      { corp: { fleet: { cap: 3 }, asteroidMining: { probeCount: 2, scoutedBelts: ["sol:belt"], maxDeployments: 2 } } },
      { "sol:belt": { Silicates: 35 } }
    );
    expect(state).toEqual({
      probeCount: 2, maxProbes: 3, maxDeployments: 2, activeExpeditions: [],
      scoutedBelts: ["sol:belt"], beltCompositions: { "sol:belt": { Silicates: 35 } },
      belts: {}, respawnChancePerHour: null, // AB#2331: until the slots have been fetched
      remoteDispatchYieldPct: null // AB#4656, Bug #4662: the shared-intel yield, fetched with them
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
  // AB#739: the Starmap's loader lives in views/starmap.js now; this reads app.js and every module it loads.
  const app = clientCode();
  const body = (signature) => {
    const at = app.indexOf(signature);
    const end = app.indexOf("\n}\n", at);
    if (at < 0 || end < 0) throw new Error(`the client code has no complete ${signature}...}`);
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
    // AB#2331: with the slots (appState.belts) and the respawn chance, fetched with them.
    // AB#4656, Bug #4662: and the shared-intel yield.
    const slots = String.raw`\{ belts: appState\.belts, respawnChancePerHour: appState\.beltRespawnChance, remoteDispatchYieldPct: appState\.remoteDispatchYieldPct \}`;
    expect(body("function loadBeltCompositionsIntoStarmap(")).toMatch(new RegExp(
      String.raw`refreshBeltCompositions\(\)\.then\(\(\) => starmap\.setAsteroidMining\(starmapMiningState\(appState\.data, appState\.beltCompositions,\s*` + slots + String.raw`\)\)\)`
    ));
    // AB#1826: renderAllViews, not updateAllViews — updateAllViews only times renderAllViews (Bug #729's bench).
    expect(body("function renderAllViews(")).toMatch(new RegExp(
      String.raw`starmap\.setAsteroidMining\(starmapMiningState\(data, appState\.beltCompositions, ` + slots + String.raw`\)\)`
    ));
  });
});

// AB#2331: the belt panel's three states, from the slot the server sends (GET .../belt-compositions): scouted, with its
// rarity, composition bar and reserve; unscouted, whatever the key list says; and empty, with the next hourly chance.
describe("the belt panel shows the belt there now (AB#2331)", () => {
  const slot = (over) => ({ key: "sol:belt", generation: 1, present: true, scouted: false, nextDrawAt: null, ...over });
  const scoutedSlot = slot({ scouted: true, rarity: "uncommon", composition: { Nickel: 30, Silicates: 50, Carbon: 20 }, reserve: 2898, remaining: 1449 });
  const withSlots = (belts, compositions = {}) => starmapMiningState(scouted, compositions, { belts, respawnChancePerHour: 0.2 });

  it("a scouted belt: its rarity, a labelled bar largest part first, and the reserve left", () => {
    const { controller, detailsEl } = openSolBelt();
    controller.setAsteroidMining(withSlots({ "sol:belt": scoutedSlot }));
    const html = detailsEl.innerHTML;
    expect(html).toContain("Generation 1");
    expect(html).toContain('<span class="ui-badge ui-badge--accent">Uncommon</span>');
    expect(html).toContain('role="img" aria-label="Silicates 50%, Nickel 30%, Carbon 20%"');
    expect(html.indexOf("Silicates <strong>50%</strong>")).toBeLessThan(html.indexOf("Nickel <strong>30%</strong>"));
    expect(html).toContain("1,449 of 2,898 units left (50%)");
    expect(html).toContain('aria-valuenow="1449"');
  });

  it("a belt of more than five resources shows its four largest and the rest as Other, each named", () => {
    const { controller, detailsEl } = openSolBelt();
    const composition = { Nickel: 25, Titanium: 22, Carbon: 18, Silicates: 15, Hydrogen: 12, Cobalt: 8 };
    controller.setAsteroidMining(withSlots({ "sol:belt": { ...scoutedSlot, composition } }));
    const html = detailsEl.innerHTML;
    expect(html.match(/class="belt-bar__part /g)).toHaveLength(5);
    expect(html).toContain("Other <strong>20%</strong>");
    expect(html).toContain("Other: Hydrogen 12%, Cobalt 8%");
    expect(html).toContain('aria-label="Nickel 25%, Titanium 22%, Carbon 18%, Silicates 15%, Hydrogen 12%, Cobalt 8%"');
  });

  it("a belt respawned while the panel is open reads as unscouted when the slots arrive, though the key list names it", () => {
    const { controller, detailsEl } = openSolBelt();
    controller.setAsteroidMining(withSlots({ "sol:belt": scoutedSlot }));
    controller.setAsteroidMining(withSlots({ "sol:belt": slot({ generation: 2 }) }, { "sol:belt": { Silicates: 50 } }));
    expect(detailsEl.innerHTML).toContain("Material composition unknown");
    expect(detailsEl.innerHTML).toContain("Scout Asteroid Belt");
    expect(detailsEl.innerHTML).toContain("Generation 2");
    expect(detailsEl.innerHTML).not.toContain("belt-bar");
    expect(detailsEl.innerHTML).not.toContain("units left");
  });

  it("an empty slot: no belt, the chance and the next hour, and neither Scout nor Launch", () => {
    const { controller, detailsEl } = openSolBelt();
    const nextDrawAt = Date.UTC(2026, 8, 26, 14, 0);
    controller.setAsteroidMining(withSlots({ "sol:belt": slot({ present: false, nextDrawAt }) }));
    const html = detailsEl.innerHTML;
    expect(html).toContain("No belt here");
    expect(html).toContain("Each hour on the hour there is a 20% chance a new one forms here, unscouted by anyone; the next chance is at 14:00 UTC.");
    expect(html).not.toContain("Scout Asteroid Belt");
    expect(html).not.toContain("launch-expedition-btn");
    expect(html).not.toContain("Scout this asteroid belt before launching");
    expect(html).not.toContain("Generation");
  });

  it("a refused scout or launch is said in that belt's panel, and only there (Bug #2339)", () => {
    const { controller, detailsEl } = openSolBelt();
    controller.setAsteroidMining(withSlots({ "sol:belt": slot() }));
    controller.setBeltNotice({ beltKey: "sol:belt", message: "No probes <now>." });
    expect(detailsEl.innerHTML).toContain('<div class="ui-state ui-state--error starmap__notice" role="alert"><p class="ui-state__why">No probes &lt;now&gt;.</p></div>');
    controller.setBeltNotice({ beltKey: "tau-ceti:tc-cloud", message: "Elsewhere." });
    expect(detailsEl.innerHTML).not.toContain("starmap__notice");
    controller.setBeltNotice(null);
    expect(detailsEl.innerHTML).not.toContain("starmap__notice");
  });

  it("the page refetches the slots when a belt empties or forms anew, and after a refusal", () => {
    const code = clientCode();
    expect(code).toMatch(/socket\.on\("belts:changed", \(\) => \{\s*if \(!appState\.accountId\) return;\s*loadBeltCompositionsIntoStarmap\(\);/);
    expect(code).toMatch(/starmap\.setBeltNotice\(\{ beltKey, message: err\.message \|\| "Belt scouting failed\.", protocol: denied \}\);/); // AB#4819: with its protocol line
    expect(code).toMatch(/appState\.belts = data\.belts \|\| \{\};/);
  });
});
