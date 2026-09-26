// ISP-89 (AB#779, Monetization Critique #434 epic 3). BRIEF.md says payment is "None yet, and none before 1.0" —
// nothing enforced that promise until this test. P-WIRED-NOTHING: a promise in prose is kept by nothing; a red
// test is a reader.
//
// Scans every .js, .html and .css file under server/ and public/ for payment and pricing vocabulary. A match is
// either a violation (fails the test) or an entry in ALLOWLIST, keyed by its file and the exact text of the line,
// with the reason it is not what it looks like — each one checked by hand when it was added, not assumed safe
// because it is old. AB#2250: keyed by text, not line number, so CSS added above an allowed line no longer breaks
// the test; editing or removing the allowed line still does.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCAN_DIRS = ["server", "public"];
const SCAN_EXT = new Set([".js", ".html", ".css"]);

// Each pattern supplies its own boundary rather than one blanket \b-wrapped alternation, since "in-app" and
// "loot box" need to match their own punctuation and space, not a word character.
const FORBIDDEN_TERMS = [
  /\bstripe\b/i,
  /\bpaypal\b/i,
  /\bpaddle\b/i,
  /\bcheckout\b/i,
  /\biap\b/i,
  /\bin-app\b/i,
  /\bsubscription\b/i,
  /\bloot box\b/i,
  /\bgacha\b/i,
  /\bpremium\b/i,
  // Real-money currency formatting: a second Intl.NumberFormat (or another library's equivalent) anywhere but
  // the one sanctioned credits formatter below is exactly the shape a real payment UI's price display takes.
  /Intl\.NumberFormat/
];

/** [file, the allowed line's text as written (trimmed), why it is not payment code]. */
const ALLOWLIST = [
  // AB#1051: the "premium-rate" flavour text this list once named moved to data/missions.json, which this scanner
  // does not read (SCAN_EXT is .js/.html/.css only), so its entry is gone rather than re-pointed.
  [
    "public/styles.css",
    "/* ─── Premium Thread Detail View ────────────────────────────────────────── */",
    "a CSS section comment naming a forum-thread layout; no .premium class exists"
  ],
  // AB#738: toCurrency moved, unchanged, from app.js to the shared helpers module.
  [
    "public/scripts/helpers.js",
    'return new Intl.NumberFormat("en-US", {',
    "toCurrency: the sanctioned in-game credits formatter this story's own acceptance names as the one exception"
  ]
];

function scanFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...scanFiles(full));
      continue;
    }
    if (SCAN_EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/** The forbidden-term matches in one file's text, as { file, line, text } with the line trimmed (so CRLF or LF alike). */
function matchesIn(rel, content) {
  const found = [];
  content.split("\n").forEach((raw, i) => {
    if (FORBIDDEN_TERMS.some((re) => re.test(raw))) found.push({ file: rel, line: i + 1, text: raw.trim() });
  });
  return found;
}

/** Every forbidden-term match under SCAN_DIRS. */
function findMatches(read = (file) => fs.readFileSync(file, "utf8")) {
  const found = [];
  for (const dir of SCAN_DIRS) {
    for (const file of scanFiles(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).replaceAll("\\", "/");
      found.push(...matchesIn(rel, read(file, rel)));
    }
  }
  return found;
}

const keyOf = (file, text) => `${file}\n${text}`;

/**
 * AB#2250: a match is allowed when its file and its line's text are on the allowlist, wherever in the file that line
 * now sits. An entry is stale when no match in its file has its text any more: the allowed line was edited or removed.
 */
function checkAllowlist(matches, allowlist = ALLOWLIST) {
  const allowed = new Set(allowlist.map(([file, text]) => keyOf(file, text)));
  const seen = new Set(matches.map((m) => keyOf(m.file, m.text)));
  return {
    violations: matches.filter((m) => !allowed.has(keyOf(m.file, m.text))).map((m) => `${m.file}:${m.line}: ${m.text}`),
    stale: allowlist.filter(([file, text]) => !seen.has(keyOf(file, text))).map(([file, text]) => `${file}: ${text}`)
  };
}

describe('no payment code before 1.0 (ISP-89, BRIEF.md: "None yet, and none before 1.0")', () => {
  it("finds only the allowlisted matches, each still present in the file it names", () => {
    const { violations, stale } = checkAllowlist(findMatches());
    expect(violations, "payment or pricing vocabulary found outside the allowlist").toEqual([]);
    expect(stale, "an allowlist entry whose line is no longer in its file - it was edited or removed; update or remove the entry").toEqual([]);
  });

  // AB#2250: the allowlist used to name a line number, and every stylesheet story that added CSS above it failed here.
  const STYLES = "public/styles.css";
  const withStyles = (edit) => findMatches((file, rel) => (rel === STYLES ? edit(fs.readFileSync(file, "utf8")) : fs.readFileSync(file, "utf8")));

  it("still passes when lines are added above an allowed line", () => {
    const { violations, stale } = checkAllowlist(withStyles((css) => `/* one */\n.a { color: red; }\n\n${css}`));
    expect(violations).toEqual([]);
    expect(stale).toEqual([]);
  });

  it("fails when an allowed line's text changes, as a violation and as a stale entry", () => {
    const { violations, stale } = checkAllowlist(withStyles((css) => css.replace("Premium Thread Detail View", "Premium Thread Detail Views")));
    expect(violations).toEqual([expect.stringMatching(/^public\/styles\.css:\d+: .*Premium Thread Detail Views/)]);
    expect(stale).toEqual([expect.stringMatching(/^public\/styles\.css: .*Premium Thread Detail View /)]);
  });

  it("fails on a new forbidden term, even one added right beside an allowed line", () => {
    const allowedComment = ALLOWLIST.find(([file]) => file === STYLES)[1];
    const { violations } = checkAllowlist(withStyles((css) => css.replace(allowedComment, `${allowedComment}\n.premium-badge { color: gold; }`)));
    expect(violations).toEqual([expect.stringMatching(/\.premium-badge/)]);
  });

  it("scans a real, non-trivial number of files, so a vacuous pass isn't mistaken for a clean one", () => {
    const files = SCAN_DIRS.flatMap((dir) => scanFiles(path.join(ROOT, dir)));
    expect(files.length).toBeGreaterThan(50);
  });
});
