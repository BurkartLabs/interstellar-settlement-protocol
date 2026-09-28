import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatLineHtml, forumPostBodyHtml } from "../../public/scripts/html.js";

// ISP-81 (AB#770): Comms (global, local and trade chat), the Forums and the Assignments Bureau with its contract
// briefing are built from the design system in the flat direction (Decision AB#1801). Player mail is the Inbox's, rebuilt
// by ISP-77 (tests/unit/companyScreens.test.js). Their own old classes are gone from every page, script, stylesheet and
// spec; the shared legacy components are gone from them, though other screens still use them until their own rebuilds.
// At each width they are measured in e2e/comms-screens.spec.js.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const HTML = read("public/index.html");

/** The classes only these screens used before ISP-81. None may appear as a class, selector or toggle anywhere. */
export const OLD_CLASSES = [
  "agent-bio", "agent-card", "agent-card-info", "agent-card-inner", "agent-card-standing", "agent-card-thumb",
  "agent-completed-section", "agent-dialogue", "agent-dialogue-bubble", "agent-dialogue-speaker",
  "agent-dialogue-text", "agent-info-section", "agent-missions-section", "agent-nameplate", "agent-office-layout",
  "agent-portrait", "agent-portrait-section", "agent-rep-bar", "agent-rep-bar-container", "agent-rep-detail",
  "agent-rep-header", "agent-rep-stars", "agent-rep-title", "agent-reputation-section", "agent-title",
  "chat-channel-tab", "chat-channel-tabs", "chat-log", "completed-mission-entry", "completed-mission-icon",
  "completed-mission-meta", "completed-mission-reward", "completed-mission-title", "completed-mission-type",
  "contract-refresh-timer", "form-actions", "forum-category-nav", "forum-thread-card", "forum-thread-card__category",
  "forum-thread-card__excerpt", "forum-thread-card__head", "forum-thread-card__meta", "forum-thread-card__stat",
  "forum-thread-card__title", "forum-thread-full", "forum-thread-header", "forum-thread-list", "forums-nav",
  "inline-form", "mission-card", "mission-card--active", "mission-card-countdown", "mission-card-cta",
  "mission-card-footer", "mission-card-header", "mission-card-reward", "mission-card-text", "mission-card-title",
  "mission-card-type", "mission-complete-card", "mission-complete-dismiss", "mission-complete-heading",
  "mission-complete-icon", "mission-complete-levelup", "mission-complete-overlay", "mission-complete-overlay--exit",
  "mission-complete-particle", "mission-complete-rep", "mission-complete-rep-label", "mission-complete-rep-value",
  "mission-complete-reward", "mission-complete-reward-label", "mission-complete-reward-value",
  "mission-complete-title", "mission-location-local", "mission-location-remote", "mission-location-tag",
  "mission-log-count", "mission-log-header", "mission-log-list", "mission-log-section", "mission-quota-hint",
  "rep-star", "rep-star--filled", "thread-action-btn", "thread-action-btn--primary", "thread-action-btn--like",
  "thread-action-count", "thread-avatar", "thread-avatar--op", "thread-back-btn", "thread-badge",
  "thread-badge--category", "thread-badge--op", "thread-badge--reply", "thread-card", "thread-card--op",
  "thread-card--reply", "thread-card__actions", "thread-card__author", "thread-card__body", "thread-card__body--op",
  "thread-card__head", "thread-card__head-meta", "thread-card__op-tag", "thread-card__timestamp", "thread-detail",
  "thread-detail__header", "thread-detail__meta", "thread-detail__title", "thread-detail__topbar", "thread-meta-dot",
  "thread-replies", "thread-replies__heading", "thread-reply", "thread-reply--empty", "thread-reply-list",
  "thread-reply__connector", "btn-command", "mission-card-risk", "mission-location-warning", "mission-modal-actions",
  "mission-modal-backdrop", "mission-modal-badges", "mission-modal-body", "mission-modal-card",
  "mission-modal-close", "mission-modal-header", "mission-modal-img-placeholder", "mission-modal-meta",
  "mission-modal-reward-badge", "mission-modal-section", "mission-quota-bar", "mission-quota-bar-container",
  "mission-quota-info", "mission-quota-text", "risk-low", "risk-med", "risk-high", "risk-none", "quota-fulfilled",
  "chat-msg", "chat-meta", "forum-quote", "forum-category-btn"
];
/** Shared legacy components: other screens keep them for now, these do not use them. */
const LEGACY = ["btn", "btn-accent", "btn-outline", "btn-sm", "form-card", "data-card", "card-grid", "split-grid", "lede", "muted", "overline", "active"];

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

