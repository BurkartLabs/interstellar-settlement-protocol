import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { REDUCED_MOTION_QUERY, prefersReducedMotion, scrollBehavior } from "../../public/scripts/motion.js";

// AB#1760 (ISP-291): one focus-ring token used by every interactive element, and a prefers-reduced-motion block that
// stops every animation and transition. Before this story (Critique AB#1757, measured at a271151): 4 focus-visible
// rules, 0 reduced-motion rules, 13 @keyframes, 32 transitions. This reads styles.css as data; what it looks like is
// e2e/focus-and-motion.spec.js, with screenshots.
const RAW = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule as { selectors, body, media }, where media is the enclosing @media prelude or "". */
function rules(css) {
  const out = [];
  const stack = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    const close = css.indexOf("}", i);
    if (close >= 0 && (open < 0 || close < open)) { stack.pop(); i = close + 1; continue; }
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    if (/^@(media|supports|layer|container)\b/.test(prelude)) { stack.push(prelude); i = open + 1; continue; }
    if (/^@(-webkit-)?keyframes\b/.test(prelude)) {
      // Skip the whole keyframes block: its percentages are not selectors.
      let depth = 1;
      let j = open + 1;
      while (depth > 0 && j < css.length) { if (css[j] === "{") depth++; if (css[j] === "}") depth--; j++; }
      i = j;
      continue;
    }
    const end = css.indexOf("}", open);
    out.push({ selectors: prelude.split(",").map((s) => s.trim().replace(/\s+/g, " ")), body: css.slice(open + 1, end), media: stack.at(-1) || "" });
    i = end + 1;
  }
  return out;
}
const RULES = rules(CSS);
const decls = (body) => body.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
  const at = d.indexOf(":");
  return { prop: d.slice(0, at).trim(), value: d.slice(at + 1).trim() };
});

describe("the focus ring (AB#1760)", () => {
  it("parses the stylesheet: it sees the .btn base rule and the 13 keyframes", () => {
    expect(RULES.some((r) => r.selectors.includes(".btn"))).toBe(true);
    expect((CSS.match(/@keyframes\s/g) || []).length).toBeGreaterThanOrEqual(13);
  });

  it("defines --focus-ring once, on :root", () => {
    const defs = RULES.filter((r) => decls(r.body).some((d) => d.prop === "--focus-ring"));
    expect(defs.map((r) => r.selectors)).toEqual([[":root"]]);
  });

  // Every element that can take keyboard focus, not a list of tags: Chromium makes a scrolling table a tab stop of its
  // own, and a list of button, a, input... left the Exchange's trade table with no ring (found by the e2e walk).
  it("draws it with one rule for everything focusable: :focus-visible, unqualified", () => {
    const ring = RULES.filter((r) => r.media === "" && decls(r.body).some((d) => d.prop === "outline" && d.value === "var(--focus-ring)"));
    // .is-focus is the same ring drawn standing still, for the style guide's specimens (ISP-72): the same one rule.
    expect(ring.map((r) => r.selectors)).toEqual([[":focus-visible", ".is-focus"]]);
    expect(decls(ring[0].body)).toContainEqual({ prop: "outline-offset", value: "var(--focus-ring-offset)" });
  });

  // `transition: all` animates the outline too, so the ring faded in from the browser's own 3px ring in the text colour
  // (the login page's buttons, found by the e2e walk, which reads the outline the moment focus lands).
  it("no transition covers `all`, which would animate the ring in instead of drawing it", () => {
    const all = RULES.flatMap((r) => decls(r.body).filter((d) => /^transition(-property)?$/.test(d.prop) && /(^|,|\s)all(\s|,|$)/.test(d.value))
      .map((d) => `${r.selectors.join(", ")} { ${d.prop}: ${d.value} }`));
    expect(all).toEqual([]);
  });

  it("no rule for a focused element sets its own outline or turns the ring off", () => {
    const focusRules = RULES.filter((r) => r.selectors.some((s) => /:focus(-visible|-within)?\b/.test(s)));
    expect(focusRules.length).toBeGreaterThan(3);
    const own = focusRules.flatMap((r) => decls(r.body).filter((d) => /^outline(-style|-width|-color)?$/.test(d.prop) && d.value !== "var(--focus-ring)")
      .map((d) => `${r.selectors.join(", ")} { ${d.prop}: ${d.value} }`));
    expect(own).toEqual([]);
  });
});

