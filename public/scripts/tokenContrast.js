// ISP-70 (AB#759): which design tokens must be legible on which, and WCAG 2.1's contrast formula. One copy, used by the
// specimen page in the browser (styleguideTokens.js) and by scripts/design-tokens.mjs and its test in Node, so the page
// and the build measure the same pairs the same way.

/** What text may be set on: the page and every surface step. */
export const SURFACES = ["--bg", "--surface-1", "--surface-2", "--surface-3"];

/** Every colour text may be set in: three weights, the accent in its link states, and the status colours. */
export const TEXTS = ["--text", "--text-soft", "--muted", "--accent", "--accent-hover", "--accent-pressed", "--warn", "--danger", "--success"];

/** Each filled control and the text set on it, in its three states. */
export const FILLS = ["accent", "warn", "danger", "success"].map((name) => ({
  on: `--on-${name}`,
  fills: [`--${name}`, `--${name}-hover`, `--${name}-pressed`]
}));

/** WCAG AA for body text. Every text token is held to it, so large text (3:1) is met with room to spare. */
export const AA_TEXT = 4.5;

/** The flat direction's own rule: each surface step at least this over the one below, so depth reads without shadow. */
export const SURFACE_STEP = 1.2;

const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** WCAG 2.1 relative luminance of a #rrggbb colour. */
export function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`${hex} is not a #rrggbb colour`);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(m[1].slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, lighter over darker. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every pair the tokens promise, measured, given a way to read a token's colour. */
export function measure(colour) {
  const rows = [];
  for (const fg of TEXTS) for (const bg of SURFACES) rows.push({ kind: "text", fg, bg, ratio: contrast(colour(fg), colour(bg)), min: AA_TEXT });
  for (const { on, fills } of FILLS) for (const bg of fills) rows.push({ kind: "fill", fg: on, bg, ratio: contrast(colour(on), colour(bg)), min: AA_TEXT });
  for (let i = 1; i < SURFACES.length; i++) {
    rows.push({ kind: "step", fg: SURFACES[i], bg: SURFACES[i - 1], ratio: contrast(colour(SURFACES[i]), colour(SURFACES[i - 1])), min: SURFACE_STEP });
  }
  return rows;
}
