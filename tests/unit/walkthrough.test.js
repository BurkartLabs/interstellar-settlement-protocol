import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { WALKTHROUGH_STEPS } from "../../public/scripts/walkthrough.js";
import { WALKTHROUGH_COMPLETION, isStepComplete, nextStepIndex, chooseHighlight } from "../../public/scripts/walkthrough.js";
import * as html from "../../public/scripts/html.js";
import { clientCode } from "../helpers/clientSource.js";

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
        id: expect.any(String), selector: expect.any(String), tab: expect.any(String), title: expect.any(String), text: expect.any(String), renderedBy: expect.any(String)
      }));
    }
    expect(new Set(WALKTHROUGH_STEPS.map((s) => s.id)).size).toBe(WALKTHROUGH_STEPS.length);
  });

  // AB#580: the order is the tutorial's argument about what matters. A new CEO's first session is at Earth Station
  // Prime, so the station work comes first and the Starmap closes it as orientation. Moving a step fails here.
  it("follows what a new CEO does first, with the Starmap last as orientation", () => {
    expect(WALKTHROUGH_STEPS.map((s) => s.id)).toEqual([
      "licence", "station", "office", "hire", "lease", "yard", "cycle", "sell", "research", "bureau", "overview", "starmap"
    ]);
    expect(WALKTHROUGH_STEPS.at(-1).tab).toBe("starmap");
  });

  it("presents neither travel nor the Starmap as locked or unavailable", () => {
    for (const step of WALKTHROUGH_STEPS) {
      expect(step.text).not.toMatch(/\b(locked|unavailable|cannot travel|can't travel|not (yet )?available)\b/i);
    }
  });

  // AB#579: the briefing is in Elara Voss's voice; the old step-counter framing and the "Agent" address are gone.
  it("reads as her briefing: no step counter, no 'Agent', and the first step introduces her", () => {
    for (const step of WALKTHROUGH_STEPS) {
      expect(step.title).not.toMatch(/^Step \d/);
      expect(step.text).not.toMatch(/\bAgent\b/);
    }
    expect(WALKTHROUGH_STEPS[0].text.startsWith("Elara Voss, Contracting & Assignments Bureau.")).toBe(true);
  });

  for (const [i, step] of WALKTHROUGH_STEPS.entries()) {
    it(`step ${i + 1} "${step.title}": ${step.selector} exists in ${step.renderedBy}`, () => {
      expect(matches(markupFor(step), step.selector)).toBeGreaterThan(0);
    });

    it(`step ${i + 1} "${step.title}": opens a tab that exists`, () => {
      expect(matches(INDEX_HTML, `.nav-tab[data-tab="${step.tab}"]`)).toBe(1);
    });
  }

  it("the matcher finds nothing for an element that is not there, and refuses syntax it does not understand", () => {
    expect(matches(INDEX_HTML, '.nav-tab[data-tab="no-such-tab"]')).toBe(0);
    expect(matches(html.stationBuildingCardsHtml(startStationBuildings), '[data-building-action="building:no-such-office"]')).toBe(0);
    expect(() => matches(INDEX_HTML, "#walkthrough-modal")).toThrow(/unsupported selector/);
    expect(() => matches(INDEX_HTML, ".nav-tab .x")).toThrow(/unsupported selector/);
  });

  // The figures a step quotes that live in a catalog are checked against that catalog, so a price change there fails
  // here. (The office and extractor prices live in the server/routes/*.js handlers; see the PR for their lines.)
  it("quotes the Earth lease price from data/systems.json", () => {
    const earth = SYSTEMS.flatMap((s) => s.bodies || []).find((b) => b.id === "earth");
    const step = WALKTHROUGH_STEPS.find((s) => s.id === "lease");
    expect(step.text).toContain(`Earth, Silicate Extraction, for $${earth.leaseCost.toLocaleString("en-US")}`);
  });

  it("quotes Basic Extraction Analytics' duration and effect from data/research.json", () => {
    const list = Array.isArray(RESEARCH) ? RESEARCH : Object.values(RESEARCH).flat();
    const node = list.find((n) => n && n.id === "tt-basic-extraction");
    const step = WALKTHROUGH_STEPS.find((s) => s.id === "research");
    expect(step.text).toContain(node.name);
    expect(step.text).toContain(`${node.durationHours}-hour`);
    expect(node.effect).toContain("+10%");
    expect(step.text).toContain("10% boost");
  });
});

