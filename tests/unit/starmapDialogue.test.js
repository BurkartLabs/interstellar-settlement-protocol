import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ISP-82 (AB#771): the Starmap, the walkthrough and the dialogue (with Elara Voss's portrait) are built from the design
// system in the flat direction (Decision AB#1801). Their own old classes are gone from every page, script, stylesheet
// and spec; the shared legacy components (.btn, .muted, .overline, .lede, .choice-row, .text-list) are gone from them,
// though screens not yet rebuilt still use them. The modals are the game's own (.modal-backdrop, .modal-card). The map
// draws its labels on a canvas no DOM check reads, so they take their size from chartFont. At each width they are
// measured in e2e/starmap-dialogue.spec.js.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const HTML = read("public/index.html");

/** The classes only these surfaces used before ISP-82. None may appear as a class, selector or toggle anywhere. */
const OLD_CLASSES = [
  "toolbar", "starmap-fallback", "starmap-tooltip", "starmap-modal-overlay", "starmap-modal-card", "starmap-modal-close",
  "starmap-modal-overline", "starmap-modal-title", "starmap-modal-stats", "starmap-modal-stat", "starmap-modal-stat-label",
  "starmap-modal-stat-value", "starmap-modal-actions", "starmap-modal-dock-btn", "starmap-modal-system-btn",
  "starmap-expedition-card", "starmap-exp-select", "starmap-mining-panel", "starmap-mining-locked", "starmap-dock-btn",
  "starmap-travel-system-btn", "has-portrait", "dialogue-portrait", "walkthrough-progress", "walkthrough-focus",
  "walkthrough-open", "body-survey", "body-lease"
];
/** Shared legacy components: other screens keep them for now, these surfaces do not use them. */
const LEGACY = ["btn", "btn-accent", "btn-outline", "btn-ghost", "muted", "overline", "lede", "choice-row", "text-list", "form-card", "panel-block", "data-card"];

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
    new RegExp(`(?<![\\w.#-])\\.${n}${edge}(?!\\s*\\()`)
  ];
  return text.split("\n").filter((line) => patterns.some((p) => p.test(line)));
}

const filesUnder = (dir, exts) =>
  readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && exts.some((x) => e.name.endsWith(x)))
    .map((e) => path.relative(ROOT, path.join(e.parentPath, e.name)).split(path.sep).join("/"));

/** A piece of index.html from its opening tag to the next top-level section or panel. */
function markup(open, next) {
  const start = HTML.indexOf(open);
  const end = HTML.indexOf(next, start + open.length);
  return HTML.slice(start, end);
}
const SURFACES = {
  starmap: markup('<article id="starmap" class="tab-panel', "</main>"),
  dialogue: markup('<section id="dialogue-modal"', "</section>"),
  walkthrough: markup('<section id="walkthrough-modal"', "</section>")
};
const RENDERERS = ["public/scripts/starmap.js", "public/scripts/bodyInfo.js", "public/scripts/dialogue.js", "public/scripts/walkthroughUi.js", "public/scripts/views/starmap.js"];

describe("the Starmap, the walkthrough and the dialogue are on the design system (ISP-82)", () => {
  it("no old class of theirs is used anywhere: pages, scripts, stylesheet, tests or specs", () => {
    const files = ["public/index.html", ...filesUnder("public/scripts", [".js"]), "public/styles.css", ...filesUnder("e2e", [".js", ".mjs"]), ...filesUnder("tests", [".js"]).filter((f) => !f.endsWith("starmapDialogue.test.js"))];
    const found = [];
    for (const f of files) {
      const text = read(f);
      for (const name of OLD_CLASSES) for (const line of classUses(text, name)) found.push(`${f}: .${name}: ${line.trim().slice(0, 100)}`);
    }
    expect(found).toEqual([]);
  });

  it("the check can fail, and does not take an id for a class", () => {
    expect(classUses('<img class="dialogue-portrait">', "dialogue-portrait")).toHaveLength(1);
    expect(classUses('document.body.classList.add("walkthrough-open")', "walkthrough-open")).toHaveLength(1);
    expect(classUses('<p id="walkthrough-progress">', "walkthrough-progress")).toHaveLength(0);
    expect(classUses('document.querySelector("#starmap-fallback")', "starmap-fallback")).toHaveLength(0);
  });

  it.each(Object.keys(SURFACES))("the %s markup uses no shared legacy component and no inline style", (id) => {
    expect(SURFACES[id].length).toBeGreaterThan(100);
    const found = LEGACY.flatMap((name) => classUses(SURFACES[id], name).map((l) => `.${name}: ${l.trim().slice(0, 90)}`));
    expect(found).toEqual([]);
    expect(SURFACES[id]).not.toMatch(/\sstyle="/);
  });

  it("the Starmap is a ui-screen, and each modal is the game's modal card holding a dialogue", () => {
    expect(SURFACES.starmap).toMatch(/<article id="starmap" class="tab-panel ui-screen/);
    expect(SURFACES.dialogue).toContain('class="modal-card dialogue"');
    expect(SURFACES.walkthrough).toContain('class="modal-card dialogue walkthrough"');
    expect(SURFACES.dialogue).toContain('class="dialogue__portrait"');
    expect(SURFACES.walkthrough).toContain('class="dialogue__portrait"');
  });

  it.each(RENDERERS)("%s draws no shared legacy component, no colour in its markup and no inline style but a bar's width", (file) => {
    const text = read(file);
    const found = LEGACY.flatMap((name) => classUses(text, name).map((l) => `.${name}: ${l.trim().slice(0, 90)}`));
    expect(found).toEqual([]);
    expect(text).not.toMatch(/style="(?!width:\$\{)/);
    expect(text).not.toMatch(/\.style\.display\s*=/);
  });

  it("the map's labels are drawn through chartFont, so a phone draws none under 14px", () => {
    const starmap = read("public/scripts/starmap.js");
    expect(starmap).not.toMatch(/ctx\.font = ['"][^'"]*\d+px/);
    // Every px size the map sets comes from chartFont: no ctx.font with a literal size, and a size variable is one.
    expect(starmap).not.toMatch(/ctx\.font = `[^`$]*\d+px/);
    expect(starmap).not.toMatch(/(?:Size|size) = \d+;/);
    // A star's name, YOU ARE HERE, the back buttons (drawn and measured), a body's name and a moon's.
    expect((starmap.match(/chartFont\(/g) || []).length).toBeGreaterThanOrEqual(6);
  });

  it("on a phone the modals' own small text is raised, as a screen's is", () => {
    const css = read("public/styles.css");
    expect(css).toMatch(/:is\(\.dialogue, \.starmap__station\) :is\(\.ui-button, \.dialogue__speaker[^)]*\) \{\s*font-size: var\(--font-size-3\);/);
  });
});
