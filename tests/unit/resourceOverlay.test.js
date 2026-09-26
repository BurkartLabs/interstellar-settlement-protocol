import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import {
  CONCENTRATION_BANDS, bodyConcentration, concentrationBand, concentrationLegendHtml, concentrationRows, concentrationText, overlayItems, systemConcentration
} from "../../public/scripts/resourceOverlay.js";
import { publicSystems } from "../../server/catalogView.js";

// ISP-143 (AB#837): the Starmap's resource concentration overlay. What it may read: the public catalog (planets' and
// moons' profiles; a belt without its contents, Bug #2355) and this player's belt slots (GET .../belt-compositions).
const CATALOG = JSON.parse(readFileSync(new URL("../../data/systems.json", import.meta.url), "utf8"));
const SYSTEMS = publicSystems(CATALOG);
const sol = SYSTEMS.find((s) => s.id === "sol");
const scoutedSol = { "sol:belt": { key: "sol:belt", generation: 1, present: true, scouted: true, composition: { Silicates: 35, Carbon: 25, Nickel: 20, "Water Ice": 15, Titanium: 5 } } };
const unscoutedSol = { "sol:belt": { key: "sol:belt", generation: 1, present: true, scouted: false } };

describe("the concentration overlay's values (AB#837)", () => {
  it("bands a share from none to 50% and over, and a value it cannot see not at all", () => {
    expect(CONCENTRATION_BANDS.map((b) => b.label)).toEqual(["None", "Under 10%", "10% to 24%", "25% to 49%", "50% and over"]);
    expect([0, 0.05, 0.1, 0.249, 0.25, 0.5, 1].map((v) => concentrationBand(v).key)).toEqual(["none", "trace", "low", "low", "mid", "high", "high"]);
    expect(concentrationBand(null)).toBeNull();
    for (const band of CONCENTRATION_BANDS) expect(band.color).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/); // the map fades them by replacing the alpha
  });

  it("writes it in words, so colour is never the only cue", () => {
    expect([0.3, 0.25, 0.005, 0, null].map(concentrationText)).toEqual(["30%", "25%", "0.5%", "none", "not scouted"]);
  });

  it("reads a planet's or moon's share from the catalog, and a belt's only from the player's scouted slot", () => {
    const luna = sol.bodies.find((b) => b.id === "luna");
    const jupiter = sol.bodies.find((b) => b.id === "jupiter");
    const belt = sol.bodies.find((b) => b.type === "Field");
    expect(bodyConcentration(sol, luna, "Helium-3")).toBe(0.25); // AB#830
    expect(bodyConcentration(sol, jupiter, "Helium-3")).toBe(0.3); // a gas giant (AB#826)
    expect(bodyConcentration(sol, luna, "Uranium")).toBe(0);
    expect(belt.composition).toBeUndefined(); // the public catalog has no belt contents (Bug #2355)
    expect(bodyConcentration(sol, belt, "Water Ice", {})).toBeNull();
    expect(bodyConcentration(sol, belt, "Water Ice", unscoutedSol)).toBeNull();
    expect(bodyConcentration(sol, belt, "Water Ice", scoutedSol)).toBe(0.15);
    expect(bodyConcentration(sol, belt, "Water Ice", { "sol:belt": { ...scoutedSol["sol:belt"], present: false } })).toBeNull();
  });

  it("gives a system its best body, and counts the belts left out because they are not scouted", () => {
    expect(systemConcentration(sol, "Helium-3", unscoutedSol)).toMatchObject({ best: 0.3, unscoutedBelts: 1 });
    expect(systemConcentration(sol, "Helium-3", unscoutedSol).body.name).toMatch(/Jupiter|Saturn/);
    // Water Ice: Sol's ice moons yield 55%; the belt's 15% does not beat them, but it counts once scouted.
    expect(systemConcentration(sol, "Water Ice", scoutedSol)).toMatchObject({ best: 0.55, unscoutedBelts: 0 });
    const barnards = SYSTEMS.find((s) => s.id === "barnards-star");
    expect(systemConcentration(barnards, "Helium-3", {})).toMatchObject({ best: 0, body: null, unscoutedBelts: 1 });
  });

  it("offers the items a visible body yields, and a belt's only once scouted", () => {
    const items = overlayItems(SYSTEMS, {});
    expect(items).toContain("Helium-3");
    expect(items).toContain("Deuterium");
    expect(items).toEqual([...items].sort((a, b) => a.localeCompare(b)));
    // Rare Earths and Exotic Matter come only from belts, so they are not offered until a belt with them is scouted.
    expect(items).not.toContain("Exotic Matter");
    expect(overlayItems(SYSTEMS, { "ee:crown": { scouted: true, composition: { "Exotic Matter": 8 } } })).toContain("Exotic Matter");
  });

  it("lists a system's bodies best first, moons included, a belt it cannot see last and named as such", () => {
    const rows = concentrationRows(sol, "Helium-3", unscoutedSol);
    expect(rows[0].text).toBe("30%");
    expect(rows.find((r) => r.name === "Luna")).toMatchObject({ type: "Moon", text: "25%" });
    expect(rows.at(-1)).toMatchObject({ type: "Field", text: "not scouted" });
  });

  it("has a legend with every band's colour and range, and says what it leaves out", () => {
    const html = concentrationLegendHtml("Helium-3");
    for (const band of CONCENTRATION_BANDS) expect(html).toContain(`style="background:${band.color}" aria-hidden="true"></span>${band.label}`);
    expect(html).toContain("A belt counts once you have scouted it.");
    expect(html).toContain('aria-label="Helium-3 concentration bands"');
    expect(concentrationLegendHtml("")).toBe("");
  });
});

