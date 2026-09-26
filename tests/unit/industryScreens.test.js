import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queueItemsHtml, researchNodeHtml, refineryBuildButtonHtml } from "../../public/scripts/html.js";

// ISP-79 (AB#768): the Industry screens - Corporate R&D, CEO Insight, Refinery Chains, Assets and Logistics - are built
// from the design system in the flat direction (Decision AB#1801). Their own old classes are gone from every page,
// script, stylesheet and spec; the shared legacy components (.btn, .data-card, .pill, .queue-item and the rest) are gone
// from these screens, though the screens not yet rebuilt still use them. At each width they are measured in
// e2e/industry-screens.spec.js.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const HTML = read("public/index.html");

/** The classes only these five screens used before ISP-79. None may appear as a class, selector or toggle anywhere. */
const OLD_CLASSES = [
  "rnd-panel", "rnd-panel__section", "rnd-panel__section--queue", "rnd-panel__label", "rnd-row", "rnd-row--available",
  "rnd-row--done", "rnd-row--locked", "rnd-row--planned", "rnd-row--queued", "rnd-row__badge", "rnd-row__badge--done",
  "rnd-row__badge--locked", "rnd-row__badge--queued", "rnd-row__effect", "rnd-row__info", "rnd-row__meta",
  "rnd-row__name", "rnd-status-note", "rnd-tier-badge", "rnd-form-ghost", "rnd-enqueue-btn", "ceo-enqueue-btn",
  "queue-progress-meta", "pill-grid", "refine-quantity-row", "refine-quantity-input", "refine-quantity-error",
  "refinery-start-btn", "refinery-build-btn",
  "assets-empty", "assets-panel", "assets-resource-name", "assets-stat", "assets-stat-label", "assets-stat-value",
  "assets-summary-bar", "assets-tab-btn", "assets-tab-nav", "assets-table", "assets-panel-body",
  "logistics-bulk", "logistics-bulk-btn", "logistics-bulk-fee", "logistics-current-badge", "logistics-empty",
  "logistics-grid", "logistics-history", "logistics-history-item", "logistics-history-lines", "logistics-history-list",
  "logistics-history-route", "logistics-history-fee", "logistics-history-time", "logistics-in-flight",
  "logistics-in-flight-eta", "logistics-in-flight-held", "logistics-in-flight-item", "logistics-in-flight-item--held",
  "logistics-in-flight-lines", "logistics-in-flight-list", "logistics-in-flight-route", "logistics-in-flight-fee",
  "logistics-item-list", "logistics-item-meta", "logistics-item-name", "logistics-item-qty", "logistics-item-row",
  "logistics-item-row--transfer", "logistics-pick", "logistics-qty-input", "logistics-route-fee",
  "logistics-station-card", "logistics-station-card--current", "logistics-station-header", "logistics-station-sub",
  "logistics-station-title", "logistics-status", "logistics-status--error", "logistics-status--ok", "logistics-summary",
  "logistics-summary-label", "logistics-summary-tile", "logistics-summary-value", "logistics-summary-value--wrap",
  "logistics-transfer-btn", "logistics-transfer-controls"
];
/** Shared legacy components: other screens keep them for now, these five do not use them. */
const LEGACY = ["btn", "btn-accent", "btn-ghost", "btn-outline", "btn-sm", "form-card", "data-card", "card-grid", "text-list", "lede", "muted", "num", "pill", "queue-item", "queue-list", "building-status-badge", "station-location-banner"];

