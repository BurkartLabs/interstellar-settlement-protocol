import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chartFont } from "../../public/scripts/charts.js";

// ISP-77 (AB#766): the Company group's screens - Overview, Inbox and the Financial Core with its daily statements - are
// built from the design system in the flat direction (Decision AB#1801). Their own old classes are gone from every
// page, script, stylesheet and spec; the shared legacy components (.btn, .form-card, .data-card and the rest) are gone
// from these screens, though other screens still use them until their own rebuilds. At each width they are measured
// in e2e/company-screens.spec.js.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const HTML = read("public/index.html");

/** The classes only these three screens used before ISP-77. None may appear as a class, selector or toggle anywhere. */
export const OLD_CLASSES = [
  "btn-danger", "btn-primary", "card", "chart-card", "chart-card--wide", "chart-card__head", "chart-card__sub",
  "chart-duration-picker", "chart-grid", "compose-body-area", "compose-candidate", "compose-candidates", "feedback-panel",
  "finance-chart-grid", "finance-header", "finance-header__doc", "finance-header__meta", "finance-meta__label",
  "finance-meta__value", "finance-statements", "finance-statements__head", "finance-statements__picker", "finance-table",
  "finance-table-card", "finance-tables", "inbox-back-btn", "inbox-compose-actions", "inbox-compose-btn",
  "inbox-compose-form", "inbox-compose-status", "inbox-detail-actions", "inbox-detail-body", "inbox-detail-card",
  "inbox-detail-date", "inbox-detail-from", "inbox-detail-meta", "inbox-detail-subject", "inbox-folder-btn",
  "inbox-folder-nav", "inbox-message-list", "inbox-msg-item", "inbox-msg-top", "inbox-msg-to", "inbox-msg-from",
  "inbox-msg-date", "inbox-msg-subject", "inbox-unread-dot", "inbox-subtab-btn", "inbox-subtab-nav", "num--negative",
  "num--positive", "requirement-card", "requirement-hint", "requirement-state", "requirement-title", "requirement-done",
  "requirement-clickable", "just-completed", "statement-card", "statement-empty", "statement-grid", "statement-heading",
  "statement-muted", "statement-sofar", "statement-total"
];
/** Shared legacy components: other screens keep them for now, these three do not use them. */
const LEGACY = ["btn", "btn-ghost", "btn-outline", "form-card", "data-card", "card-grid", "text-list", "lede", "action-surface", "muted", "num"];

/** Every place a class name is used as one: class="...", className = "...", classList.*("..."), and selectors. */
function classUses(text, name) {
  const n = name.replace(/-/g, "\\-");
  const edge = "(?![\\w-])";
  const patterns = [
    new RegExp(`class(Name)?\\s*=\\s*["'\`][^"'\`]*(?<![\\w-])${n}${edge}`),
    new RegExp(`classList\\.(add|remove|toggle|contains)\\([^)]*["'\`]${n}["'\`]`),
    new RegExp(`(?<![\\w.-])\\.${n}${edge}(?!\\s*\\()`) // not after a dot: `[...card.x]` is a spread, not a class
  ];
  return text.split("\n").filter((line) => patterns.some((p) => p.test(line)));
}

const filesUnder = (dir, exts) =>
  readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && exts.some((x) => e.name.endsWith(x)))
    .map((e) => path.relative(ROOT, path.join(e.parentPath, e.name)).split(path.sep).join("/"));

