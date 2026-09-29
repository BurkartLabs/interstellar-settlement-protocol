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
  // ISP-81 (AB#770): the "Premium Thread Detail View" comment in styles.css went with the forum's old CSS.
  // AB#738: toCurrency moved, unchanged, from app.js to the shared helpers module. AB#2314: it writes the credits
  // sign now, with no currency style at all; the one NumberFormat it keeps only groups digits.
  [
    "public/scripts/helpers.js",
    'const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });',
    "toCurrency: the sanctioned in-game credits formatter this story's own acceptance names as the one exception"
  ],
  [
    "server/settlement.js",
    '"loan-disbursal", "loan-repayment", "bond-subscription", "coupon", "dividend", "share-purchase", "escrow-hold", "escrow-release", "fee",',
    "a bond subscription: buying into an in-game corporate bond with credits (docs/design/v0.9-equity.md, v0.9-debt.md), not a recurring real-money payment (Bug #2570)"
  ],
  [
    "server/finances.js",
    '"loan-disbursal-received", "loan-repayment-received", "bond-subscription-received", "coupon-received", "dividend-received",',
    "a bond subscription: buying into an in-game corporate bond with credits (docs/design/v0.9-equity.md, v0.9-debt.md), not a recurring real-money payment (Bug #2570)"
  ],
  [
    "server/finances.js",
    '"loan-disbursal-paid", "loan-repayment-paid", "bond-subscription-paid", "coupon-paid", "dividend-paid", "share-purchase-paid",',
    "a bond subscription: buying into an in-game corporate bond with credits (docs/design/v0.9-equity.md, v0.9-debt.md), not a recurring real-money payment (Bug #2570)"
  ],
  // Bug #2575: the statements name the in-game bond purchase as financing, kept out of the P&L
  [
    "server/finances.js",
    '"bond-subscription-received", "bond-subscription-paid", "bond-redemption-received", "bond-redemption-paid",',
    "an in-game bond bought at issue with credits, listed as financing so it is not counted as profit (Bug #2575)"
  ],
  // ISP-154 (AB#848): the bond module names the reason once, and settlement says which parties it moves between
  [
    "server/bonds.js",
    'const REASON = "bond-subscription";',
    "the settlement reason for buying an in-game bond at issue, with credits (docs/design/v0.9-debt.md, section 7)"
  ],
  [
    "server/settlement.js",
    '"bond-subscription": [["corp", "corp"], ["tap", "corp"]],',
    "which parties an in-game bond purchase moves credits between: a corporation, or the NPC underwriter's tap (AB#848)"
  ]
];

function scanFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    // AB#964: public/vendor holds third-party files as published (minified Chart.js, the Inter font), not game code
    if (entry.isDirectory() && path.relative(ROOT, path.join(dir, entry.name)).replace(/\\/g, "/") === "public/vendor") continue;
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

  // AB#2250: the allowlist used to name a line number, and every story that added lines above one failed here. These
  // edit the file of the allowlist's first entry in memory (the stylesheet's until ISP-81 removed its line, AB#770).
  const [TARGET, ALLOWED_LINE] = ALLOWLIST[0];
  const withTarget = (edit) => findMatches((file, rel) => (rel === TARGET ? edit(fs.readFileSync(file, "utf8")) : fs.readFileSync(file, "utf8")));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

  it("still passes when lines are added above an allowed line", () => {
    const { violations, stale } = checkAllowlist(withTarget((text) => `// one\nconst a = 1;\n\n${text}`));
    expect(violations).toEqual([]);
    expect(stale).toEqual([]);
  });

  it("fails when an allowed line's text changes, as a violation and as a stale entry", () => {
    const changed = `${ALLOWED_LINE} // edited`;
    const { violations, stale } = checkAllowlist(withTarget((text) => text.replace(ALLOWED_LINE, changed)));
    expect(violations).toEqual([expect.stringMatching(new RegExp(`^${esc(TARGET)}:\\d+: .*// edited`))]);
    expect(stale).toEqual([expect.stringMatching(new RegExp(`^${esc(TARGET)}: `))]);
  });

  it("fails on a new forbidden term, even one added right beside an allowed line", () => {
    const { violations } = checkAllowlist(withTarget((text) => text.replace(ALLOWED_LINE, `${ALLOWED_LINE}\n// a premium badge`)));
    expect(violations).toEqual([expect.stringMatching(/a premium badge/)]);
  });

  it("scans a real, non-trivial number of files, so a vacuous pass isn't mistaken for a clean one", () => {
    const files = SCAN_DIRS.flatMap((dir) => scanFiles(path.join(ROOT, dir)));
    expect(files.length).toBeGreaterThan(50);
  });
});

