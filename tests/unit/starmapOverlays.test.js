import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// starmap.js preloads planet images when it is imported; node has no Image.
globalThis.Image ??= class { set src(_v) {} };
const { STARMAP_OVERLAYS, overlayColor } = await import("../../public/scripts/starmap.js");
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
    const intro = HTML.match(/<h2 class="ui-screen__title">Interstellar Starmap<\/h2>\s*<p class="ui-screen__lede">([\s\S]*?)<\/p>/)?.[1] || "";
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