/** Every place a class name is used as one: class="...", className = "...", classList.*("..."), and selectors. */
function classUses(text, name) {
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

/** A screen's own markup in index.html, from its opening tag to the next panel. */
function panel(id) {
  const start = HTML.indexOf(`<article id="${id}" class="tab-panel`);
  const next = HTML.slice(start + 1).search(/<article id="[a-z]+" class="tab-panel|<\/main>/);
  return HTML.slice(start, start + 1 + next);
}
const SCREENS = Object.fromEntries(["rnd", "ceo", "refinery", "assets", "logistics"].map((id) => [id, panel(id)]));
const RENDERERS = ["public/scripts/views/research.js", "public/scripts/views/ceoInsight.js", "public/scripts/views/refinery.js", "public/scripts/views/assets.js", "public/scripts/views/logistics.js"];
/** The html.js helpers only these screens draw with. */
function helper(name) {
  const html = read("public/scripts/html.js");
  const at = html.indexOf(`export function ${name}`);
  return html.slice(at, html.indexOf("\n}\n", at));
}
const HELPERS = ["queueItemsHtml", "researchNodeHtml", "refineryBuildButtonHtml"];

describe("Corporate R&D, CEO Insight, Refinery Chains, Assets and Logistics are on the design system (ISP-79)", () => {
  it("no old class of theirs is used anywhere: pages, scripts, stylesheet, tests or specs", () => {
    const files = ["public/index.html", ...filesUnder("public/scripts", [".js"]), "public/styles.css", ...filesUnder("e2e", [".js", ".mjs"]), ...filesUnder("tests", [".js"]).filter((f) => !f.endsWith("industryScreens.test.js"))];
    const found = [];
    for (const f of files) {
      const text = read(f);
      for (const name of OLD_CLASSES) for (const line of classUses(text, name)) found.push(`${f}: .${name}: ${line.trim().slice(0, 100)}`);
    }
    expect(found).toEqual([]);
  });

  it("the check can fail", () => {
    expect(classUses('<div class="rnd-row rnd-row--done">', "rnd-row")).toHaveLength(1);
    expect(classUses("el.closest('.logistics-qty-input')", "logistics-qty-input")).toHaveLength(1);
    expect(classUses('<div id="logistics-content">', "logistics-content")).toHaveLength(0);
  });

  it.each(Object.keys(SCREENS))("#%s uses no shared legacy component and no inline style, and is a ui-screen", (id) => {
    expect(SCREENS[id]).toMatch(new RegExp(`<article id="${id}" class="tab-panel ui-screen`));
    const found = LEGACY.flatMap((name) => classUses(SCREENS[id], name).map((l) => `.${name}: ${l.trim().slice(0, 90)}`));
    expect(found).toEqual([]);
    expect(SCREENS[id]).not.toMatch(/\sstyle="/);
  });

  it.each([...RENDERERS, ...HELPERS])("%s draws no shared legacy component, no colour and no inline style but a bar's width", (source) => {
    const text = source.endsWith(".js") ? read(source) : helper(source);
    const found = LEGACY.flatMap((name) => classUses(text, name).map((l) => `.${name}: ${l.trim().slice(0, 90)}`));
    expect(found).toEqual([]);
    expect(text).not.toMatch(/style="(?!width:\$\{)/);
    expect(text).not.toMatch(/\.style\.(display|color)\s*=/);
    expect(text).not.toMatch(/#[0-9a-fA-F]{6}\b|var\(--(warn|accent|danger|success)\)/);
  });

  it("every table is a ui-table whose cells carry their column's name, so a phone shows cards", () => {
    for (const file of ["public/scripts/views/assets.js", "public/scripts/views/logistics.js"]) {
      const text = read(file);
      expect((text.match(/<table class="ui-table/g) || []).length, file).toBe(2);
      expect(text.match(/<td(?![^>]*data-label)[^>]*>/g) || [], file).toEqual([]);
    }
  });

  it("a research node says why it cannot be taken, or offers its action", () => {
    const locked = researchNodeHtml({ name: "<b>X</b>", tier: 2, effect: "e", meta: ["Requires: A"], state: "locked" });
    expect(locked).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(locked).toContain('<span class="ui-badge ">Locked</span>');
    expect(locked).toContain('<span class="ui-badge">T2</span>');
    const open = researchNodeHtml({ name: "Y", effect: "e", state: "available", action: "<button>Go</button>" });
    expect(open).toContain('<div class="research__node-foot"><button>Go</button></div>');
    expect(researchNodeHtml({ name: "Z", effect: "e", state: "planned" })).toContain("research__node--planned");
    expect(queueItemsHtml([{ name: "Q", effect: "e", durationHours: 2, startedAt: 1 }], "t", { progressOf: () => 50, remainingLabel: () => "1h", formatCredits: String })).toContain('aria-valuenow="50"');
    expect(refineryBuildButtonHtml({ hasRefinery: false, used: 0, slots: 2 })).toContain("ui-button ui-button--secondary");
  });

  it("a planned program's effect stays struck through (Bug #983), and a phone raises these screens' own small text", () => {
    const css = read("public/styles.css");
    expect(css).toMatch(/\.research__node--planned \.ui-card__body \{\s*text-decoration: line-through;/);
    expect(css).toMatch(/\.ui-screen :is\(\.logistics__item, \.refinery__status, \.logistics__status\) \{\s*font-size: var\(--font-size-3\);/);
    expect(css).toMatch(/\.ui-screen :is\([^)]*\.ui-field__error[^)]*\) \{\s*font-size: var\(--font-size-3\);/);
  });
});
