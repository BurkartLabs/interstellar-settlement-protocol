// ISP-71 (AB#760): move public/styles.css off literal values and onto the design tokens (ISP-70, Decision AB#1801, the
// flat direction). Run once; on a stylesheet it has already been through it changes nothing. The rules, by property:
//
//   text-shadow, filter      the direction has no glow: a declaration with a colour in it goes
//   box-shadow               glows go; a ring (no offset, no blur, a spread) keeps its shape in a border token; a
//                            dark shadow on something that covers the page (modal, menu, toast...) is --elevation-overlay
//   color                    by hue: cyan --accent, amber --warn, red --danger, green --success; neutral by lightness
//                            --text, --text-soft or --muted; dark text sits on a fill, so the fill's --on- colour
//   background               gradients flatten: decorative glows and scanlines go, a fill takes its hue's token,
//                            a dark panel its surface; a solid colour: a strong hue is its fill, a faint tint or a
//                            dark shade the nearest surface step, a dark veil over the page --scrim-modal
//   border*                  a faint line is --border; a strong cyan one --accent (a selected state); a strong
//                            status colour keeps it
//   font-size                fixed rem sizes to the six-step scale; fluid clamp() sizes stay
//   padding, margin, gap     a length exactly on the 4px grid becomes its --space token; others stay (no visible change)
//
// Usage: node scripts/tokenize-stylesheet.mjs   (rewrites public/styles.css outside the token block)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { readTokens } from "./design-tokens.mjs";

const FILE = fileURLToPath(new NodeURL("../public/styles.css", import.meta.url));
const START = "/* ─── Design tokens";
const END = "/* ─── End of design tokens ─── */";

const SURFACE_LUM = { "--bg": 0.00206, "--surface-1": 0.01257, "--surface-2": 0.02607, "--surface-3": 0.05693 };
const BG_RGB = [5, 7, 10];
const OVERLAY = /modal|popover|dropdown|menu|toast|tooltip|dialog|drawer|notification-panel|flyout/i;
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g;

const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255);

/** A colour literal as r, g, b (0..255) and alpha (0..1). */
export function parseColour(text) {
  const t = text.trim();
  if (t.startsWith("#")) {
    let h = t.slice(1);
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = [0, 2, 4, 6].map((i) => (h.length > i ? parseInt(h.slice(i, i + 2), 16) : 255));
    return { rgb: n.slice(0, 3), a: n[3] / 255 };
  }
  const parts = t.slice(t.indexOf("(") + 1, -1).split(/[\s,/]+/).filter(Boolean).map(Number);
  return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
}

/** What kind of colour it is: its hue family, how strong, how light. */
export function classify({ rgb, a }) {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  let hue = 0;
  if (chroma) {
    if (max === r) hue = (60 * ((g - b) / chroma) + 360) % 360;
    else if (max === g) hue = 60 * ((b - r) / chroma) + 120;
    else hue = 60 * ((r - g) / chroma) + 240;
  }
  const family =
    a === 0 ? "transparent"
    : chroma < 70 ? "neutral"
    : hue >= 165 && hue < 240 ? "cyan"
    : hue >= 90 && hue < 165 ? "green"
    : hue >= 20 && hue < 65 ? "amber"
    : hue >= 240 && hue < 330 ? "purple"
    : "red";
  const blended = rgb.map((c, i) => c * a + BG_RGB[i] * (1 - a));
  return { family, a, lum: luminance(rgb), onPage: luminance(blended) };
}

const HUE_TOKEN = { cyan: "--accent", amber: "--warn", red: "--danger", green: "--success", purple: "--accent" };

function nearestSurface(lum) {
  return Object.entries(SURFACE_LUM).reduce((best, [name, l]) => (Math.abs(l - lum) < Math.abs(SURFACE_LUM[best] - lum) ? name : best), "--bg");
}

const v = (name) => `var(${name})`;

function textColour(c, fill) {
  if (c.family === "transparent") return "transparent";
  if (c.family !== "neutral") return v(HUE_TOKEN[c.family]);
  if (c.lum < 0.2) return v(fill && fill !== "--accent" && /^--(warn|danger|success)$/.test(fill) ? `--on-${fill.slice(2)}` : "--on-accent");
  const seen = c.lum * c.a;
  return v(seen >= 0.78 ? "--text" : seen >= 0.58 ? "--text-soft" : "--muted");
}

