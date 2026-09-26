import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { navigationFor } from "../../public/scripts/navigation.js";

// ISP-112 (AB#804): over data/systems.json's catalog.
const { travelResearchLock, travelResearchName } = navigationFor(JSON.parse(readFileSync(new URL("../../data/systems.json", import.meta.url), "utf8")));

// Bug #1270: the Starmap's lock said 'Navigation research required' without saying which research (it differs by
// system) or how far away it is. The text now comes from the research catalog: the research, its tier and level, and
// what still stands before it, in queue-rnd's order (prerequisites, corporation level, Tier 1 research).
const CATALOG = JSON.parse(readFileSync(new URL("../../data/research.json", import.meta.url), "utf8")).nodes;
const TIER_1 = CATALOG.filter((t) => t.tier === 1).map((t) => t.id);
const lock = (tech, level, target, from = "sol") => travelResearchLock(CATALOG, tech, level, from, target);

describe("the lock names the research a jump needs (Bug #1270)", () => {
  it("Alpha Centauri, new corporation: Near-Star Navigation Array, its tier and level, and everything before it", () => {
    expect(lock([], 1, "alpha-centauri")).toBe(
      "Requires Near-Star Navigation Array (Corporate R&D, Tier 2, corporation level 5). Before you can research it: " +
      `Fleet Coordination Matrix; corporation level 5 (you are level 1); all Tier 1 research (0 of ${TIER_1.length} done).`
    );
    expect(travelResearchName(CATALOG, "barnards-star")).toBe("Near-Star Navigation Array");
  });

  it("Wolf 359 and the other far systems: the Deep-Star research, which comes after Near-Star", () => {
    for (const target of ["wolf-359", "tau-ceti", "epsilon-eridani"]) {
      const text = lock([], 1, target);
      expect(text).toMatch(/^Requires Deep-Star Cartography Suite \(Corporate R&D, Tier 3, corporation level 10\)\./);
      expect(text).toMatch(/Before you can research it: Near-Star Navigation Array; corporation level 10 \(you are level 1\)/);
    }
  });

  it("a corporation with the research has no lock, and Sol never has one", () => {
    expect(lock(["tt-proxima-navigation"], 5, "alpha-centauri")).toBeNull();
    expect(lock(["tt-proxima-navigation", "tt-deep-star-navigation"], 10, "wolf-359")).toBeNull();
    expect(lock([], 1, "sol", "alpha-centauri")).toBeNull();
  });

  it("the tier and level met but the prerequisite missing: it names only the prerequisite", () => {
    expect(lock(TIER_1, 5, "alpha-centauri")).toBe(
      "Requires Near-Star Navigation Array (Corporate R&D, Tier 2, corporation level 5). Before you can research it: Fleet Coordination Matrix."
    );
  });

  it("the prerequisite held but the level too low: it names the level", () => {
    expect(lock([...TIER_1, "tt-fleet-coordination"], 3, "alpha-centauri")).toMatch(
      /Before you can research it: corporation level 5 \(you are level 3\)\.$/
    );
  });

  it("everything before it met: says to research it", () => {
    expect(lock([...TIER_1, "tt-fleet-coordination"], 5, "alpha-centauri")).toBe(
      "Requires Near-Star Navigation Array (Corporate R&D, Tier 2, corporation level 5). You meet its requirements: research it in Corporate R&D."
    );
  });

  // AB#1049: the page no longer carries its own copy of the tech tree to drift from research.json — it fetches
  // GET /api/research at boot and mutates the same techTree array navigation.js/starmap.js already read (see
  // the comment on `const techTree = []` in app.js). The drift this test used to guard against is now
  // structurally impossible: there is one file, server and client both read it. See
  // tests/integration/research-route.test.js for the route itself serving exactly what research.json defines.
});

describe("the Starmap's system panel shows it (Bug #1270)", () => {
  it("opening Alpha Centauri from Sol with no research shows the named lock, not 'Navigation research required'", async () => {
    globalThis.Image ??= class { set src(_v) {} };
    const saved = globalThis.window;
    globalThis.window = { devicePixelRatio: 1, innerHeight: 900, addEventListener() {} };
    try {
      const { createStarmapController } = await import("../../public/scripts/starmap.js");
      const gradient = { addColorStop() {} };
      const ctx = new Proxy({}, { get: (t, p) => (p in t ? t[p] : p === "measureText" ? () => ({ width: 40 }) : p.startsWith("create") ? () => gradient : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
      const handlers = {};
      const canvas = {
        width: 1, height: 1, hidden: false, style: {}, clientWidth: 719,
        get clientHeight() { return parseInt(this.style.height || "560", 10); },
        getContext: () => ctx,
        getBoundingClientRect() { return { left: 0, top: 0, width: 719, height: this.clientHeight }; },
        addEventListener(type, fn) { handlers[type] = fn; }
      };
      const detailsEl = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
      const map = createStarmapController({ canvas, fallbackEl: { hidden: true }, detailsEl, researchCatalog: CATALOG, getCorpLevel: () => 1,
        getSystemsCatalog: () => JSON.parse(readFileSync(new URL("../../data/systems.json", import.meta.url), "utf8")) });
      map.mount([{ id: "sol", name: "Sol", bodies: [] }, { id: "alpha-centauri", name: "Alpha Centauri", bodies: [] }]);
      map.setUnlockedTech(new Set());
      const { mapPosition } = JSON.parse(readFileSync(new URL("../../data/systems.json", import.meta.url), "utf8")).find((s) => s.id === "alpha-centauri");
      handlers.click({ clientX: mapPosition.x * 719, clientY: mapPosition.y * canvas.clientHeight }); // where the cluster view draws it
      expect(detailsEl.innerHTML).toContain("Alpha Centauri");
      expect(detailsEl.innerHTML).toContain("Requires Near-Star Navigation Array (Corporate R&amp;D, Tier 2, corporation level 5).");
      expect(detailsEl.innerHTML).not.toContain("Navigation research required");
    } finally {
      globalThis.window = saved;
    }
  });
});
