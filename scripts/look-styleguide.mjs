// ISP-72 (AB#761): look at /styleguide, the core components in every state, at 1280x800 and 375x812. Beside the
// screenshots it measures two things a screenshot shows badly: at 375 wide, every control is at least 44px each way
// (inline links in running text are exempt, as WCAG 2.5.8 has it); and pressing Tab lands on each control with a
// visible outline.
//
// Usage, with a server running:  node scripts/look-styleguide.mjs <baseUrl> <outDir>

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

for (const [width, height] of [[1280, 800], [375, 812]]) {
  const size = `${width}x${height}`;
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/styleguide`, { waitUntil: "networkidle" });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (wide > 0) console.log(`  !! ${size} scrolls sideways by ${wide}px`);
  await page.screenshot({ path: path.join(outDir, `isp72-styleguide-${size}.png`) });
  await page.screenshot({ path: path.join(outDir, `isp72-styleguide-${size}-full.png`), fullPage: true });

  if (width === 375) {
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("main button, main input, main select, main [role=tab], main a")]
        .filter((el) => !el.closest("p"))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
        .map(({ el, r }) => `${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
    );
    console.log(`controls under 44px at ${size}: ${small.length ? small.join(" | ") : "none"}`);
  }

  const stops = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return { what: `${el.tagName.toLowerCase()} "${(el.textContent || el.value || "").trim().slice(0, 24)}"`, ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2 };
    });
    if (!s) break;
    stops.push(s);
  }
  const unringed = stops.filter((s) => !s.ring).map((s) => s.what);
  console.log(`${size}: ${stops.length} tab stops, ${unringed.length ? `NO RING on ${unringed.join(" | ")}` : "every one with a visible ring"}; page errors: ${errors.length ? errors.join(" | ") : "none"}`);
  await page.close();
}
await browser.close();
