import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stationArtHtml, stationArtKind, stationBody } from "../../public/scripts/stationArt.js";

// ISP-78 (AB#767): the Station tab and the building views it opens (the Orbital Executive Suites, the ISA Claims and
// Leases Division with its lease view and extractor yards, the Assembly Facility) are built from the design system in
// the flat direction (Decision AB#1801). Their own old classes are gone from every page, script, stylesheet and spec;
// the shared legacy components are gone from them, though other screens still use them until their own rebuilds. The
// header shows the body each station orbits. At each width they are measured in e2e/station-screens.spec.js.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const HTML = read("public/index.html");

/** The classes only the Station used before ISP-78. None may appear as a class, selector or toggle anywhere. */
export const OLD_CLASSES = [
  "action-hint", "assembly-fab-progress", "assembly-probe-img", "assembly-probe-status", "building-detail-header",
  "building-detail-nav", "building-grid", "compact-action-form", "construction-lease", "construction-row",
  "construction-status", "corp-badge", "extractor-cycle-status", "extractor-list", "extractor-progress-fill",
  "extractor-progress-header", "extractor-progress-pct", "extractor-progress-time", "extractor-progress-track",
  "extractor-progress-wrap", "extractor-progress-bar", "extractor-row", "extractor-row-header", "extractor-stat",
  "extractor-stat-label", "extractor-stat-row", "extractor-stat-value", "facility-blocked", "facility-card",
  "facility-card-footer", "facility-card-header", "facility-desc", "facility-tier", "facility-tier-note", "ge-bg",
  "icl-bg", "oes-bg", "kv-list--compact", "lease-body-badge", "lease-card", "lease-card-grid", "lease-card-header",
  "lease-facility", "lease-manage-btn", "lease-management-card", "lease-mine-form", "lease-mine-projection",
  "lease-mine-status", "lease-purchase-block", "lease-stop-btn", "lease-stop-status", "lease-type-label",
  "purchase-lease-btn", "station-district", "travel-banner", "yard-upgrade", "yard-upgrade-btn", "yard-upgrade-change",
  "yard-upgrade-locked", "yard-upgrade-status", "yard-upgrade-tier", "building-card", "building-card-footer",
  "building-card-header", "building-flavor", "building-description", "faction-code-badge", "start-here",
  "expand-width", "lease-countdown", "lease-progress", "travel-banner-inner"
];
/** Shared legacy components: other screens keep them for now, the Station does not use them. */
const LEGACY = ["btn", "btn-accent", "btn-outline", "btn-sm", "form-card", "data-card", "kv-list", "lede", "muted", "overline", "inline-form", "action-surface", "building-status-badge"];

/** Every place a class name is used as one: class="...", className = "...", classList.*("..."), and selectors. */
function classUses(text, name) {
  // Bug AB#4641: every pattern below contains the name, so a text without it has no use of it. Skipping those makes
  // the repo-wide scan about 15 times faster (2.3 s to 0.15 s), which a full suite's load had pushed past 20 s.
  if (!text.includes(name)) return [];
  const n = name.replace(/-/g, "\\-");
  const edge = "(?![\\w-])";
  const patterns = [
    new RegExp(`class(Name)?\\s*=\\s*["'\`][^"'\`]*(?<![\\w-])${n}${edge}`),
    new RegExp(`classList\\.(add|remove|toggle|contains)\\([^)]*["'\`]${n}["'\`]`),
    new RegExp(`(?<![\\w.-])\\.${n}${edge}(?!\\s*\\()`)
  ];
  return text.split("\n").filter((line) => patterns.some((p) => p.test(line)));
}

const filesUnder = (dir, exts) =>
  readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && exts.some((x) => e.name.endsWith(x)))
    .map((e) => path.relative(ROOT, path.join(e.parentPath, e.name)).split(path.sep).join("/"));

