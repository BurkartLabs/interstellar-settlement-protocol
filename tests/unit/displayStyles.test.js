import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// AB#4880: the display styles' contract (docs/design/DISPLAY_STYLES.md), the parts a file can be held to without a
// browser: every style listed has its sheet and every sheet is listed; every rule is scoped to its own style; no
// `content:` carries words; fonts come from public/themes/fonts.css; nothing is fetched from another origin. What a
// style hides on screen is scripts/look-display-styles.mjs's to find, by looking.
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SCRIPT = read("public/scripts/displayStyles.js");
const IDS = [...SCRIPT.matchAll(/\{ id: "([a-z0-9-]+)"/g)].map((m) => m[1]);
const FILES = readdirSync(new URL("../../public/themes/", import.meta.url)).filter((f) => f.endsWith(".css") && f !== "fonts.css");
const FONTS = read("public/themes/fonts.css");
const FAMILIES = new Set([...FONTS.matchAll(/font-family: "([^"]+)"/g)].map((m) => m[1]));
const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-monospace|ui-sans-serif|ui-serif|inherit|initial|unset|-apple-system|BlinkMacSystemFont|Segoe UI|Roboto|Consolas|Cascadia Code|SFMono-Regular|Menlo|Courier New|Helvetica Neue|Helvetica|Arial|Georgia|Times New Roman|Times|Palatino|Iowan Old Style|Arial Narrow|Arial Black|Impact|Noto Sans|Inter)$/i; // generics and fonts a system has (never downloaded)

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
/** Every selector list in a sheet, with @-rule preludes and keyframe steps left out. */
function selectors(css) {
  const out = [];
  const text = stripComments(css);
  const re = /([^{}]+)\{/g;
  let inKeyframes = 0;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") { depth -= 1; if (inKeyframes && depth < inKeyframes) inKeyframes = 0; }
  }
  depth = 0;
  let m;
  let last = 0;
  while ((m = re.exec(text))) {
    for (let i = last; i < m.index; i += 1) { if (text[i] === "}") { depth -= 1; if (inKeyframes && depth < inKeyframes) inKeyframes = 0; } }
    const prelude = m[1].trim().replace(/^[;}\s]+/, "");
    last = re.lastIndex;
    depth += 1;
    if (prelude.startsWith("@")) { if (/^@(-webkit-)?keyframes/.test(prelude)) inKeyframes = depth; continue; }
    if (inKeyframes) continue;
    out.push(prelude);
  }
  return out;
}

describe("display styles (AB#4880)", () => {
  it("lists every sheet and has a sheet for every style listed", () => {
    expect(IDS.length).toBe(16);
    expect(FILES.map((f) => f.replace(/\.css$/, "")).sort()).toEqual([...IDS].sort());
  });

  for (const file of FILES) {
    const id = file.replace(/\.css$/, "");
    const css = read(`public/themes/${file}`);

    it(`${id}: scopes every rule to [data-theme="${id}"]`, () => {
      const loose = [];
      for (const list of selectors(css)) {
        for (const sel of list.split(/,(?![^(]*\))/)) {
          if (!sel.trim()) continue;
          if (!sel.includes(`[data-theme="${id}"]`)) loose.push(sel.trim());
        }
      }
      expect(loose).toEqual([]);
    });

    it(`${id}: adds no words (content is empty or none)`, () => {
      const bad = [...stripComments(css).matchAll(/(?<![-\w])content\s*:\s*([^;}]+)/g)]
        .map((m) => m[1].trim())
        // the game's own count (styles.css .nav-count) may be re-declared; nothing else with words
        .filter((v) => !/^(""|''|none|normal|""\s*\/\s*""|''\s*\/\s*''|attr\(data-count\))(\s*!important)?$/.test(v));
      expect(bad).toEqual([]);
    });

    it(`${id}: uses only the vendored fonts`, () => {
      const unknown = new Set();
      for (const m of stripComments(css).matchAll(/(?<![-\w])(?:font-family|--font-(?!size|weight)[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
        for (const part of m[1].split(",")) {
          const name = part.trim().replace(/^["']|["']$/g, "").replace(/\s*!important$/, "");
          if (!name || name.startsWith("var(") || GENERIC.test(name) || FAMILIES.has(name)) continue;
          unknown.add(name);
        }
      }
      expect([...unknown]).toEqual([]);
    });

    it(`${id}: fetches nothing from another origin`, () => {
      const urls = [...stripComments(css).matchAll(/url\(\s*["']?([^"')]+)/g)].map((m) => m[1]).filter((u) => !u.startsWith("data:") && !u.startsWith("/") && !/^(#|%23)/.test(u)); // #id: a reference inside a data: SVG
      expect(urls).toEqual([]);
      expect(css).not.toMatch(/@import/);
    });
  }

  it("declares only faces whose files are vendored", () => {
    const srcs = [...FONTS.matchAll(/url\("(\/vendor\/fonts\/[^"]+)"\)/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(30);
    for (const src of srcs) expect(() => readFileSync(new URL(`../../public${src}`, import.meta.url))).not.toThrow();
  });

  it("loads the chooser on every page, straight after the stylesheet", () => {
    // the game's page loads styles.css from scripts/appStyles.js (Bug #4839); the chooser follows that module
    expect(read("public/index.html")).toMatch(/src="scripts\/appStyles\.js" async><\/script>\s*<script src="\/scripts\/displayStyles\.js"><\/script>/);
    const pages = ["login", "register", "check-email", "verify-email", "forgot-password", "reset-password", "how-to-start"];
    for (const p of pages) expect(read(`public/${p}.html`)).toMatch(/href="\/?styles\.css" \/>\s*<script src="\/scripts\/displayStyles\.js"><\/script>/);
  });
});
