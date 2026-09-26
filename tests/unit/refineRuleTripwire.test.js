import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULE_GAP_OPEN } from "../probes/chainProbe.js";

// AB#2372, the tripwire of tier3-recipes.md section 6 (the Director's ruling on AB#2367): the design's rule for when to
// refine is up to 10.7% worse than plain "refine to the end" at low volume, so while that gap is open it is not shown
// to a player in any form: a hint, an advisor, a recommendation. This fails the day a player-facing file names the
// rule, loads the probe's implementation of it, or advises refining against selling raw, before the gap is closed.
// RULE_GAP_OPEN is set false only when the full chain probe shows the rule within 5% everywhere (chain-probe.test.js).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Everything a player is served: the page and its scripts, and the routes' own text. */
function playerFacingFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|mjs|html)$/.test(e.name)) out.push(rel);
    }
  };
  walk("public");
  walk("server/routes");
  return out;
}

/** What counts as showing the rule: its name, the probe's code, or advice to refine rather than sell (or back). */
const RULE_SIGNS = [
  [/design['’]?s rule/i, "names the design's rule"],
  [/chainProbe|tests\/probes/, "loads the chain probe's implementation of the rule"],
  [/\b(?:should|recommend(?:ed|s)?|advise[sd]?|better to|best to)\s+(?:you\s+)?(?:refine|sell(?:ing)?\s+(?:it\s+)?raw)\b/i, "advises refining or selling raw"],
  [/\brefin(?:e|ing)\b[^.\n]{0,40}\b(?:pays more|is worth more|beats selling|better than selling)\b/i, "says refining pays better"],
  [/\bsell(?:ing)?\s+(?:it\s+)?raw\b[^.\n]{0,40}\b(?:instead|pays more|is worth more|beats refining|better than refining)\b/i, "says selling raw pays better"],
];
const signsIn = (text) => RULE_SIGNS.filter(([re]) => re.test(text)).map(([, why]) => why);

describe("the refine-or-sell rule is not shown to a player while its gap is open (AB#2372)", () => {
  it("recognises the rule and its advice in any wording it takes, and not ordinary refinery text", () => {
    for (const text of [
      "Following the design's rule, refine this batch.",
      "import { playWeek } from '../../tests/probes/chainProbe.js';",
      "We recommend you refine your Bauxite now.",
      "You should sell raw today: the product bid is low.",
      "Refining pays more than the ore right now.",
      "Selling it raw instead is worth more this week."
    ]) expect(signsIn(text), text).not.toEqual([]);
    for (const text of [
      "Refinery Chains: 200 Bauxite per batch → 50 Aluminium Ingots",
      "Sell to Standing Buy Order",
      "Start a refining run with the inputs at this station.",
      "Raw items sell to the standing bids."
    ]) expect(signsIn(text), text).toEqual([]);
  });

  it("no player-facing file shows it while RULE_GAP_OPEN (chainProbe.js)", () => {
    const files = playerFacingFiles();
    expect(files.length).toBeGreaterThan(50);
    const found = files.flatMap((rel) => signsIn(fs.readFileSync(path.join(ROOT, rel), "utf8")).map((why) => `${rel}: ${why}`));
    if (RULE_GAP_OPEN) expect(found, "the rule reached a player before its low-volume gap closed (tier3-recipes.md section 6)").toEqual([]);
  });
});
