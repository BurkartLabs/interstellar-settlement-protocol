// ISP-70 (AB#759): the design tokens read out of public/styles.css, measured with the one contrast module the specimen
// page uses too (public/scripts/tokenContrast.js). tests/unit/designTokens.test.js holds the tokens to it; run this
// file to print the table the pull request lists:  node scripts/design-tokens.mjs
//
// The stylesheet is the one source: nothing here restates a colour, so a token changed in the block is measured as it
// now is.

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url"; // Node's URL: a jsdom test replaces the global one
import { measure } from "../public/scripts/tokenContrast.js";

export const STYLESHEET = fileURLToPath(new NodeURL("../public/styles.css", import.meta.url));
const START = "/* ─── Design tokens";
const END = "/* ─── End of design tokens ─── */";

/** The token block's text, and the rest of the stylesheet around it. */
export function splitStylesheet(css = readFileSync(STYLESHEET, "utf8")) {
  const start = css.indexOf(START);
  const end = css.indexOf(END);
  if (start < 0 || end < start) throw new Error("public/styles.css has no design-token block (ISP-70)");
  return { block: css.slice(start, end + END.length), outside: css.slice(0, start) + css.slice(end + END.length) };
}

/** Every custom property the block's first :root defines, name to raw value. */
export function readTokens(block = splitStylesheet().block) {
  const from = block.indexOf(":root {");
  const root = block.slice(from, block.indexOf("\n}", from)).replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = new Map();
  for (const m of root.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());
  return tokens;
}

/** A token's value with every var() followed to the end. */
export function resolve(tokens, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`${name} refers to itself`);
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`${name} is not a token`);
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  return ref ? resolve(tokens, ref[1], new Set([...seen, name])) : value;
}

/** Every pair the tokens promise, measured from the stylesheet as it is. */
export const measureStylesheet = (tokens = readTokens()) => measure((name) => resolve(tokens, name));

/**
 * The literal values still written outside the token block, by kind. ISP-71 (AB#760) replaces them with tokens; until
 * then the test holds each count to what it was when the block landed, so new CSS cannot add to them.
 */
export function literalsOutside(outside = splitStylesheet().outside) {
  const css = outside.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = [...css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)[;}]/g)].map((m) => ({ property: m[1], value: m[2].trim() }));
  const isLength = (v) => /(^|[\s(,-])\d*\.?\d+(px|rem|em)\b/.test(v) && !/^0(px|rem|em)?$/.test(v);
  return {
    colours: [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)].length,
    fontSizes: declarations.filter((d) => d.property === "font-size" && !/^(var\(|inherit|initial|unset)/.test(d.value)).length,
    spacing: declarations.filter((d) => /^(padding|margin)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$|^(row-|column-)?gap$/.test(d.property) && isLength(d.value)).length,
    customProperties: [...css.matchAll(/(^|[;{\s])--[a-zA-Z0-9-]+\s*:/g)].length
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tokens = readTokens();
  console.log("| On | Colour | Ratio | Needs | |\n|---|---|---:|---:|---|");
  for (const r of measureStylesheet(tokens)) {
    console.log(`| \`${r.bg}\` ${resolve(tokens, r.bg)} | \`${r.fg}\` ${resolve(tokens, r.fg)} | ${r.ratio.toFixed(2)}:1 | ${r.min}:1 | ${r.ratio >= r.min ? "pass" : "FAIL"} |`);
  }
  console.log("\nLiterals still outside the block:", JSON.stringify(literalsOutside()));
}
