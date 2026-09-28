import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// starmap.js preloads planet images when it is imported; node has no Image.
globalThis.Image ??= class { set src(_v) {} };
const { STARMAP_OVERLAYS, overlayColor, clusterStarColor, fieldOverlayLegendHtml } = await import("../../public/scripts/starmap.js");
const { DOMINANCE_OVERLAYS } = await import("../../public/scripts/dominanceOverlay.js"); // ISP-218 (AB#913)

// AB#1459: the Starmap offered "Resource Concentration", which coloured each system by (100 - pirateDensity +
// gdpIndex) / 150. No system carries resource data, so a player comparing systems for mining was shown GDP and
// pirates under a resource label. Every overlay the picker offers now colours by one field data/systems.json holds.
// The real resource overlay is ISP-143 (AB#837): a picker of its own (#map-resource, public/scripts/resourceOverlay.js)
// that colours by the concentration the catalog and the player's scouted belts give, tested in resourceOverlay.test.js.
const HTML = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SYSTEMS = JSON.parse(readFileSync(new URL("../../data/systems.json", import.meta.url), "utf8"));
const SYSTEM_LIST = Array.isArray(SYSTEMS) ? SYSTEMS : SYSTEMS.systems || Object.values(SYSTEMS);
const SELECT = HTML.match(/<select id="map-overlay"[^>]*>([\s\S]*?)<\/select>/)?.[1] || "";
const OPTIONS = [...SELECT.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(([, value, label]) => ({ value, label: label.trim() }));
const NONE_COLOR = overlayColor({ gdpIndex: 50, activityLevel: 50, pirateDensity: 20 }, "none");

describe("Starmap overlays show only what systems hold (AB#1459)", () => {
  it("reads the picker: None first, then one option per overlay", () => {
    expect(OPTIONS[0]).toEqual({ value: "none", label: "None" });
    // ISP-218 (AB#913): the system-field overlays, then the two dominance overlays; ISP-229 (AB#924): then concessions.
    expect(OPTIONS.slice(1).map((o) => o.value)).toEqual([...Object.keys(STARMAP_OVERLAYS), ...Object.keys(DOMINANCE_OVERLAYS), "concessions"]);
    expect(OPTIONS.slice(1).map((o) => o.label)).toEqual([...[...Object.values(STARMAP_OVERLAYS), ...Object.values(DOMINANCE_OVERLAYS)].map((o) => o.label), "ISA concessions"]);
  });

  it("offers no resource overlay under a system field, and the page promises only the real one (AB#837)", () => {
    expect(OPTIONS.map((o) => o.label).join(" ")).not.toMatch(/resource/i);
    const intro = HTML.match(/<h2 class="ui-screen__title">(?:<span class="ui-code"[^>]*><\/span>)?Interstellar Starmap<\/h2>\s*<p class="ui-screen__lede">([\s\S]*?)<\/p>/)?.[1] || ""; // AB#944: after its code slot
    expect(intro).not.toBe("");
    expect(intro).not.toMatch(/dominance/i);
    // The resource overlay is its own picker, which the page fills from what the player can see.
    expect(HTML).toMatch(/<select id="map-resource" class="ui-select">\s*<option value="none">None<\/option>\s*<\/select>/);
  });

  it("colours each overlay by a number every system in data/systems.json carries", () => {
    expect(SYSTEM_LIST.length).toBeGreaterThan(0);
    for (const { field } of Object.values(STARMAP_OVERLAYS)) {
      for (const system of SYSTEM_LIST) expect(typeof system[field], `${system.id}.${field}`).toBe("number");
    }
  });

  it("each overlay follows its own field and no other, across a sweep", () => {
    const base = { gdpIndex: 50, activityLevel: 50, pirateDensity: 20 };
    for (const { field, scale } of Object.values(STARMAP_OVERLAYS)) {
      const key = Object.keys(STARMAP_OVERLAYS).find((k) => STARMAP_OVERLAYS[k].field === field);
      const colours = [0.15, 0.5, 0.95].map((f) => overlayColor({ ...base, [field]: f * scale }, key));
      expect(new Set(colours).size, `${key} follows ${field}`).toBe(3);
      for (const other of Object.keys(base).filter((f) => f !== field)) {
        const moved = [0, 50, 100].map((v) => overlayColor({ ...base, [other]: v }, key));
        expect(new Set(moved).size, `${key} ignores ${other}`).toBe(1);
      }
    }
  });

  it("an overlay the picker no longer offers draws the plain map, not a blend", () => {
    expect(overlayColor({ gdpIndex: 90, activityLevel: 10, pirateDensity: 5 }, "resource")).toBe(NONE_COLOR);
  });
});

// Bug AB#4745: GDP, Activity and Pirates coloured only the systems a corporation could travel to (for a new one, Sol
// alone), because a locked system took the locked grey first. The overlay now colours every system; the lock keeps
// its ring. They had no legend either.
describe("the field overlays on a locked system (Bug AB#4745)", () => {
  it("colour every system by its field, locked or not; with no overlay a locked star is still grey", () => {
    for (const overlay of Object.keys(STARMAP_OVERLAYS)) {
      for (const system of SYSTEM_LIST) {
        expect(clusterStarColor(system, { overlay, locked: true }), `${overlay} ${system.id}`).toBe(overlayColor(system, overlay));
      }
    }
    const grey = clusterStarColor(SYSTEM_LIST[1], { overlay: "none", locked: true });
    expect(grey).not.toBe(overlayColor(SYSTEM_LIST[1], "none"));
    expect(clusterStarColor(SYSTEM_LIST[1], { overlay: "none", locked: false })).toBe(overlayColor(SYSTEM_LIST[1], "none"));
  });

  it("makes most systems differ in colour under each overlay, so a new corporation sees the map change", () => {
    for (const overlay of Object.keys(STARMAP_OVERLAYS)) {
      const colours = new Set(SYSTEM_LIST.map((s) => clusterStarColor(s, { overlay, locked: true })));
      expect(colours.size, overlay).toBeGreaterThan(SYSTEM_LIST.length / 2);
    }
  });

  it("gives each field overlay a legend of its scale, low to high, in the stars' colours, and none otherwise", () => {
    for (const [overlay, spec] of Object.entries(STARMAP_OVERLAYS)) {
      const html = fieldOverlayLegendHtml(overlay);
      expect(html).toContain(`${spec.label}: each system coloured by its ${spec.label}, 0 to ${spec.scale}`);
      expect(html).toContain(`style="background:${overlayColor({ [spec.field]: 0 }, overlay)}"`);
      expect(html).toContain(`style="background:${overlayColor({ [spec.field]: spec.scale }, overlay)}"`);
      expect(html).toMatch(/low, 0<\/li>/);
      expect(html).toContain(`high, ${spec.scale}</li>`);
    }
    expect(fieldOverlayLegendHtml("none")).toBe("");
    expect(fieldOverlayLegendHtml("dominance-corporation")).toBe("");
  });
});