const fnBody = (file, name) => {
  const text = read(file);
  const at = text.indexOf(`export function ${name}`);
  return text.slice(at, text.indexOf("\n}\n", at));
};
const STATION = (() => {
  const start = HTML.indexOf('<article id="station" class="tab-panel');
  const next = HTML.slice(start + 1).search(/<article id="[a-z-]+" class="tab-panel|<\/main>/);
  return HTML.slice(start, start + 1 + next);
})();
const RENDERERS = [
  "public/scripts/views/station.js",
  "public/scripts/stationFacilities.js",
  "public/scripts/constructionPanel.js",
  "public/scripts/upgradeControl.js",
  "public/scripts/views/miningTicker.js",
  "public/scripts/stationArt.js"
];

describe("the Station and its buildings are on the design system (ISP-78)", () => {
  it("no old class of theirs is used anywhere: pages, scripts, stylesheet, tests or specs", () => {
    const files = ["public/index.html", ...filesUnder("public/scripts", [".js"]), "public/styles.css", ...filesUnder("e2e", [".js", ".mjs"]), ...filesUnder("tests", [".js"]).filter((f) => !f.endsWith("stationScreens.test.js"))];
    const found = [];
    for (const f of files) {
      const text = read(f);
      for (const name of OLD_CLASSES) for (const line of classUses(text, name)) found.push(`${f}: .${name}: ${line.trim().slice(0, 100)}`);
    }
    expect(found).toEqual([]);
  });

  it("the check can fail, and does not take an id or a data attribute for a class", () => {
    expect(classUses('<div class="ui-card lease-card">', "lease-card")).toHaveLength(1);
    expect(classUses('page.locator(".lease-card")', "lease-card")).toHaveLength(1);
    expect(classUses('<div id="station-travel-banner">', "travel-banner")).toHaveLength(0);
    expect(classUses('<div data-role="lease-card">', "lease-card")).toHaveLength(0);
  });

  it("the Station's markup uses no shared legacy component and no inline style", () => {
    const found = LEGACY.flatMap((name) => classUses(STATION, name).map((l) => `.${name}: ${l.trim().slice(0, 90)}`));
    expect(found).toEqual([]);
    expect(STATION).not.toMatch(/\sstyle="/);
    expect(STATION).toMatch(/<article id="station" class="tab-panel ui-screen/);
  });

  it.each(RENDERERS)("%s draws no shared legacy component, no layout inline style and no literal colour", (file) => {
    const text = read(file);
    const found = LEGACY.flatMap((name) => classUses(text, name).map((l) => `.${name}: ${l.trim().slice(0, 90)}`));
    expect(found).toEqual([]);
    // The one inline style left is data: how full a cycle's bar is.
    expect(text).not.toMatch(/style="(?!width:\$\{)/);
    expect(text).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it("the station's building cards are design-system parts", () => { // AB#2463: the first prompt is gone
    for (const html of [fnBody("public/scripts/html.js", "stationBuildingCardsHtml")]) {
      expect(LEGACY.flatMap((name) => classUses(html, name))).toEqual([]);
    }
  });

  it("on a phone no text on the Station is set under 14px: its small sizes are raised", () => {
    expect(read("public/styles.css")).toMatch(/@media \(max-width: 600px\) {\s*\.ui-screen :is\([^)]*\.station__hint[^)]*\.extractor__stat-label[^)]*\) {\s*font-size: var\(--font-size-3\);/);
  });
});

describe("a station is known by the body it orbits (ISP-78)", () => {
  const stations = JSON.parse(read("data/stations.json"));
  const list = Array.isArray(stations) ? stations : stations.stations;
  const systemsJson = JSON.parse(read("data/systems.json"));
  const systems = Array.isArray(systemsJson) ? systemsJson : systemsJson.systems;

  it.each(list.map((s) => [s.name, s]))("%s shows its body, from a photograph or drawn", (_name, station) => {
    const body = stationBody(station, systems);
    expect(body?.name).toBe(station.body);
    expect(stationArtKind(body)).not.toBeNull();
    const html = stationArtHtml(station, systems);
    expect(html).toMatch(/class="station__body"/);
    expect(html).toContain(`${station.body}, the body ${station.name} orbits`);
  });

  it("shows nothing rather than a placeholder when the body is unknown", () => {
    expect(stationArtHtml({ name: "Nowhere", body: "Nothing", systemId: "sol" }, systems)).toBe("");
  });
});
