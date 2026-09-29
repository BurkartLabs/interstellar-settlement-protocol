import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { cssRules, ruleKey, writeRules } from "../../scripts/cssRules.mjs";

// Bug #4839: the landing blocks its first paint only on public/landing.css, the rules it uses extracted from
// styles.css by scripts/landing-css.mjs. The extract must never become a second source: every rule in it is in
// styles.css as written, so a change to styles.css that it misses fails here until `npm run css:landing` is run.
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const STYLES = read("public/styles.css");
const LANDING = read("public/landing.css");
const INDEX = read("public/index.html");

describe("landing.css, the landing's first-paint stylesheet (Bug #4839)", () => {
  it("is an extract: every rule is in styles.css as written, in the same order", () => {
    const source = cssRules(STYLES).map(ruleKey);
    const extract = cssRules(LANDING).map(ruleKey);
    expect(extract.length).toBeGreaterThan(20);
    expect(extract.filter((k) => !source.includes(k)), "rules not in styles.css: run npm run css:landing").toEqual([]);
    const at = extract.map((k) => source.indexOf(k));
    expect(at).toEqual([...at].sort((a, b) => a - b)); // source order, so the cascade is the same
  });

  it("carries the design tokens and the fonts, and stays small", () => {
    const rules = cssRules(LANDING);
    expect(rules.some((r) => r.prelude === ":root" && r.context.length === 0)).toBe(true);
    expect(rules.filter((r) => r.prelude.startsWith("@font-face")).length).toBe(cssRules(STYLES).filter((r) => r.prelude.startsWith("@font-face")).length);
    expect(LANDING.length).toBeLessThan(STYLES.length / 8);
  });

  it("is the only stylesheet the landing blocks on; styles.css is preloaded and attached by a module", () => {
    const blocking = [...INDEX.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
    expect(blocking).toEqual(['<link rel="stylesheet" href="landing.css" />']);
    expect(INDEX).toContain('<link rel="preload" href="styles.css" as="style" />');
    expect(INDEX).toMatch(/<script type="module" src="scripts\/appStyles\.js" async><\/script>/);
  });

  it("the game waits for the whole stylesheet before it opens", () => {
    const app = read("public/scripts/app.js");
    expect(app).toMatch(/import \{ appStylesReady \} from "\.\/appStyles\.js"/);
    expect(app).toMatch(/await Promise\.all\(\[[^\]]*appStylesReady\]\)/);
  });

  it("the parser reads styles.css whole: every rule, and back again unchanged", () => {
    const rules = cssRules(STYLES);
    expect(rules.length).toBeGreaterThan(1000);
    expect(rules.every((r) => !/[{}]/.test(r.prelude))).toBe(true);
    expect(cssRules(writeRules(rules)).map(ruleKey)).toEqual(rules.map(ruleKey));
  });
});