describe("reduced motion (AB#1760)", () => {
  const block = RULES.filter((r) => /prefers-reduced-motion:\s*reduce/.test(r.media));

  it("has a prefers-reduced-motion block for everything, pseudo-elements included", () => {
    const all = block.find((r) => r.selectors.includes("*"));
    expect(all).toBeDefined();
    expect(all.selectors).toEqual(expect.arrayContaining(["*", "*::before", "*::after"]));
    const d = Object.fromEntries(decls(all.body).map(({ prop, value }) => [prop, value]));
    for (const prop of ["animation-duration", "animation-iteration-count", "animation-delay", "transition-duration", "transition-delay", "scroll-behavior"]) {
      expect(d[prop], prop).toMatch(/!important$/);
    }
    expect(parseFloat(d["animation-duration"])).toBeLessThan(1);
    expect(parseFloat(d["transition-duration"])).toBeLessThan(1);
  });

  it("covers every animation and transition rule: none of them is !important, so none can win over the block", () => {
    const moving = RULES.filter((r) => !/prefers-reduced-motion/.test(r.media))
      .flatMap((r) => decls(r.body).filter((d) => /^(animation|transition)(-|$)/.test(d.prop)).map((d) => ({ ...d, where: r.selectors.join(", ") })));
    expect(moving.filter((d) => /^animation/.test(d.prop)).length).toBeGreaterThan(10);
    // A floor, so the check cannot pass by matching nothing. It was the 32 counted before AB#1760; screen rebuilds take
    // old rules out with their screens (ISP-78, AB#767, and ISP-79, AB#768, took two each), so it is not a count to keep.
    expect(moving.filter((d) => /^transition/.test(d.prop)).length).toBeGreaterThanOrEqual(25);
    expect(moving.filter((d) => /!important/.test(d.value)).map((d) => `${d.where} { ${d.prop} }`)).toEqual([]);
  });

  it("no script sets an !important animation or transition inline, which would beat the block", () => {
    const dir = new URL("../../public/scripts/", import.meta.url);
    const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".js"));
    expect(files.length).toBeGreaterThan(10);
    const hits = files.filter((f) => /(animation|transition)[^;"'`]*!important/.test(readFileSync(new URL(String(f).replace(/\\/g, "/"), dir), "utf8")));
    expect(hits).toEqual([]);
  });
});

describe("motion.js: the reduced-motion answer for script-driven motion (AB#1760)", () => {
  const win = (matches) => ({ matchMedia: (q) => ({ matches: q === REDUCED_MOTION_QUERY && matches }) });

  it("asks the same query the stylesheet's block uses", () => {
    expect(RAW).toContain(`@media ${REDUCED_MOTION_QUERY}`);
  });

  it("says reduce only when the system asks for it", () => {
    expect(prefersReducedMotion(win(true))).toBe(true);
    expect(prefersReducedMotion(win(false))).toBe(false);
    expect(scrollBehavior(win(true))).toBe("auto");
    expect(scrollBehavior(win(false))).toBe("smooth");
  });

  it("assumes full motion where there is no matchMedia, or it throws", () => {
    expect(prefersReducedMotion({})).toBe(false);
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(prefersReducedMotion({ matchMedia: () => { throw new Error("no"); } })).toBe(false);
  });

  it("the typewriter, the starfield and both scripted scrolls ask it, and no smooth scroll is left hard-coded", () => {
    const read = (p) => readFileSync(new URL(`../../public/scripts/${p}`, import.meta.url), "utf8");
    expect(read("dialogue.js")).toMatch(/prefersReducedMotion\(\)/);
    expect(read("starfield.js")).toMatch(/prefersReducedMotion\(\)/);
    const dir = new URL("../../public/scripts/", import.meta.url);
    const smooth = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".js"))
      .filter((f) => /behavior:\s*["']smooth["']/.test(readFileSync(new URL(String(f).replace(/\\/g, "/"), dir), "utf8")));
    expect(smooth).toEqual([]);
  });

  it("the starfield loads as a module on every page that has it, so it can import motion.js", () => {
    for (const page of ["index.html", "login.html", "register.html"]) {
      const html = readFileSync(new URL(`../../public/${page}`, import.meta.url), "utf8");
      expect(html, page).toContain('<script type="module" src="scripts/starfield.js"></script>');
    }
  });
});