/** A screen's markup in index.html, from its opening tag to the next panel. */
function panel(id) {
  const start = HTML.indexOf(`<article id="${id}" class="tab-panel`);
  const next = HTML.slice(start + 1).search(/<article id="[a-z-]+" class="tab-panel|<\/main>/);
  return HTML.slice(start, start + 1 + next);
}
const MODAL = (() => {
  const start = HTML.indexOf('<div id="mission-detail-modal"');
  return HTML.slice(start, HTML.indexOf("\n    </div>\n", start));
})();
const SCREENS = { chat: panel("chat"), forums: panel("forums"), missions: panel("missions"), "contract briefing": MODAL };
const RENDERERS = ["public/scripts/views/comms.js", "public/scripts/views/forums.js", "public/scripts/views/assignments.js"];

describe("Comms, the Forums and the Assignments Bureau are on the design system (ISP-81)", () => {
  it("no old class of theirs is used anywhere: pages, scripts, stylesheet, tests or specs", () => {
    const files = ["public/index.html", ...filesUnder("public/scripts", [".js"]), "public/styles.css", ...filesUnder("e2e", [".js", ".mjs"]), ...filesUnder("tests", [".js"]).filter((f) => !f.endsWith("commsScreens.test.js"))];
    const found = [];
    for (const f of files) {
      const text = read(f);
      for (const name of OLD_CLASSES) for (const line of classUses(text, name)) found.push(`${f}: .${name}: ${line.trim().slice(0, 100)}`);
    }
    expect(found).toEqual([]);
  });

  it("the check can fail, and does not take an id or a data attribute for a class", () => {
    expect(classUses('<section class="mission-card">', "mission-card")).toHaveLength(1);
    expect(classUses('page.locator(".mission-card--active")', "mission-card--active")).toHaveLength(1);
    expect(classUses('<ul id="chat-log">', "chat-log")).toHaveLength(0);
    expect(classUses('<div data-mission-id="x">', "mission-card")).toHaveLength(0);
  });

  it.each(Object.keys(SCREENS))("%s uses no shared legacy component and no inline style", (id) => {
    const found = LEGACY.flatMap((name) => classUses(SCREENS[id], name).map((l) => `.${name}: ${l.trim().slice(0, 90)}`));
    expect(found).toEqual([]);
    expect(SCREENS[id]).not.toMatch(/\sstyle="/);
    if (id !== "contract briefing") expect(SCREENS[id]).toMatch(/<article id="[a-z]+" class="tab-panel ui-screen/);
  });

  it.each(RENDERERS)("%s draws no shared legacy component, no layout inline style and no literal colour", (file) => {
    const text = read(file);
    const found = LEGACY.flatMap((name) => classUses(text, name).map((l) => `.${name}: ${l.trim().slice(0, 90)}`));
    expect(found).toEqual([]);
    // The one inline style left is data: how far a standing or a quota has got.
    expect(text).not.toMatch(/style="(?!width:\$\{)/);
    expect(text).not.toMatch(/\.style\.(color|display|cursor|margin)/);
    expect(text).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it("a chat line and a forum post's quote are design-system markup, and still escaped", () => {
    const line = chatLineHtml({ author: "<b>Corp</b>", content: "hi", createdAt: 0 }, () => "12:00");
    expect(line).toContain('class="chat__line"');
    expect(line).toContain("&lt;b&gt;Corp&lt;/b&gt;");
    expect(forumPostBodyHtml("> quoted")).toBe('<blockquote class="forums__quote">quoted</blockquote>');
  });

  it("the channels and the forum categories are the design system's tabs", () => {
    expect((SCREENS.chat.match(/class="ui-tab"/g) || []).length).toBe(3);
    expect(read("public/scripts/views/forums.js")).toContain('`<button class="ui-tab" type="button" role="tab"');
  });

  it("the contract briefing is the game's modal card, so every overlay check that knows .modal-backdrop covers it", () => {
    expect(MODAL).toMatch(/<div id="mission-detail-modal" class="modal-backdrop" hidden>/);
    expect(MODAL).toMatch(/<article class="modal-card missions__modal" role="dialog"/);
  });

  it("on a phone no text on these screens is set under 14px: their small sizes are raised", () => {
    expect(read("public/styles.css")).toMatch(/@media \(max-width: 600px\) {\s*\.ui-screen :is\([^)]*\.chat__meta[^)]*\.missions__overline[^)]*\) {\s*font-size: var\(--font-size-3\);/);
  });
});

// AB#2465 (Board review 2026-09-26, items 19 and 36): the Inbox and Chat are sized containers, 70% of the column and 600px
// tall at 1920x1080, scaling with the screen. The Inbox's height is a minimum it can grow past; Chat's is fixed and its
// log scrolls. What they look like at 1920x1080, 1280x800 and 375x812 is in docs/ab-2465.
describe("the Inbox and Chat containers (AB#2465)", () => {
  const css = read("public/styles.css");
  // one rule's body, by its whole selector: not a selector that follows a comma in a list
  const rule = (selector) => css.match(new RegExp(`(?:^|(?<!,)\\n)${selector.replace(/[.#()*+?^$|[\]\\]/g, "\\$&")} {([^}]*)}`))?.[1] ?? "";

  it("both are 70% of the column, never narrower than a reading width unless the column is, and centred", () => {
    expect(css).toMatch(/#inbox\.ui-screen,\n#chat\.ui-screen {\s*width: max\(70%, min\(100%, 60rem\)\);\s*margin-inline: auto;/);
  });

  it("the Inbox has a minimum height, 600px at 1080px tall, and nothing caps it", () => {
    expect(rule("#inbox.ui-screen")).toMatch(/min-height: clamp\(36rem, 55\.5vh, 50rem\);/);
    expect(rule("#inbox.ui-screen")).not.toMatch(/(?:^|[^-])height:|max-height|overflow/);
  });

  it("Chat's height is fixed, and the log, not the page, takes the overflow", () => {
    expect(rule("#chat.ui-screen")).toMatch(/(?:^|\s)height: clamp\(36rem, 55\.5vh, 50rem\);/);
    expect(rule(".chat")).toMatch(/flex: 1 1 auto;[\s\S]*min-height: 0;/);
    const log = rule(".chat__log");
    expect(log).toMatch(/flex: 1 1 auto;/);
    expect(log).toMatch(/overflow-y: auto;/);
    expect(log).not.toMatch(/(?:^|\s)height:/); // the panel sets the height, so a log of its own height cannot outgrow it
    // the channel tabs scroll sideways, so as a flex item they would shrink to nothing: only the log gives way
    expect(rule(".chat > :not(.chat__log)")).toMatch(/flex: none;/);
  });
});
