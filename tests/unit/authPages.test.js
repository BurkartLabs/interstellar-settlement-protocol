import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ISP-76 (AB#765): the pages a stranger sees before playing - the landing, login and register, and the pages that share
// their parts (check your email, verify, forgot and reset the password, how to start) - are built from the design
// system (ISP-72, ISP-73) and tokens, in the flat direction (Decision AB#1801). Their old classes are gone from the
// markup, the scripts, the stylesheet and the specs. The page at each width is measured in e2e/auth-pages.spec.js.
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const CSS = read("public/styles.css");

export const AUTH_PAGES = ["index", "login", "register", "check-email", "verify-email", "forgot-password", "reset-password", "how-to-start"];
const CARD_PAGES = ["login", "register", "check-email", "verify-email", "forgot-password", "reset-password"];

/** The classes these pages used before ISP-76. None may appear as a class, a selector or a class toggle anywhere. */
export const OLD_CLASSES = [
  "auth-shell", "auth-card", "auth-panel", "auth-panel-hero", "auth-panel-label", "landing-hero", "landing-section",
  "landing-grid-2", "landing-grid-3", "landing-howto", "cta-section", "hero-inner", "hero-logo", "logo-svg",
  "hero-overline", "hero-title", "hero-title-top", "hero-title-bottom", "hero-actions", "hero-divider", "divider-line",
  "divider-diamond", "hero-tagline", "hero-desc", "hero-metrics", "btn-hero", "btn-hero-fill", "btn-hero-outline",
  "btn-hero-secondary", "login-shell", "login-card", "login-title", "login-copy", "login-form", "login-forgot",
  "login-status", "login-status-link", "login-actions", "field-error", "howto"
];

/** Every place a class name is used as one: class="...", className = "...", classList.*("..."), and CSS/JS selectors. */
function classUses(text, name) {
  const n = name.replace(/-/g, "\\-");
  const edge = "(?![\\w-])";
  const patterns = [
    new RegExp(`class(Name)?\\s*=\\s*["'\`][^"'\`]*(?<![\\w-])${n}${edge}`),
    new RegExp(`classList\\.(add|remove|toggle|contains)\\([^)]*["'\`]${n}["'\`]`),
    new RegExp(`(?<![\\w-])\\.${n}${edge}`)
  ];
  return text.split("\n").filter((line) => patterns.some((p) => p.test(line)));
}

function filesUnder(dir, exts) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  return readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && exts.some((x) => e.name.endsWith(x)))
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
}

describe("the pages before play are on the design system (ISP-76)", () => {
  it("no old class is used anywhere: pages, scripts, stylesheet, tests or specs", () => {
    const files = [
      ...AUTH_PAGES.map((p) => `public/${p}.html`),
      ...filesUnder("public/scripts", [".js"]),
      "public/styles.css",
      ...filesUnder("e2e", [".js", ".mjs"])
    ];
    expect(files.length).toBeGreaterThan(40);
    const found = [];
    for (const f of files) {
      const text = read(f);
      for (const name of OLD_CLASSES) for (const line of classUses(text, name)) found.push(`${f}: .${name}: ${line.trim().slice(0, 100)}`);
    }
    expect(found).toEqual([]);
  });

  it("the check can fail: it finds each kind of use", () => {
    expect(classUses('<a class="ui-button btn-hero-fill">', "btn-hero-fill")).toHaveLength(1);
    expect(classUses('probe.className = "btn-hero";', "btn-hero")).toHaveLength(1);
    expect(classUses('login.classList.add("btn-hero-fill");', "btn-hero-fill")).toHaveLength(1);
    expect(classUses(".login-card { padding: 0; }", "login-card")).toHaveLength(1);
    expect(classUses('<form id="login-form">', "login-form"), "an id is not a class").toHaveLength(0);
    expect(classUses('<a class="btn-hero-fill">', "btn-hero"), "a longer name is not the shorter").toHaveLength(0);
  });

  it.each(CARD_PAGES)("%s: one card of design-system parts, with exactly one primary action, first", (page) => {
    const html = read(`public/${page}.html`);
    expect(html).toContain('<main class="auth-page">');
    expect(html).toMatch(/<section class="ui-panel auth-page__card"/);
    const actions = html.match(/<(?:button|a)\b[^>]*class="ui-button[^"]*"[^>]*>/g) || [];
    expect(actions.length).toBeGreaterThan(1);
    // AB#1759: cyan on one primary control per screen; everything else is secondary. Hidden ones count too.
    expect(actions.filter((t) => /ui-button--primary/.test(t))).toHaveLength(1);
    expect(actions[0]).toMatch(/ui-button--primary/);
    expect(actions.every((t) => /ui-button--(primary|secondary)\b/.test(t))).toBe(true);
    // Every input sits in a ui-field with its own label.
    for (const m of html.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
      expect(m[0], m[1]).toMatch(/class="ui-input"/);
      expect(html, `label for ${m[1]}`).toContain(`<label class="ui-field__label" for="${m[1]}">`);
    }
  });

  it("register ties each field's own refusal to its field", () => {
    const html = read("public/register.html");
    for (const f of ["email", "password", "ceo", "corp"]) {
      expect(html).toMatch(new RegExp(`id="register-${f}"[^>]*aria-describedby="register-${f}-error"`));
      expect(html).toContain(`<p id="register-${f}-error" class="ui-field__error" aria-live="polite"></p>`);
    }
  });

  it("the landing and how to start are design-system cards and badges on the landing layout", () => {
    const page = read("public/index.html");
    expect(page).toContain('<section id="auth-shell" class="landing"');
    // The landing alone: the game's screens after it have their own badges (ISP-81, AB#770).
    const landing = page.slice(page.indexOf('<section id="auth-shell"'), page.indexOf('<div id="game-shell"'));
    expect((landing.match(/class="ui-card"/g) || []).length).toBeGreaterThanOrEqual(20);
    // Bug #4709: AB#2462 (Board review 2026-09-26, items 1 and 3) took the three promise badges off and put the logo and
    // the tagline at the top; the landing's shape is that now.
    expect((landing.match(/class="ui-badge"/g) || []).length).toBe(0);
    expect(landing.indexOf('class="landing__logo"')).toBeGreaterThan(-1);
    expect(landing.indexOf('class="landing__tagline"')).toBeGreaterThan(landing.indexOf('class="landing__logo"'));
    expect(read("public/how-to-start.html")).toContain('<main class="landing">');
  });

  it("on a phone, no text on these pages is set under 14px: their small sizes are raised", () => {
    expect(CSS).toMatch(/@media \(max-width: 600px\) {\s*:is\(\.auth-page, \.landing\) {[^}]*font-size: var\(--font-size-3\);[^}]*}\s*:is\(\.auth-page, \.landing\) :is\([^)]*\.ui-button[^)]*\.ui-field__error[^)]*\.ui-badge[^)]*\) {\s*font-size: var\(--font-size-3\);/);
  });
});
