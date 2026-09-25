import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { literalsOutside, measureStylesheet, readTokens, resolve, splitStylesheet } from "../../scripts/design-tokens.mjs";
import { contrast, FILLS, SURFACES, TEXTS } from "../../public/scripts/tokenContrast.js";

// ISP-70 (AB#759): the design tokens of the flat direction (Decision AB#1801). The block at the top of styles.css is
// the one place colours, type, spacing, radii, elevation, motion and layers are defined; every text colour meets WCAG
// AA on every surface; every fill meets it under the text set on it; and the literals still written outside the block
// can only become fewer (ISP-71, AB#760, replaces them). The measuring is scripts/design-tokens.mjs, which prints the
// same table for a pull request.
const PUBLIC = fileURLToPath(new URL("../../public", import.meta.url));
const tokens = readTokens();
const value = (name) => resolve(tokens, name);

/**
 * The literals outside the block when it landed. A change that adds one fails here; one that removes some should lower
 * the number, so the floor keeps falling. New CSS is written in tokens.
 */
const LITERALS_WHEN_THE_BLOCK_LANDED = { colours: 592, fontSizes: 227, spacing: 506, customProperties: 0 };

describe("the token block (ISP-70)", () => {
  it("defines every colour the direction names, carrying the mockup's values as they are", () => {
    expect(Object.fromEntries(["--bg", "--surface-1", "--surface-2", "--surface-3", "--text", "--muted", "--accent", "--on-accent", "--warn"].map((n) => [n, value(n)]))).toEqual({
      "--bg": "#05070a",
      "--surface-1": "#171e27",
      "--surface-2": "#232e39",
      "--surface-3": "#374553",
      "--text": "#eef3f7",
      "--muted": "#aebdc9",
      "--accent": "#4fd8e8",
      "--on-accent": "#03181b",
      "--warn": "#e8a34f"
    });
    for (const name of [...SURFACES, ...TEXTS, ...FILLS.flatMap((f) => [f.on, ...f.fills]), "--border", "--surface-hover", "--surface-pressed", "--scrim-hero", "--scrim-modal"]) {
      expect(tokens.has(name), name).toBe(true);
    }
  });

  it("a six-step type scale, rising, in one body face: Inter", () => {
    const sizes = [1, 2, 3, 4, 5, 6].map((i) => parseFloat(value(`--font-size-${i}`)));
    expect(sizes.every((s, i) => i === 0 || s > sizes[i - 1]), sizes.join(", ")).toBe(true);
    expect(value("--font-sans").startsWith('"Inter"')).toBe(true);
    expect(value("--font-wordmark")).toBe(value("--font-sans"));
  });

  it("spacing on a 4px grid, and radii, elevation, motion and layers defined", () => {
    for (const [name, raw] of tokens) {
      const step = /^--space-(\d+)$/.exec(name);
      if (step) expect(raw, name).toBe(`${Number(step[1]) * 4}px`);
    }
    for (const name of ["--radius-sm", "--radius-md", "--radius-lg", "--radius-pill", "--elevation-overlay", "--duration-fast", "--duration-base", "--duration-slow", "--ease-standard", "--ease-out", "--ease-in"]) {
      expect(tokens.has(name), name).toBe(true);
    }
    const layers = ["base", "raised", "sticky", "dropdown", "overlay", "modal", "toast", "tooltip"].map((l) => Number(value(`--z-${l}`)));
    expect(layers.every((z, i) => i === 0 || z > layers[i - 1]), layers.join(", ")).toBe(true);
  });

  it("motion stops under prefers-reduced-motion", () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*{\s*:root\s*{([^}]*)}/.exec(splitStylesheet().block);
    expect(reduced?.[1]).toMatch(/--duration-fast:\s*0ms/);
    expect(reduced?.[1]).toMatch(/--duration-base:\s*0ms/);
    expect(reduced?.[1]).toMatch(/--duration-slow:\s*0ms/);
  });
});

describe("contrast, WCAG 2.1 (ISP-70)", () => {
  it("the formula gives the published ratios: black on white is 21:1, and the same colour is 1:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBe(1);
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2); // the lightest grey AA allows on white
  });

  it("every text colour on every surface, every fill under its text, and every surface step, pass", () => {
    const rows = measureStylesheet(tokens);
    expect(rows).toHaveLength(TEXTS.length * SURFACES.length + FILLS.length * 3 + SURFACES.length - 1);
    const failing = rows.filter((r) => r.ratio < r.min).map((r) => `${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)}:1, needs ${r.min}:1`);
    expect(failing).toEqual([]);
  });
});

describe("new CSS is written in tokens (ISP-70)", () => {
  it("no custom property is defined outside the block, and the literals outside it are no more than when it landed", () => {
    const now = literalsOutside();
    expect(now.customProperties).toBe(0);
    for (const kind of ["colours", "fontSizes", "spacing"]) {
      expect(now[kind], `${kind}: new CSS uses the tokens at the top of styles.css, not a literal value`).toBeLessThanOrEqual(LITERALS_WHEN_THE_BLOCK_LANDED[kind]);
    }
  });

  it("the counter sees literals: a colour, a font size and a padding added outside the block are each counted", () => {
    const { outside } = splitStylesheet();
    const before = literalsOutside(outside);
    const after = literalsOutside(`${outside}\n.x { color: #123456; font-size: 14px; padding: 6px 8px; margin: 0; gap: var(--space-2); }`);
    expect(after).toEqual({ ...before, colours: before.colours + 1, fontSizes: before.fontSizes + 1, spacing: before.spacing + 1 });
  });
});

describe("the fonts (ISP-70)", () => {
  const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));

  it("no page imports Orbitron or Rajdhani, and the stylesheet sets neither", () => {
    const pages = files(PUBLIC).filter((f) => f.endsWith(".html"));
    expect(pages.length).toBeGreaterThan(3);
    for (const page of pages) expect(readFileSync(page, "utf8"), page).not.toMatch(/Orbitron|Rajdhani/);
    const declarations = [...splitStylesheet().outside.matchAll(/font-family\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(declarations.length).toBeGreaterThan(10);
    expect(declarations.filter((d) => !/^(var\(--font-(sans|mono|wordmark)\)|inherit)$/.test(d))).toEqual([]);
  });
});
