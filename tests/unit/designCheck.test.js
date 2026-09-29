import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { classViolations, designCheck, imageViolations, literalViolations, sources, varViolations } from "../../scripts/design-check.mjs";

// ISP-246 (AB#942): the design-system check (scripts/design-check.mjs). It passes on the repository with its allowlist,
// and each of its four kinds fails on a seeded violation: a literal outside the token block, a class no rule styles, an
// undefined var(), a missing image. The allowlist only shrinks: an entry with nothing left to allow fails as stale.
const ALLOW = JSON.parse(fs.readFileSync(new URL("../../data/design-allowlist.json", import.meta.url), "utf8"));
const STORIES = ["ISP-250 (AB#946)", "ISP-251 (AB#947)", "ISP-252 (AB#948)"];

/** The repository's sources with `extra` added to one file of each kind. */
function seeded({ css = "", html = "", js = "" }) {
  const src = sources();
  src.css["public/styles.css"] += `\n${css}`;
  src.html["public/index.html"] += `\n${html}`;
  src.js["public/scripts/app.js"] += `\n${js}`;
  return src;
}
const keys = (list) => list.map((v) => `${v.kind} ${v.key}`);

describe("the design-system check passes on the repository (ISP-246, AB#942)", () => {
  it("no violation outside the allowlist, and no stale entry", () => {
    const { violations, stale, allowed } = designCheck();
    expect(violations.map((v) => `${v.file}:${v.line} ${v.key}`)).toEqual([]);
    expect(stale).toEqual([]);
    expect(allowed.length).toBe(ALLOW.entries.length);
  });

  it("every allowlisted violation names the v1.0 story that removes it", () => {
    for (const e of ALLOW.entries) expect(STORIES, `${e.file} ${e.key}`).toContain(e.story);
  });
});

describe("each kind fails on a seeded violation (ISP-246, AB#942)", () => {
  it("literal: a colour, a font size, a spacing, a radius and a z-index written as values", () => {
    const src = seeded({ css: ".seeded { color: #ff0066; font-size: 13px; margin: 0.7rem; border-radius: 5px; z-index: 40; }" });
    // What the seed added: the seeded run's literals less the repository's own (a multiset difference).
    const before = keys(literalViolations(sources()));
    const found = keys(literalViolations(src)).filter((k) => { const i = before.indexOf(k); if (i < 0) return true; before.splice(i, 1); return false; });
    expect(found).toEqual(["literal colour: #ff0066", "literal font size: font-size: 13px", "literal spacing: margin: 0.7rem", "literal radius: border-radius: 5px", "literal z-index: z-index: 40"]);
    expect(designCheck(src).violations.map((v) => v.key)).toEqual(["colour: #ff0066", "font size: font-size: 13px", "spacing: margin: 0.7rem", "radius: border-radius: 5px", "z-index: z-index: 40"]);
  });

  it("class: a class used in the HTML or the JavaScript that no rule styles", () => {
    const src = seeded({ html: '<div class="ui-panel seeded-unstyled-block"></div>', js: 'el.classList.add("seeded-unstyled-hook");' });
    expect(keys(classViolations(src)).filter((k) => k.includes("seeded"))).toEqual(["class class: seeded-unstyled-block", "class class: seeded-unstyled-hook"]);
    expect(designCheck(src).violations.map((v) => v.key)).toEqual(["class: seeded-unstyled-block", "class: seeded-unstyled-hook"]);
  });

  it("var: a var(--x) nothing defines", () => {
    const src = seeded({ css: ".ui-panel { gap: var(--space-seeded); }" });
    expect(keys(varViolations(src)).filter((k) => k.includes("seeded"))).toEqual(["var var: --space-seeded"]);
    expect(designCheck(src).violations.map((v) => v.key)).toEqual(["var: --space-seeded"]);
  });

  it("image: a path that is not a file under public/", () => {
    const src = seeded({ html: '<img src="/images/seeded-missing.png" alt="">' });
    expect(keys(imageViolations(src)).filter((k) => k.includes("seeded"))).toEqual(["image image: /images/seeded-missing.png"]);
    expect(designCheck(src).violations.map((v) => v.key)).toEqual(["image: /images/seeded-missing.png"]);
  });

  it("image: a data file's image named relative to public/images/ that is not there (AB#949)", () => {
    const src = sources();
    src.data["data/buildings.json"] += '\n{ "imageFile": "buildings/seeded-missing.png" }';
    expect(keys(imageViolations(src)).filter((k) => k.includes("seeded"))).toEqual(["image image: images/buildings/seeded-missing.png"]);
    expect(designCheck(src).violations.map((v) => v.key)).toEqual(["image: images/buildings/seeded-missing.png"]);
    const present = sources();
    present.data["data/buildings.json"] += '\n{ "imageFile": "planets/earth.jpg" }';
    expect(designCheck(present).violations).toEqual([]);
  });

  it("an allowlisted literal written a second time is a new violation, and a fixed one leaves a stale entry", () => {
    const [entry] = ALLOW.entries.filter((e) => e.key.startsWith("spacing:") && e.file === "public/styles.css");
    const twice = seeded({ css: `.ui-panel { ${entry.key.replace(/^spacing: /, "")}; }` });
    expect(designCheck(twice).violations.map((v) => v.key)).toEqual([entry.key]);
    const fixedOne = { ...ALLOW, entries: [...ALLOW.entries, { file: "public/styles.css", key: "radius: border-radius: 3px", story: STORIES[0] }] };
    expect(designCheck(sources(), fixedOne).stale.map((e) => e.key)).toEqual(["radius: border-radius: 3px"]);
  });
});