// The controller, drawn to a recording canvas: choosing an item colours and labels the map; choosing none removes it.
globalThis.Image ??= class { set src(_v) {} };
const { createStarmapController } = await import("../../public/scripts/starmap.js");
function recordingCanvas() {
  const labels = [];
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "fillText") return (text) => { labels.push(String(text)); };
      if (prop === "measureText") return (t) => ({ width: String(t).length * 6 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
      return () => {};
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
  const canvas = { width: 300, height: 150, hidden: false, style: {}, clientWidth: 1100, get clientHeight() { return 560; },
    getContext: () => ctx, getBoundingClientRect() { return { left: 0, top: 0, width: 1100, height: 560 }; }, addEventListener() {} };
  return { canvas, labels };
}
const fakeSelect = () => {
  const el = { value: "none", innerHTML: "", listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; } };
  Object.defineProperty(el, "options", { get() { return [...el.innerHTML.matchAll(/value="([^"]+)"/g)].map((m) => ({ value: m[1] })); } });
  return el;
};

describe("the overlay on the Starmap (AB#837)", () => {
  let saved;
  beforeAll(() => { saved = globalThis.window; globalThis.window = { devicePixelRatio: 1, innerHeight: 900, addEventListener() {} }; });
  afterAll(() => { globalThis.window = saved; });

  it("choosing Helium-3 names each star's best share and lists the richest; None takes it all away", () => {
    const { canvas, labels } = recordingCanvas();
    const detailsEl = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
    const overlaySelect = fakeSelect();
    const resourceSelect = fakeSelect();
    const resourceLegend = { hidden: true, innerHTML: "" };
    const map = createStarmapController({ canvas, fallbackEl: { hidden: true }, detailsEl, overlaySelect, resourceSelect, resourceLegend });
    map.mount(SYSTEMS);
    map.setAsteroidMining({ belts: unscoutedSol });
    expect(resourceSelect.options.map((o) => o.value)).toContain("Helium-3");

    labels.length = 0;
    overlaySelect.value = "gdp";
    map.setResourceOverlay("Helium-3");
    expect(overlaySelect.value).toBe("none"); // the two overlays colour the same stars: one at a time
    expect(labels).toContain("Helium-3 30%"); // Sol: Jupiter and Saturn (a desktop canvas; a phone's panel lists them)
    expect(labels).toContain("Helium-3 none"); // a system whose visible bodies yield none
    expect(resourceLegend.hidden).toBe(false);
    expect(resourceLegend.innerHTML).toContain("<strong>Helium-3</strong>");
    expect(detailsEl.innerHTML).toContain("Richest in Helium-3");
    // Every gas giant yields Helium-3 30% (AB#826's class rule), so the top six tie and are named alphabetically.
    expect(detailsEl.innerHTML.match(/<li>[^<]+: 30% \([^)]+\)<\/li>/g)).toHaveLength(6);

    labels.length = 0;
    map.setResourceOverlay("none");
    expect(labels.some((l) => l.startsWith("Helium-3"))).toBe(false);
    expect(resourceLegend.hidden).toBe(true);
    expect(detailsEl.innerHTML).not.toContain("Richest in");
  });
});
