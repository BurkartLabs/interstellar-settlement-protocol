// AB#745 (ISP-59): a hire and a sale, played in the browser, with the numbers they change acknowledged where they are
// shown. Each test starts its own server on a seeded corporation (e2e/seed-trade-account.mjs: 40 Silicates at Earth
// Station Prime), the sell-orders-capped.spec.js pattern. The first test records a video to test-results/isp-59-video/
// and its frames to e2e/screenshots/isp-59/, both gitignored; the committed frames and the converted recording are in
// docs/isp-59/, copied there by hand (AB#2251).
import { test, expect } from "@playwright/test";
import { openTab, openStationOffices } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "isp-59");
const VIDEO_DIR = path.join(REPO_ROOT, "test-results", "isp-59-video");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "number-change-e2e-fixture-secret-0123456789";
const VIEWPORT = { width: 1280, height: 800 };

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => {
      out += chunk;
      const port = out.match(/listening on port (\d+)/)?.[1];
      if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}

async function seededServer(label) {
  const email = `number-change-${label}-${Date.now()}@example.test`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-number-change-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-trade-account.mjs", dir, email, PASSWORD], {
    cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
  });
  if (seeded.status !== 0) throw new Error(`seed-trade-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
  return { email, ...(await startServer(dir)) };
}

async function logIn(page, url, email) {
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
}

async function openSuitesAndRent(page) {
  await openTab(page, "station");
  const back = page.locator("#station-back-btn");
  if (await back.isVisible()) await back.click();
  await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
  await page.click('[data-building-action="building:orbital-executive-suites"]');
  await page.selectOption("#rent-office-duration", "7");
  await page.click("#rent-office-btn");
  await expect(page.locator("#office-hire-form")).toBeVisible();
}

/**
 * Start sampling `selector` on every animation frame: its text, and whether it carries an up or down class.
 *
 * Bug AB#2309: this sampled for a fixed 1.5 s from before the click, so under a full run's load a hire whose response
 * landed late was never seen ("expected coloured frames > 0, received 0"). Now, with `{ until: "up" | "down" }`, it
 * samples until a frame carrying that class has been recorded, then `settleMs` more for the count and the colour to
 * finish, capped at `maxMs`. A plain number samples for that long: for a test that expects no change at all.
 * finishSampling() waits for it to stop and returns the frames.
 */
async function startSampling(page, selector, opts) {
  const { until = null, settleMs = 1500, maxMs = 10_000 } = typeof opts === "number" ? { maxMs: opts } : opts;
  await page.evaluate(({ selector, until, settleMs, maxMs }) => {
    window.__frames = [];
    window.__samplingDone = false;
    const t0 = performance.now();
    let seenAt = null;
    const tick = (now) => {
      const el = document.querySelector(selector);
      const frame = {
        t: Math.round(now - t0),
        text: el?.textContent ?? null,
        up: Boolean(el?.classList.contains("num-change--up")),
        down: Boolean(el?.classList.contains("num-change--down"))
      };
      window.__frames.push(frame);
      if (until && frame[until] && seenAt === null) seenAt = now;
      const settled = until ? seenAt !== null && now - seenAt >= settleMs : false;
      if (settled || now - t0 >= maxMs) window.__samplingDone = true;
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { selector, until, settleMs, maxMs });
}
/** Wait for the sampling to stop (the change seen and settled, or the cap reached), and return what it recorded. */
async function finishSampling(page) {
  await page.waitForFunction(() => window.__samplingDone === true, null, { timeout: 20_000 });
  return page.evaluate(() => window.__frames);
}

/** From sampled frames: the texts shown, and how long the colour was on, first frame to last. */
function summarise(frames, kind) {
  const on = frames.filter((f) => f[kind]);
  return {
    texts: [...new Set(frames.map((f) => f.text))],
    colouredMs: on.length ? on[on.length - 1].t - on[0].t : 0,
    coloured: on.length > 0,
    lastText: frames[frames.length - 1]?.text
  };
}

test("a hire counts the sidebar up in green, and a sale counts the inventory down in red, each under a second", async ({ browser }) => {
  test.setTimeout(120_000);
  const { email, child, url } = await seededServer("motion");
  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: VIDEO_DIR, size: VIEWPORT } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await logIn(page, url, email);
    await openSuitesAndRent(page);
    await page.waitForTimeout(600); // a beat on the video before the hire

    // The hire: sidebar Employees and the office's Staffing both go 0 -> 5.
    await startSampling(page, '[data-num-key="sidebar:employees"]', { until: "up" });
    await page.fill("#office-hire-count", "5");
    await page.click('#office-hire-form button[type="submit"]');
    await expect(page.locator('[data-num-key="sidebar:employees"].num-change--up')).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, "01-hire-sidebar-counting-up.png") });
    const hire = summarise(await finishSampling(page), "up");
    console.log("hire", JSON.stringify(hire));
    expect(hire.coloured).toBe(true);
    expect(hire.texts.some((t) => Number(t) > 0 && Number(t) < 5), `counted through: ${hire.texts}`).toBe(true);
    // Counted upward only: no frame shows the new value before the count reaches it.
    expect(hire.texts.map(Number), `order: ${hire.texts}`).toEqual([...hire.texts.map(Number)].sort((a, b) => a - b));
    expect(hire.colouredMs).toBeLessThan(1000);
    expect(hire.lastText).toBe("5");
    await page.screenshot({ path: path.join(SHOT_DIR, "02-hire-settled.png") });

    // The sale: 10 Silicates to a standing buy order; the Exchange's inventory goes 40 -> 30.
    await openTab(page, "market");
    const inventory = '[data-num-key="exchange:inventory:earth-station-prime:Silicates"]';
    await expect(page.locator(inventory)).toHaveText("40");
    await page.locator(inventory).scrollIntoViewIfNeeded();
    const sell = page.locator('[data-npc-item="Silicates"]').first();
    const orderId = await sell.getAttribute("data-npc-order-id");
    await page.fill(`[data-npc-sell-qty="${orderId}"]`, "10");
    await sell.click();
    await page.waitForTimeout(400);
    await page.locator(inventory).scrollIntoViewIfNeeded();
    await startSampling(page, inventory, { until: "down" });
    await page.click("#trade-confirm-ok");
    await expect(page.locator(`${inventory}.num-change--down`)).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, "03-sale-inventory-counting-down.png") });
    const sale = summarise(await finishSampling(page), "down");
    console.log("sale", JSON.stringify(sale));
    expect(sale.coloured).toBe(true);
    expect(sale.texts.some((t) => Number(t) > 30 && Number(t) < 40), `counted through: ${sale.texts}`).toBe(true);
    expect(sale.texts.map(Number), `order: ${sale.texts}`).toEqual([...sale.texts.map(Number)].sort((a, b) => b - a));
    expect(sale.colouredMs).toBeLessThan(1000);
    expect(sale.lastText).toBe("30");
    await page.screenshot({ path: path.join(SHOT_DIR, "04-sale-settled.png") });
    await page.waitForTimeout(600);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    child.kill();
  }
});

test("with reduced motion, the hire shows 5 at once with a static green", async ({ browser }) => {
  test.setTimeout(90_000);
  const { email, child, url } = await seededServer("reduced");
  const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await logIn(page, url, email);
    await openSuitesAndRent(page);
    await startSampling(page, '[data-num-key="sidebar:employees"]', { until: "up" });
    await page.fill("#office-hire-count", "5");
    await page.click('#office-hire-form button[type="submit"]');
    await expect(page.locator('[data-num-key="sidebar:employees"].num-change--up')).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, "05-reduced-motion-hire.png") });
    const frames = await finishSampling(page);
    const coloured = frames.filter((f) => f.up);
    console.log("reduced", JSON.stringify(summarise(frames, "up")));
    expect(coloured.length).toBeGreaterThan(0);
    expect([...new Set(coloured.map((f) => f.text))]).toEqual(["5"]); // no count: every coloured frame shows 5
    expect(summarise(frames, "up").colouredMs).toBeLessThan(1000);
  } finally {
    await context.close();
    child.kill();
  }
});

test("a hire made while the tab is hidden is not replayed when the player comes back", async ({ browser }) => {
  test.setTimeout(90_000);
  const { email, child, url } = await seededServer("hidden");
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await logIn(page, url, email);
    await openSuitesAndRent(page);
    await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true }));
    for (const n of ["2", "3"]) { // two changes while away, as socket updates would make
      await page.fill("#office-hire-count", n);
      await page.click('#office-hire-form button[type="submit"]');
      await page.waitForTimeout(300);
    }
    await expect(page.locator('[data-num-key="sidebar:employees"]')).toHaveText("5");
    await page.evaluate(() => {
      delete document.hidden; // back to the real getter: visible
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await startSampling(page, '[data-num-key="sidebar:employees"]', 1200); // a fixed window: no change is expected
    await openTab(page, "overview"); // the next render after coming back
    const back = summarise(await finishSampling(page), "up");
    console.log("hidden", JSON.stringify(back));
    expect(back.coloured).toBe(false);
    expect(back.texts).toEqual(["5"]);
  } finally {
    await context.close();
    child.kill();
  }
});
