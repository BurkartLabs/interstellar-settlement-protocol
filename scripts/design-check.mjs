// ISP-246 (AB#942): the design-system check. No bundler (README: no build step); plain reads of the public files. It fails
// on four kinds of drift from ISP-25's design system (docs/design/BUREAUCRATIC_UI.md and VISUAL.md sit on top of it):
//   literal  a colour, font size, spacing, radius or z-index written as a value outside the token block
//   class    a class the HTML or the JavaScript uses that no CSS rule styles
//   var      a var(--x) that nothing defines
//   image    an image path that does not exist
// A known violation is listed in data/design-allowlist.json with the story that removes it (v1.0-06/07/08); the list is
// meant to empty, and the release gate (v1.0-31) asserts it is empty. The section-code slots (ISP-248) have their own
// test, tests/unit/sectionHeaders.test.js.
//
// Usage: node scripts/design-check.mjs   (exit 1 and one line per violation when something drifted)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const walk = (dir, ext) => fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map((f) => `${dir}/${String(f).replace(/\\/g, "/")}`).filter((f) => f.endsWith(ext));

/** The public sources the check reads. */
export function sources() {
  return {
    css: { "public/styles.css": read("public/styles.css") },
    html: Object.fromEntries([...walk("public", ".html")].map((f) => [f, read(f)])),
    js: Object.fromEntries(walk("public/scripts", ".js").map((f) => [f, read(f)])),
    data: Object.fromEntries(walk("data", ".json").map((f) => [f, read(f)]))
  };
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/** The token block: from "Design tokens" to "End of design tokens", as ISP-70 wrote it. */
function tokenBlock(css) {
  const from = css.indexOf("/* ─── Design tokens");
  const to = css.indexOf("/* ─── End of design tokens ─── */");
  return from >= 0 && to > from ? [from, to] : [0, 0];
}

const LITERAL = [
  ["colour", /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g],
  ["font size", /font-size\s*:\s*[0-9.]+(?:px|rem|em)\b/g],
  ["spacing", /\b(?:margin|padding|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*[^;{}]*?\b(?!0px\b|1px\b)[0-9.]*[1-9][0-9.]*(?:px|rem|em)\b/g],
  ["radius", /border-(?:[a-z]+-)*radius\s*:\s*[^;{}]*?\b[0-9.]*[1-9][0-9.]*(?:px|rem|em)\b/g],
  ["z-index", /z-index\s*:\s*-?\d+/g]
];

/** Kind 1: literals in the stylesheet outside the token block and outside comments. */
export function literalViolations(src) {
  const out = [];
  for (const [file, raw] of Object.entries(src.css)) {
    const css = stripComments(raw);
    const [from, to] = tokenBlock(raw);
    for (const [what, re] of LITERAL) {
      for (const m of css.matchAll(re)) {
        if (m.index >= from && m.index < to) continue;
        out.push({ kind: "literal", file, line: lineOf(css, m.index), key: `${what}: ${m[0].replace(/\s+/g, " ").trim()}` });
      }
    }
  }
  return out;
}

/** Every class a CSS selector names. */
function styledClasses(src) {
  const set = new Set();
  for (const raw of Object.values(src.css)) for (const m of stripComments(raw).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) set.add(m[1]);
  return set;
}

/** Kind 2: classes the HTML or JS uses that no rule styles. Only static class names (template expressions are skipped). */
export function classViolations(src) {
  const styled = styledClasses(src);
  const out = [];
  const seen = new Set();
  const check = (file, text, re) => {
    for (const m of text.matchAll(re)) {
      for (const cls of m[1].split(/\s+/)) {
        if (!cls || /[${}()<>"'`]/.test(cls) || styled.has(cls) || seen.has(`${file}:${cls}`)) continue;
        seen.add(`${file}:${cls}`);
        out.push({ kind: "class", file, line: lineOf(text, m.index), key: `class: ${cls}` });
      }
    }
  };
  for (const [file, text] of Object.entries(src.html)) check(file, text, /\bclass="([^"]*)"/g);
  for (const [file, text] of Object.entries(src.js)) {
    check(file, text, /\bclass="([^"$]*)"/g);
    check(file, text, /classList\.(?:add|toggle|remove)\(\s*"([\w-]+)"/g);
  }
  return out;
}

/** Kind 3: var(--x) with no --x: definition anywhere in the stylesheet (JS may set some on an element: listed there). */
export function varViolations(src) {
  const defined = new Set();
  for (const raw of Object.values(src.css)) for (const m of raw.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  for (const text of Object.values(src.js)) for (const m of text.matchAll(/setProperty\(\s*["'`](--[\w-]+)/g)) defined.add(m[1]);
  const out = [];
  const files = { ...src.css, ...src.html, ...src.js };
  for (const [file, text] of Object.entries(files)) {
    const body = file.endsWith(".css") ? stripComments(text) : text;
    for (const m of body.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!defined.has(m[1])) out.push({ kind: "var", file, line: lineOf(body, m.index), key: `var: ${m[1]}` });
    }
  }
  return out;
}

/** Kind 4: an image path (src=, url(), "/images/…" in scripts and data) that is not a file under public/. */
export function imageViolations(src) {
  const out = [];
  const exists = (p) => fs.existsSync(path.join(ROOT, "public", p.replace(/^\//, "").split(/[?#]/)[0]));
  const scan = (file, text, re) => {
    for (const m of text.matchAll(re)) {
      const p = m[1];
      if (/^(data:|https?:|\/\/)/.test(p) || /[${}]/.test(p)) continue;
      if (!exists(p)) out.push({ kind: "image", file, line: lineOf(text, m.index), key: `image: ${p}` });
    }
  };
  const IMG = /["'(]((?:\/|\.\/)?images\/[^"')\s]+\.(?:png|jpe?g|svg|webp|gif|avif))/g;
  for (const [file, text] of Object.entries({ ...src.css, ...src.html, ...src.js, ...src.data })) scan(file, text, IMG);
  // AB#949: a data file names an image relative to public/images/ too ("imageFile": "buildings/x.png" named 17 PNGs
  // that never existed, and the pattern above, which wants an images/ prefix, never saw them).
  const DATA_IMG = /"((?![/.]|images\/|https?:|data:)[^"\s]+\.(?:png|jpe?g|svg|webp|gif|avif))"/g;
  for (const [file, text] of Object.entries(src.data)) {
    for (const m of text.matchAll(DATA_IMG)) {
      if (!exists(`images/${m[1]}`)) out.push({ kind: "image", file, line: lineOf(text, m.index), key: `image: images/${m[1]}` });
    }
  }
  return out;
}

/**
 * Every violation, less the allowlist's. Each entry allows one occurrence of its file and key, so a second copy of an
 * allowed literal is a new violation. Returns { violations, allowed, stale } (stale: an entry with nothing left to allow).
 */
export function designCheck(src = sources(), allowlist = JSON.parse(read("data/design-allowlist.json"))) {
  const all = [...literalViolations(src), ...classViolations(src), ...varViolations(src), ...imageViolations(src)];
  const room = new Map();
  for (const e of allowlist.entries || []) room.set(`${e.file}|${e.key}`, (room.get(`${e.file}|${e.key}`) || 0) + 1);
  const violations = [];
  const allowed = [];
  for (const v of all) {
    const k = `${v.file}|${v.key}`;
    if (room.get(k) > 0) { room.set(k, room.get(k) - 1); allowed.push(v); } else violations.push(v);
  }
  const stale = [];
  for (const e of allowlist.entries || []) {
    const k = `${e.file}|${e.key}`;
    if (room.get(k) > 0) { room.set(k, room.get(k) - 1); stale.push(e); }
  }
  return { violations, allowed, stale };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { violations, allowed, stale } = designCheck();
  for (const v of violations) console.log(`${v.file}:${v.line}  ${v.kind}  ${v.key}`);
  for (const s of stale) console.log(`data/design-allowlist.json  stale  ${s.file} ${s.key} (fixed: npm run design:prune takes it off)`);
  console.log(`[design-check] ${violations.length} violation(s), ${stale.length} stale allowlist entr${stale.length === 1 ? "y" : "ies"}, ${allowed.length} allowlisted.`);
  process.exit(violations.length || stale.length ? 1 : 0);
}
