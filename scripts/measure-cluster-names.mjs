#!/usr/bin/env node
/**
 * AB#2343: the width of every system's name, of each half wrapName breaks it into, and of "YOU ARE HERE", in the
 * Starmap's phone font (Inter, 14px) as Chromium measures it, written to tests/fixtures/cluster-name-widths-14.json.
 * The cluster label tests plan a phone's names with these rather than a per-character guess, which ran wide enough
 * that a name the phone fits on one line (Alpha Centauri) wrapped in the test and took another's place.
 *
 *   node scripts/measure-cluster-names.mjs     (re-run when a system is added or renamed)
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const SYSTEMS = JSON.parse(readFileSync("data/systems.json", "utf8"));
const halves = (name) => {
  const spaces = [...name].flatMap((c, i) => (c === " " ? [i] : []));
  if (!spaces.length) return [];
  const at = spaces.reduce((best, i) => (Math.abs(i - name.length / 2) < Math.abs(best - name.length / 2) ? i : best));
  return [name.slice(0, at), name.slice(at + 1)];
};
const texts = [...new Set(["YOU ARE HERE", ...SYSTEMS.flatMap((s) => [s.name, ...halves(s.name)])])];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`, { waitUntil: "networkidle" });
const widths = await page.evaluate(async (list) => {
  await document.fonts.load('14px "Inter"');
  await document.fonts.load('bold 14px "Inter"');
  const ctx = document.createElement("canvas").getContext("2d");
  const measure = (font) => { ctx.font = font; return Object.fromEntries(list.map((t) => [t, Math.round(ctx.measureText(t).width * 10) / 10])); };
  return { regular: measure('14px "Inter", sans-serif'), bold: measure('bold 14px "Inter", sans-serif'), inter: document.fonts.check('14px "Inter"') };
}, texts);
await browser.close();
if (!widths.inter) throw new Error("Inter did not load: the widths would be a fallback font's");
writeFileSync("tests/fixtures/cluster-name-widths-14.json", `${JSON.stringify({ _comment: "scripts/measure-cluster-names.mjs (AB#2343): Inter 14px, the Starmap's phone font, measured in Chromium", regular: widths.regular, bold: widths.bold }, null, 2)}\n`);
console.log(`${texts.length} texts measured`);