function backgroundColour(c, selector = "") {
  if (c.family === "transparent") return "transparent";
  if (c.family === "neutral") {
    // A dark see-through layer over the whole page, behind a modal: the scrim.
    if (/backdrop|overlay|scrim/i.test(selector) && c.lum < 0.01 && c.a < 1) return v("--scrim-modal");
    // Black: a veil over the page when dense (a modal's backdrop), a darker well when faint (an input on a panel).
    if (c.rgb.every((x) => x === 0) || c.lum < 0.001) return v(c.a >= 0.45 ? "--scrim-modal" : "--bg");
    if (c.lum > 0.3 && c.a >= 0.6) return v("--text-soft");
    // A see-through dark layer always lies on something, a panel as often as the page: it is a card, one step up
    // (surface-2), or two if it was light. Blended onto the page instead, cards went darker than their panels.
    if (c.a < 0.9) return v(c.lum >= 0.03 ? "--surface-3" : c.lum >= 0.006 ? "--surface-2" : "--surface-1"); // near-black: the page's own shell
    return v(nearestSurface(c.lum));
  }
  if (c.a >= 0.6 && c.lum > 0.15) return v(HUE_TOKEN[c.family]);
  return v(c.a >= 0.15 ? "--surface-3" : "--surface-2");
}

function borderColour(c) {
  if (c.family === "transparent") return "transparent";
  if (c.family === "neutral" || c.family === "purple") return v("--border");
  if (c.family === "cyan") return v(c.a >= 0.5 ? "--accent" : "--border");
  return v(c.a >= 0.3 ? HUE_TOKEN[c.family] : "--border");
}