/** The three screens' own markup in index.html, each article from its opening tag to the next panel. */
function panel(id) {
  const start = HTML.indexOf(`<article id="${id}" class="tab-panel`);
  const next = HTML.slice(start + 1).search(/<article id="[a-z]+" class="tab-panel|<\/main>/);
  return HTML.slice(start, start + 1 + next);
}
const SCREENS = { overview: panel("overview"), inbox: panel("inbox"), finance: panel("finance") };
const RENDERERS = ["public/scripts/views/overview.js", "public/scripts/views/inbox.js", "public/scripts/views/finance.js", "public/scripts/statements.js"];
const inboxRows = () => {
  const html = read("public/scripts/html.js");
  const at = html.indexOf("export function messageListItemsHtml");
  return html.slice(at, html.indexOf("\n}\n", at));
};

describe("Overview, Inbox and the Financial Core are on the design system (ISP-77)", () => {
  it("no old class of theirs is used anywhere: pages, scripts, stylesheet, tests or specs", () => {
    const files = ["public/index.html", ...filesUnder("public/scripts", [".js"]), "public/styles.css", ...filesUnder("e2e", [".js", ".mjs"]), ...filesUnder("tests", [".js"]).filter((f) => !f.endsWith("companyScreens.test.js"))];
    const found = [];
    for (const f of files) {
      const text = read(f);
      for (const name of OLD_CLASSES) for (const line of classUses(text, name)) found.push(`${f}: .${name}: ${line.trim().slice(0, 100)}`);
    }
    expect(found).toEqual([]);
  });

  it("the check can fail, and does not take an id, a longer name or a function for a class", () => {
    expect(classUses('<div class="card inbox-detail-card">', "card")).toHaveLength(1);
    expect(classUses('<div class="ui-card">', "card")).toHaveLength(0);
    expect(classUses('<ul id="inbox-message-list">', "inbox-message-list")).toHaveLength(0);
    expect(classUses("list.querySelectorAll('.inbox-msg-item')", "inbox-msg-item")).toHaveLength(1);
    expect(classUses("x.num(2)", "num")).toHaveLength(0);
    expect(classUses('[...card.querySelectorAll("a")]', "card")).toHaveLength(0);
  });

  it.each(Object.keys(SCREENS))("%s uses no shared legacy component, no inline style and no old colour", (id) => {
    const found = LEGACY.flatMap((name) => classUses(SCREENS[id], name).map((l) => `.${name}: ${l.trim().slice(0, 90)}`));
    expect(found).toEqual([]);
    expect(SCREENS[id]).not.toMatch(/\sstyle="/);
    expect(SCREENS[id]).toMatch(/<article id="[a-z]+" class="tab-panel ui-screen/);
  });

  it.each(RENDERERS)("%s draws no shared legacy component, no inline style and no literal colour", (file) => {
    const text = read(file);
    const found = LEGACY.flatMap((name) => classUses(text, name).map((l) => `.${name}: ${l.trim().slice(0, 90)}`));
    expect(found).toEqual([]);
    expect(text).not.toMatch(/style="[^"]*(color|margin|cursor)/);
    expect(text).not.toMatch(/\.style\.display\s*=/);
    expect(text).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it("the inbox rows are design-system cards", () => {
    expect(LEGACY.flatMap((name) => classUses(inboxRows(), name))).toEqual([]);
    expect(inboxRows()).toContain('class="ui-card ui-card--interactive inbox__message');
  });

  it("every finance table and the statements are ui-table, so a phone shows them as cards", () => {
    expect((SCREENS.finance.match(/<table\b[^>]*class="ui-table"/g) || []).length).toBe(2);
    expect(read("public/scripts/statements.js")).toContain('<table class="ui-table">');
    // Each cell carries its column's name, which the cards show (ISP-73).
    const finance = read("public/scripts/views/finance.js");
    expect(finance).toContain('<td data-label="${labels[0]}">');
    expect(finance).toContain('const L = ["Category", "Amount ($)"];');
    expect(finance).toContain('const L = ["Line item", "Value ($)"];');
    expect(read("public/scripts/statements.js")).toMatch(/<td data-label="Line">/);
  });

  it("on a phone no text on these screens is set under 14px: their small sizes are raised", () => {
    expect(read("public/styles.css")).toMatch(/@media \(max-width: 600px\) {\s*\.ui-screen :is\([^)]*\.ui-button[^)]*\.kpi-tile__label[^)]*\) {\s*font-size: var\(--font-size-3\);/);
  });
});

// The charts draw their own text on a canvas, which no DOM check reads: they take its size from chartFont.
describe("the Financial Core's charts on a phone (ISP-77)", () => {
  it("draw no text under 14px on a phone, and keep their smaller sizes on a wider screen", () => {
    expect(chartFont(10, true)).toBe(14);
    expect(chartFont(11, true)).toBe(14);
    expect(chartFont(10, false)).toBe(10);
  });

  it("set every font size through chartFont, none as a literal", () => {
    const charts = read("public/scripts/charts.js");
    expect(charts).not.toMatch(/font: \{ size: \d+/);
    expect((charts.match(/font: \{ size: chartFont\(/g) || []).length).toBeGreaterThanOrEqual(6);
  });
});
