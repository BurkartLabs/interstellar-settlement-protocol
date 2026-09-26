// AB#1453 (ISP-44b): the page left alone kept the main thread 20-40% busy at 4x throttling, most of it the background:
// the starfield redrawn on every animation frame, and the nebula animating background-position, which repaints the
// whole screen. Each such frame also recomposites every blurred panel above them. The stars now draw at most 5 times
// a second (they drift under 1.5px a second, so it looks the same) and the nebula moves by transform, which the
// compositor does alone. Nothing here stops either from moving: that is what reduced motion is for (AB#1760).
//
// This spec is about their cost. Whether a player sees the stars is e2e/focus-and-motion.spec.js, which compares the
// screen: this one's motion check compares the canvas's own pixels, which kept changing while nothing reached the
// screen (AB#2131).
//
// Run against a server you started: `npx playwright test e2e/idle-motion.spec.js`.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Count the starfield's frames: it clears its canvas once per frame.
  await page.addInitScript(() => {
    window.__starFrames = 0;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas?.id === "starfield-canvas") window.__starFrames += 1;
      return clear.apply(this, args);
    };
  });
});

test("the starfield draws at most about five frames a second, and its canvas still changes", async ({ page }) => {
  await page.goto("/login.html");
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => ({ frames: window.__starFrames, pixels: document.getElementById("starfield-canvas").toDataURL() }));
  await page.waitForTimeout(2_000);
  const after = await page.evaluate(() => ({ frames: window.__starFrames, pixels: document.getElementById("starfield-canvas").toDataURL() }));
  const perSecond = (after.frames - before.frames) / 2;
  expect(perSecond, "frames a second").toBeLessThanOrEqual(6.5);
  expect(perSecond, "frames a second: it must still animate").toBeGreaterThanOrEqual(3);
  expect(after.pixels, "the canvas changed (the canvas, not the screen: AB#2131)").not.toBe(before.pixels);
  await page.screenshot({ path: path.join(SCREEN_DIR, "idle-motion-login-1280x800.png") });
});

test("the nebula drifts by transform, not by repainting its background", async ({ page }) => {
  await page.goto("/login.html");
  const drift = await page.evaluate(() => {
    const bg = document.querySelector(".app-bg");
    const anim = bg?.getAnimations().find((a) => a.animationName === "nebulaDrift");
    if (!anim) return null;
    const props = anim.effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p));
    return { playing: anim.playState, props: [...new Set(props)] };
  });
  expect(drift, "the nebula still drifts").not.toBeNull();
  expect(drift.playing).toBe("running");
  expect(drift.props).toEqual(["transform"]);
});