/** Split at top-level commas (not the ones inside a function's parentheses). */
function layers(value) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The hsl()/hsla() calls in a value, whole (they nest: hsl(var(--avatar-hue, 190), 90%, 70%)). */
function hslCalls(text) {
  const out = [];
  for (let i = text.search(/hsla?\(/); i >= 0; ) {
    let depth = 0;
    let j = text.indexOf("(", i);
    for (; j < text.length; j++) {
      if (text[j] === "(") depth++;
      if (text[j] === ")" && --depth === 0) break;
    }
    out.push(text.slice(i, j + 1));
    const next = text.slice(j + 1).search(/hsla?\(/);
    i = next < 0 ? -1 : j + 1 + next;
  }
  return out;
}

const colours = (text) => (text.match(COLOUR) ?? []).map((t) => ({ text: t, ...parseColour(t) })).map((c) => ({ ...c, ...classify(c) }));

function background(value, selector = "") {
  const kept = [];
  for (const layer of layers(value)) {
    const cs = colours(layer).filter((c) => c.family !== "transparent");
    if (/^url\(|^var\(/.test(layer) || (!cs.length && !/gradient\(/.test(layer))) {
      kept.push(layer);
      continue;
    }
    if (/repeating-[a-z]+-gradient\(/.test(layer)) continue;
    if (/radial-gradient\(/.test(layer) && cs.every((c) => c.a <= 0.3)) continue; // a decorative glow
    if (/gradient\(/.test(layer)) {
      if (!cs.length) {
        const hsl = hslCalls(layer);
        if (hsl.length) kept.push(hsl[0]); // a colour computed per user (a forum avatar's hue): flat, not a glow
        continue;
      }
      const strong = cs.find((c) => c.family !== "neutral" && c.a >= 0.6 && c.lum > 0.15);
      if (strong) {
        kept.push(v(HUE_TOKEN[strong.family]));
        continue;
      }
      const soft = cs.every((c) => c.family === "neutral" || c.a < 0.6);
      if (soft && layer.includes("transparent") && cs.every((c) => c.family !== "neutral" || c.a < 0.5)) {
        // a fade to nothing: a divider line keeps a line, a tint over the page goes
        if (cs.some((c) => c.family === "cyan" && c.a >= 0.3)) kept.push(v("--border"));
        continue;
      }
      kept.push(backgroundColour(cs[0], selector));
      continue;
    }
    kept.push(backgroundColour(cs[0], selector));
  }
  return kept.length ? kept.join(", ") : "none";
}

function boxShadow(value, selector) {
  const kept = [];
  let overlay = false;
  for (const layer of layers(value)) {
    const cs = colours(layer);
    if (!cs.length) {
      kept.push(layer);
      continue;
    }
    const nums = layer.replace(COLOUR, "").replace("inset", "").trim().split(/\s+/).map((n) => parseFloat(n) || 0);
    const [x = 0, y = 0, blur = 0, spread = 0] = nums;
    if (x === 0 && y === 0 && blur === 0 && spread > 0) {
      kept.push(layer.replace(COLOUR, borderColour(cs[0])));
      continue;
    }
    if (cs[0].family === "neutral" && cs[0].lum < 0.05 && OVERLAY.test(selector)) overlay = true;
  }
  if (overlay) kept.push(v("--elevation-overlay"));
  return kept.length ? kept.join(", ") : null;
}

const STEPS = [[11.5, 1], [14, 2], [16.5, 3], [20, 4], [24, 5], [Infinity, 6]];
function fontSize(value) {
  const rem = /^(\d*\.?\d+)rem$/.exec(value);
  if (!rem) return value;
  const px = Number(rem[1]) * 16;
  return v(`--font-size-${STEPS.find(([max]) => px <= max)[1]}`);
}

const GRID = new Set([4, 8, 12, 16, 20, 24, 32, 40, 48, 64]);
const spacing = (value) =>
  value.replace(/(^|[\s(,])(\d*\.?\d+)(px|rem)\b/g, (m, pre, n, unit) => {
    const px = Number(n) * (unit === "rem" ? 16 : 1);
    return GRID.has(px) ? `${pre}var(--space-${px / 4})` : m;
  });

/**
 * var(--token, #literal): a token is always defined (the block), so its literal fallback is dead weight and goes. A
 * name the block does not define (var(--fg, #d8ebf5)) always shows its fallback, so it is left for the property's own
 * rule to map, like any other literal.
 */
const TOKENS = readTokens();
const dropFallbacks = (css) =>
  css.replace(/var\((--[a-z0-9-]+)\s*,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*\)/g, (m, name) => (TOKENS.has(name) ? `var(${name})` : m));

/** One declaration: its new text, or null to drop it. */
export function rewrite(property, value, selector, fill) {
  const hasColour = COLOUR.test(value);
  COLOUR.lastIndex = 0;
  if ((property === "text-shadow" || property === "filter" || property === "box-shadow") && !hasColour && hslCalls(value).length) return null;
  if ((property === "text-shadow" || property === "filter") && hasColour) return null;
  if (property === "box-shadow" && hasColour) return boxShadow(value, selector);
  if (property === "color" && hasColour) return textColour(colours(value)[0], fill);
  if ((property === "background" || property === "background-color" || property === "background-image") && (hasColour || /gradient\(/.test(value))) return background(value, selector);
  if (/^border(-(top|right|bottom|left))?(-color)?$|^outline(-color)?$/.test(property) && hasColour) {
    return value.replace(COLOUR, (t) => borderColour(classify(parseColour(t)) && { ...parseColour(t), ...classify(parseColour(t)) }));
  }
  if (property === "font-size") return fontSize(value.trim());
  if (/^(padding|margin)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$|^(row-|column-)?gap$/.test(property)) return spacing(value);
  return value;
}

/** Rewrite the declarations in a stylesheet's text outside the token block. */
export function tokenize(css) {
  return dropFallbacks(css).replace(/([^{}]*)\{([^{}]*)\}/g, (whole, selectorText, body) => {
    const selector = selectorText.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const fillDecl = /(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+)/.exec(body);
    const fill = fillDecl ? (/var\((--[a-z-]+)\)/.exec(fillDecl[1].includes("var(") ? fillDecl[1] : background(fillDecl[1]))?.[1] ?? null) : null;
    const next = body.replace(/(^|;)(\s*)([a-z-]+)(\s*:\s*)([^;]*?)(\s*)(?=;|$)/g, (m, lead, ws, prop, colon, value, trail) => {
      if (!value.trim()) return m;
      const out = rewrite(prop, value.trim(), selector, fill);
      if (out === null) return `${lead}__DROP__`;
      return `${lead}${ws}${prop}${colon}${out}${trail}`;
    });
    return `${selectorText}{${next.replace(/__DROP__\s*;?/g, "")}}`; // a dropped declaration goes with its own ";"
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const css = readFileSync(FILE, "utf8");
  const start = css.indexOf(START);
  const end = css.indexOf(END) + END.length;
  const out = tokenize(css.slice(0, start)) + css.slice(start, end) + tokenize(css.slice(end));
  writeFileSync(FILE, out);
  console.log(`rewrote ${FILE}`);
}
