import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { WALKTHROUGH_STEPS } from "../../public/scripts/walkthrough.js";
import * as html from "../../public/scripts/html.js";

// AB#404: each walkthrough step highlights one element. Nothing failed when an element moved or a step pointed at the
// wrong tab - the step just highlighted nothing - so every selector is checked against the markup that draws it.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const INDEX_HTML = read("public/index.html");
const BUILDINGS = JSON.parse(read("data/buildings.json")).buildings;
const STATIONS = JSON.parse(read("data/stations.json"));
const SYSTEMS = JSON.parse(read("data/systems.json"));
const RESEARCH = JSON.parse(read("data/research.json"));

// A new corporation starts docked here (createStarterCorporationState), so this is the Station tab it sees.
const START_STATION = (Array.isArray(STATIONS) ? STATIONS : STATIONS.stations).find((s) => s.id === "earth-station-prime");
const startStationBuildings = START_STATION.buildingIds.map((id) => BUILDINGS.find((b) => b.id === id)).filter(Boolean);

/** The markup each `renderedBy` names, rendered from the same data the client is served. */
function markupFor(step) {
  if (step.renderedBy === "index.html") return INDEX_HTML;
  if (step.renderedBy === "stationBuildingCardsHtml") return html.stationBuildingCardsHtml(startStationBuildings);
  throw new Error(`step "${step.title}" names an unknown renderer: ${step.renderedBy}`);
}

/**
 * Parse the compound selectors the walkthrough uses: `.class` and `[attr="value"]` parts, nothing else.
 * Anything outside that grammar throws, so a new kind of selector fails here rather than matching vacuously.
 */
function parseSelector(selector) {
  const parts = { classes: [], attrs: [] };
  const re = /\.([A-Za-z0-9_-]+)|\[([A-Za-z0-9_:-]+)="([^"]*)"\]/y;
  let at = 0;
  while (at < selector.length) {
    re.lastIndex = at;
    const m = re.exec(selector);
    if (!m) throw new Error(`unsupported selector syntax at "${selector.slice(at)}" in ${selector}`);
    if (m[1]) parts.classes.push(m[1]);
    else parts.attrs.push([m[2], m[3]]);
    at = re.lastIndex;
  }
  if (!parts.classes.length && !parts.attrs.length) throw new Error(`empty selector: ${selector}`);
  return parts;
}

const decode = (v) => v.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

/** Every start tag in the markup, as a map of its attributes. */
function startTags(markup) {
  const tags = [];
  for (const [, attrText] of markup.matchAll(/<[a-zA-Z][a-zA-Z0-9-]*((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g)) {
    const attrs = new Map();
    for (const [, name, dq, sq, bare] of attrText.matchAll(/([^\s=>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs.set(name.toLowerCase(), decode(dq ?? sq ?? bare ?? ""));
    }
    tags.push(attrs);
  }
  return tags;
}

function matches(markup, selector) {
  const { classes, attrs } = parseSelector(selector);
  return startTags(markup).filter((tag) => {
    const tagClasses = (tag.get("class") || "").split(/\s+/);
    return classes.every((c) => tagClasses.includes(c)) && attrs.every(([k, v]) => tag.get(k) === v);
  }).length;
}

describe("walkthrough steps (AB#404)", () => {
  it("has the twelve steps, each with a selector, a tab, a title, text and a renderer", () => {
    expect(WALKTHROUGH_STEPS).toHaveLength(12);
    for (const step of WALKTHROUGH_STEPS) {
      expect(step).toEqual(expect.objectContaining({
        selector: expect.any(String), tab: expect.any(String), title: expect.any(String), text: expect.any(String), renderedBy: expect.any(String)
      }));
    }
  });

  for (const [i, step] of WALKTHROUGH_STEPS.entries()) {
    it(`step ${i + 1} "${step.title}": ${step.selector} exists in ${step.renderedBy}`, () => {
      expect(matches(markupFor(step), step.selector)).toBeGreaterThan(0);
    });

    it(`step ${i + 1} "${step.title}": opens a tab that exists`, () => {
      expect(matches(INDEX_HTML, `.tab-btn[data-tab="${step.tab}"]`)).toBe(1);
    });
  }

  it("the matcher finds nothing for an element that is not there, and refuses syntax it does not understand", () => {
    expect(matches(INDEX_HTML, '.tab-btn[data-tab="no-such-tab"]')).toBe(0);
    expect(matches(html.stationBuildingCardsHtml(startStationBuildings), '[data-building-action="building:no-such-office"]')).toBe(0);
    expect(() => matches(INDEX_HTML, "#walkthrough-modal")).toThrow(/unsupported selector/);
    expect(() => matches(INDEX_HTML, ".tab-btn .x")).toThrow(/unsupported selector/);
  });

  // The figures a step quotes that live in a catalog are checked against that catalog, so a price change there fails
  // here. (The office and extractor prices live in server/index.js route handlers; see the PR for their lines.)
  it("quotes the Earth lease price from data/systems.json", () => {
    const earth = SYSTEMS.flatMap((s) => s.bodies || []).find((b) => b.id === "earth");
    const step = WALKTHROUGH_STEPS.find((s) => s.title === "File a Mining Lease");
    expect(step.text).toContain(`Earth, Silicate Extraction, for $${earth.leaseCost.toLocaleString("en-US")}`);
  });

  it("quotes Basic Extraction Analytics' duration and effect from data/research.json", () => {
    const list = Array.isArray(RESEARCH) ? RESEARCH : Object.values(RESEARCH).flat();
    const node = list.find((n) => n && n.id === "tt-basic-extraction");
    const step = WALKTHROUGH_STEPS.find((s) => s.title === "Research Basic Extraction");
    expect(step.text).toContain(node.name);
    expect(step.text).toContain(`${node.durationHours}-hour`);
    expect(node.effect).toContain("+10%");
    expect(step.text).toContain("10% boost");
  });
});
