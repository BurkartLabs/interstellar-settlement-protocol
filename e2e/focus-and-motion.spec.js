// AB#1760 (ISP-291): keyboard focus is visible on every stop, from one token, and reduced motion stops the motion.
// Tabs through login, the Station and the Galactic Exchange at 1280x800 and 375x812, and checks every stop's computed
// outline is the --focus-ring token (2px solid cyan). Then, with reduced motion emulated, checks that the typewriter
// prints its line at once, transitions are instant and the starfield holds still - and, as a control, that without
// it the starfield does move, so the still check can fail. Screenshots are taken before the checks, and the checks
// are soft, so a failing run still shows every screen.
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/focus-and-motion.spec.js`.

import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import path from "node:path";

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const RING = { style: "solid", width: "2px", color: "rgb(79, 216, 232)" }; // --accent, #4fd8e8 (ISP-70)

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800, mobile: false },
  { label: "375x812", width: 375, height: 812, mobile: true }
];

/** The focused element and its computed outline. */
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const s = getComputedStyle(el);
  const id = el.id ? `#${el.id}` : "";
  const cls = el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
  return {
    what: `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 80),
    text: (el.textContent || el.getAttribute("placeholder") || "").trim().slice(0, 30),
    style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor,
    tag: el.tagName.toLowerCase(), inPanel: Boolean(el.closest(".tab-panel.active, .login-form, .login-card"))
  };
});

/** Press Tab `count` times; check each stop; screenshot the first stop of each kind in `shots`. */
async function walk(page, count, name, vp) {
  const stops = [];
  const shot = new Set();
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press("Tab");
    const f = await focused(page);
    if (!f) continue;
    stops.push(f);
    const kind = f.inPanel ? (["input", "select", "textarea"].includes(f.tag) ? "field" : "control") : "chrome";
    if (!shot.has(kind)) {
      shot.add(kind);
      await page.screenshot({ path: path.join(SCREEN_DIR, `focus-${name}-${kind}-${vp.label}.png`) });
    }
  }
  expect(stops.length, `${name}: tab stops reached`).toBeGreaterThan(3);
  const bad = stops.filter((f) => f.style !== RING.style || f.width !== RING.width || f.color !== RING.color);
  expect.soft(bad.map((f) => `${f.what} "${f.text}": ${f.style} ${f.width} ${f.color}`), `${name}: stops without the ring`).toEqual([]);
  return stops;
}

async function register(page, prefix) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `${prefix}-${stamp}@example.test`);
  await page.fill("#register-password", "playtest-password-not-real");
  await page.fill("#register-ceo", "Playtest CEO");
  await page.fill("#register-corp", `Focus Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
}

for (const vp of VIEWPORTS) {
  test.describe(`focus ring at ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1 });

    test("every tab stop on login, the Station and the Exchange shows the focus ring", async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto("/login.html");
      await walk(page, 9, "login", vp);

      await register(page, "focus");
      await page.getByRole("button", { name: "I'll find my own way" }).click();
      await expect(page.locator("#dialogue-modal")).toBeHidden();

      await openTab(page, "station");
      await expect(page.locator("#station")).toHaveClass(/active/);
      await walk(page, 30, "station", vp);

      await openTab(page, "market");
      await expect(page.locator("#market")).toHaveClass(/active/);
      await walk(page, 30, "exchange", vp);
    });
  });
}

test.describe("reduced motion", () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  // AB#2131: compares the screen, not the canvas. The canvas kept drawing while body's background hid it, and a
  // check of canvas.toDataURL() passed on a page with no visible star. The strip is the empty margin left of the panel.
  const MARGIN = { x: 0, y: 0, width: 250, height: 800 };
  const starfieldMoves = async (page) => {
    const a = await page.screenshot({ clip: MARGIN });
    await page.waitForTimeout(700);
    return !a.equals(await page.screenshot({ clip: MARGIN }));
  };

  test("control: without it, the starfield moves", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/login.html");
    await page.waitForTimeout(500);
    expect(await starfieldMoves(page)).toBe(true);
  });

  test("with it, the typewriter prints at once, transitions are instant and the starfield holds still", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login.html");
    await page.waitForTimeout(500);
    expect.soft(await starfieldMoves(page), "starfield still").toBe(false);
    const btn = await page.$eval("#credential-login-btn", (el) => getComputedStyle(el).transitionDuration);
    expect.soft(btn.split(",").every((d) => parseFloat(d) < 0.001), `transition-duration ${btn}`).toBe(true);

    await register(page, "motion");
    const line = page.locator("#dialogue-text");
    await expect(line).not.toBeEmpty();
    const first = await line.textContent();
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: path.join(SCREEN_DIR, "motion-dialogue-1280x800.png") });
    expect.soft(await line.textContent(), "typewriter prints the whole line at once").toBe(first);
    expect(first.length).toBeGreaterThan(40);

    // The walkthrough's highlight and card: nothing animates for longer than an instant.
    await page.getByRole("button", { name: "Brief me" }).click();
    await expect(page.locator("#walkthrough-modal")).toBeVisible();
    const slow = await page.evaluate(() => [...document.querySelectorAll("*")].filter((el) => {
      const s = getComputedStyle(el);
      const long = (v) => v.split(",").some((d) => parseFloat(d) >= 0.001);
      return (s.animationName !== "none" && long(s.animationDuration)) || long(s.transitionDuration);
    }).map((el) => el.id || el.className).slice(0, 10));
    await page.screenshot({ path: path.join(SCREEN_DIR, "motion-walkthrough-1280x800.png") });
    expect.soft(slow, "elements still animating").toEqual([]);
  });
});