// AB#581: the walkthrough advances on what the player does. The predicates are exercised against the real routes in
// tests/integration/walkthrough-predicates.test.js; these cover the table's shape and the page-side choices.
describe("interactive walkthrough (AB#581)", () => {
  const APP_JS = clientCode(); // AB#739: app.js and the tab modules it loads, where these controls are drawn

  it("every step has exactly one completion rule, a state predicate or a UI event, and says what it means", () => {
    expect(Object.keys(WALKTHROUGH_COMPLETION).sort()).toEqual(WALKTHROUGH_STEPS.map((s) => s.id).sort());
    for (const step of WALKTHROUGH_STEPS) {
      const rule = WALKTHROUGH_COMPLETION[step.id];
      expect(typeof rule.means, step.id).toBe("string");
      expect(Boolean(rule.event) !== Boolean(rule.state), `${step.id} has exactly one of event and state`).toBe(true);
      // An event step is done by opening the tab it highlights, so what it points at is what completes it.
      if (rule.event) expect(rule.event, step.id).toBe(`tab:${step.tab}`);
    }
  });

  it("an event step is complete only once its event is seen", () => {
    const licence = WALKTHROUGH_STEPS.find((s) => s.id === "licence");
    expect(isStepComplete(licence, {}, new Set())).toBe(false);
    expect(isStepComplete(licence, {}, new Set(["tab:station"]))).toBe(false);
    expect(isStepComplete(licence, {}, new Set(["tab:inbox"]))).toBe(true);
  });

  it("skips what a returning player has already done, and reports the end when everything is done", () => {
    const now = Date.now();
    const returning = {
      corp: {
        currentStationId: "earth-station-prime",
        offices: [{ stationId: "earth-station-prime", rentedUntil: now + 86_400_000 }],
        employeeCount: 6,
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        mining: { silicateExtractors: [{ id: "ext-1", active: false, totalMined: 0 }] },
        tradeHistory: []
      },
      queues: { corporateRnD: [] }
    };
    const seen = new Set(["tab:inbox", "tab:station"]);
    expect(WALKTHROUGH_STEPS[nextStepIndex(0, returning, seen, now)].id).toBe("cycle");
    expect(nextStepIndex(0, returning, new Set(), now), "the licence step still waits for the inbox").toBe(0);

    const everything = new Set(WALKTHROUGH_STEPS.map((s) => WALKTHROUGH_COMPLETION[s.id].event).filter(Boolean));
    returning.corp.mining.silicateExtractors[0].active = true;
    returning.corp.tradeHistory.push({ type: "sold-npc" });
    returning.corp.unlockedTech = ["tt-basic-extraction"];
    expect(nextStepIndex(0, returning, everything, now)).toBe(WALKTHROUGH_STEPS.length);
  });

  describe("what it highlights", () => {
    const office = WALKTHROUGH_STEPS.find((s) => s.id === "office");
    const page = (visible, present = visible) => (selector) => ({ exists: present.includes(selector), visible: visible.includes(selector) });

    it("the control that does the step, when the player is where it is", () => {
      const all = [...office.actionSelectors, office.selector, '.nav-tab[data-tab="station"]'];
      expect(chooseHighlight(office, page(all))).toEqual({ selector: '[id="rent-office-btn"]', missing: false });
    });

    it("the way in, then the way out of another building, then the tab", () => {
      expect(chooseHighlight(office, page([office.selector, '.nav-tab[data-tab="station"]'])).selector).toBe(office.selector);
      const inAnotherBuilding = page(['[id="station-back-btn"]', '.nav-tab[data-tab="station"]'], [office.selector, '[id="station-back-btn"]']);
      expect(chooseHighlight(office, inAnotherBuilding).selector).toBe('[id="station-back-btn"]');
      const onAnotherTab = page(['.nav-tab[data-tab="station"]'], [office.selector, '.nav-tab[data-tab="station"]']);
      expect(chooseHighlight(office, onAnotherTab).selector).toBe('.nav-tab[data-tab="station"]');
    });

    // ISP-75 (AB#764): on a phone a closed group's tabs are out of sight, so the group's button is the way in.
    it("the group's button, when the tab is in a closed group", () => {
      const group = '.nav-group:has(.nav-tab[data-tab="station"]) > .nav-group__button';
      const closed = page([group], [office.selector, '.nav-tab[data-tab="station"]', group]);
      expect(chooseHighlight(office, closed).selector).toBe(group);
    });

    it("nothing, and reports it missing, when the step's own selector is not on the page", () => {
      expect(chooseHighlight(office, page(['.nav-tab[data-tab="station"]']))).toEqual({ selector: null, missing: true });
    });

    // A source check, weaker than rendering: these controls are drawn by client render functions the test cannot call.
    it("every action selector names markup that the client writes", () => {
      for (const step of WALKTHROUGH_STEPS) {
        for (const selector of step.actionSelectors || []) {
          const { classes, attrs } = parseSelector(selector);
          for (const c of classes) expect(APP_JS, `${step.id}: class ${c}`).toMatch(new RegExp(`class="[^"]*\\b${c}\\b`));
          for (const [name, value] of attrs) {
            if (name === "id") expect(APP_JS, `${step.id}: id ${value}`).toContain(`id="${value}"`);
            else expect(APP_JS, `${step.id}: attribute ${name}`).toContain(`${name}="`);
          }
        }
      }
      // The way back out of a building, which chooseHighlight offers for station steps.
      expect(matches(INDEX_HTML, '[id="station-back-btn"]')).toBe(1);
    });
  });
});
