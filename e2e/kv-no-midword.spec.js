// Bug #4883: the shared key/value list (.ui-kv) broke plain words mid-word at 375 ("Advanc/ed Material/s" in the
// Overview's level unlocks), because the label column took the longest label's full width and squeezed every value.
// The real stylesheet and fonts, served from public/ through the browser's router (no server), in .ui-screen cards as
// wide as the Overview's at 375 (275 px) and a full-width one (343 px): no value made of ordinary words may need more
// than its column, and no label either. Identifiers with no spaces may still break; that is what overflow-wrap is for.
//
// Run: `npx playwright test e2e/kv-no-midword.spec.js` (it needs no server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const ORIGIN = "http://kv-harness.test";
const TYPES = { ".css": "text/css", ".woff2": "font/woff2" };
const PAIRS = [
  ["Employee cap", "100"], ["Highest building tier", "4"], ["Market sectors opened", "Advanced Materials"],
  ["Counterparty", "Hyperion Deep Space Logistics Consortium"], ["Estimated completion", "Tuesday 14:05 UTC"],
  ["Registered office", "Earth Station Prime, Sol"], ["Outstanding principal", "¤1,250,000"],
];

test("a key/value list at phone width never breaks an ordinary word", async ({ page }) => {
  await page.route(`${ORIGIN}/**`, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/kv.html") {
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8" /><link rel="stylesheet" href="/styles.css" /></head><body>
        <section class="ui-screen" style="padding:0 16px">${[275, 343].map((w) => `<div class="ui-card" style="width:${w}px;margin:16px 0;padding:16px;box-sizing:border-box"><dl class="ui-kv">${PAIRS.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>`).join("")}</section></body></html>` });
    }
    const file = path.join(PUBLIC, p);
    return fs.existsSync(file) ? route.fulfill({ body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] || "application/octet-stream" }) : route.fulfill({ status: 404 });
  });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(`${ORIGIN}/kv.html`);
  await page.evaluate(() => document.fonts.ready);
  const squeezed = await page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    return [...document.querySelectorAll(".ui-kv > dt, .ui-kv > dd")].flatMap((el) => {
      const cs = getComputedStyle(el);
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const need = Math.max(...el.textContent.trim().split(/\s+/).map((w) => ctx.measureText(w).width));
      return need > el.clientWidth + 1 ? [`${el.tagName} "${el.textContent}" needs ${Math.round(need)} in ${el.clientWidth}`] : [];
    });
  });
  expect(squeezed).toEqual([]);
});