// ISP-163 (AB#857): BRIEF.md's never-sell list names v0.9's financial instruments. Their numbers live in data files,
// which the scan above does not read (it reads code). A price or a currency in one of them is the first line of a shop
// that sells a rate, a limit, a fill or a share: this fails on it. In-game credit amounts ("cost", "fee", "charterFee")
// are not real money and are not matched.
const INSTRUMENT_DATA = ["data/loan-products.json", "data/bond-terms.json", "data/share-terms.json", "data/credit-rating.json", "data/conglomerates.json",
  "data/units.json"]; // ISP-182 (AB#876): the military never-sell list's data
const MONEY_KEY = /price|currency|usd|eur|gbp|sku|iap|real.?money|store|paypal|stripe/i;
/** Keys that name an in-game price in credits, never real money, each with why. */
const IN_GAME_PRICE_KEYS = new Map([["stakeGoodsPriceBasis", "which exchange price values a departing member's goods in credits (AB#889)"]]);
const MONEY_VALUE = /[$€£]\s*\d|\b\d+(\.\d+)?\s*(USD|EUR|GBP)\b|^(USD|EUR|GBP)$/;

/** Every real-money field in a parsed data file: a key that names money, or a string value that is an amount of it. */
function realMoneyFields(value, where = "") {
  if (Array.isArray(value)) return value.flatMap((v, i) => realMoneyFields(v, `${where}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(MONEY_KEY.test(k) && !IN_GAME_PRICE_KEYS.has(k) ? [`${where}.${k}`] : []),
      ...realMoneyFields(v, `${where}.${k}`)
    ]);
  }
  return typeof value === "string" && MONEY_VALUE.test(value) && !where.endsWith("._source") && !where.endsWith("._comment") ? [where] : [];
}

describe("the never-sell list's data carries no price (ISP-163, AB#857)", () => {
  const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

  it("no financial instrument's data file has a price or currency field", () => {
    for (const file of INSTRUMENT_DATA) expect(realMoneyFields(read(file)), file).toEqual([]);
  });

  it("a price or currency added to data/loan-products.json fails it", () => {
    const seeded = (edit) => { const d = read("data/loan-products.json"); edit(d); return realMoneyFields(d); };
    expect(seeded((d) => { d.products[0].price = 4.99; })).toEqual([".products[0].price"]);
    expect(seeded((d) => { d.currency = "USD"; })).toEqual([".currency", ".currency"]);
    expect(seeded((d) => { d.products[0].priceUsd = 2; d.products[1].sku = "loan-boost"; })).toEqual([".products[0].priceUsd", ".products[1].sku"]);
    expect(seeded((d) => { d.products[2].rateBoost = "$4.99"; })).toEqual([".products[2].rateBoost"]);
  });

  it("a price, a currency or a store id added to data/units.json fails it (ISP-182, AB#876)", () => {
    const seeded = (edit) => { const d = read("data/units.json"); edit(d); return realMoneyFields(d); };
    const [ship] = read("data/units.json").units;
    expect(ship).toBeTruthy();
    expect(seeded((d) => { d.units[0].price = 0.99; })).toEqual([".units[0].price"]);
    expect(seeded((d) => { d.units[0].skipBuildTime = "$1.99"; })).toEqual([".units[0].skipBuildTime"]);
    expect(seeded((d) => { d.units[1].storeSku = "fleet-pack"; })).toEqual([".units[1].storeSku"]);
    expect(seeded((d) => { d.currency = "EUR"; })).toEqual([".currency", ".currency"]);
    expect(seeded(() => {})).toEqual([]); // the catalog's own credits, goods and build minutes are in-game
  });

  it("leaves in-game credit amounts alone", () => {
    expect(realMoneyFields({ cost: 5_000, charterFee: 25_000, feePct: 2, originationPct: 2.5, productId: "dsdb-7" })).toEqual([]);
  });
});
