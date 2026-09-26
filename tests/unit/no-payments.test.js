// ISP-89 (AB#779, Monetization Critique #434 epic 3). BRIEF.md says payment is "None yet, and none before 1.0" —
// nothing enforced that promise until this test. P-WIRED-NOTHING: a promise in prose is kept by nothing; a red
// test is a reader.
//
// Scans every .js, .html and .css file under server/ and public/ for payment and pricing vocabulary. A match is
// either a violation (fails the test) or a named, line-numbered entry in ALLOWLIST with the reason it is not
// what it looks like — each one checked by hand when it was added, not assumed safe because it is old.

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

const ALLOWLIST = [
  // AB#1051: the "premium-rate" flavour text this entry named moved to data/missions.json, which this scanner
  // does not read (SCAN_EXT is .js/.html/.css only) — the match left the scanned surface, so the entry is gone
  // rather than re-pointed.
  // AB#1759: line number moved when .btn-hero-secondary was added above it.
  ["public/styles.css", 4363,"a CSS section comment naming a forum-thread layout; no .premium class exists"],
  // AB#738: toCurrency moved, unchanged, from app.js to the shared helpers module.
  ["public/scripts/helpers.js", 6, "toCurrency: the sanctioned in-game credits formatter this story's own acceptance names as the one exception"]
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

/** Every forbidden-term match under SCAN_DIRS, as "path:line" -> the matched line's own text. */
function findMatches() {
  const found = new Map();
  for (const dir of SCAN_DIRS) {
    for (const file of scanFiles(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).replaceAll("\\", "/");
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((text, i) => {
          if (FORBIDDEN_TERMS.some((re) => re.test(text))) found.set(`${rel}:${i + 1}`, text.trim());
        });
    }
  }
  return found;
}

describe('no payment code before 1.0 (ISP-89, BRIEF.md: "None yet, and none before 1.0")', () => {
  it("finds only the allowlisted matches, each still on the line it names", () => {
    const allowed = new Map(ALLOWLIST.map(([file, line, reason]) => [`${file}:${line}`, reason]));
    const matches = findMatches();

    const violations = [...matches.entries()].filter(([key]) => !allowed.has(key)).map(([key, text]) => `${key}: ${text}`);
    expect(violations, "payment or pricing vocabulary found outside the allowlist").toEqual([]);

    const stale = [...allowed.keys()].filter((key) => !matches.has(key));
    expect(stale, "an allowlist entry whose line no longer matches anything — the code moved; update or remove the entry").toEqual([]);
  });

  it("scans a real, non-trivial number of files, so a vacuous pass isn't mistaken for a clean one", () => {
    const files = SCAN_DIRS.flatMap((dir) => scanFiles(path.join(ROOT, dir)));
    expect(files.length).toBeGreaterThan(50);
  });
});
