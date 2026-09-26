// AB#742 (ISP-56): the bodies outside Sol are drawn procedurally from their style in data/systems.json. This opens
// every system on the Starmap at 1280x800 and photographs the five outside Sol plus a close-up of Centauri Prime,
// checks the Alpha Centauri view is the same pixels after a reload (the render is seeded), and times 30 frames of
// each system under 4x CPU throttling from the "isp:starmap-render" measure, printed and attached to the Playwright
// report for the PR (recorded, not asserted). Starts its own server (the starmap-system-fit.spec.js pattern).
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "bodies-e2e-fixture-secret-0123456789abcd";
const SYSTEMS = [
  ["Sol", "sol"],
  ["Alpha Centauri", "alpha-centauri"],
  ["Barnard's Star", "barnards-star"],
  ["Wolf 359", "wolf-359"],
  ["Tau Ceti", "tau-ceti"],
  ["Epsilon Eridani", "epsilon-eridani"]
];

/** The planets opened close up, and the moon each should now show (null: none). */
const CLOSE_UPS = {
  "alpha-centauri": [["Centauri Prime", null], ["Centauri II", "Haven"]],
  "barnards-star": [["Cinder", "Arcadia"]]
};

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

const labelOf = (page, test) => page.evaluate((src) => {
  const match = new Function("t", `return ${src}`);
  return window.__labels.filter((l) => match(l.t)).pop();
}, test);

/** Clicks a cluster star by its label (a star sits 10px plus its radius before its label, or after it). */
async function openSystem(page, canvas, name) {
  const label = await labelOf(page, `t === ${JSON.stringify(name)}`);
  expect(label, `${name} is drawn on the cluster view`).toBeTruthy();
  for (const dx of [-17, -20, label.w + 17, label.w + 20]) {
    await page.evaluate(() => { window.__labels = []; });
    await canvas.click({ position: { x: label.x + dx, y: label.y - 1 } });
    await page.waitForTimeout(400);
    if (await labelOf(page, `t.endsWith("Back To Cluster")`)) return;
  }
  throw new Error(`could not open ${name}`);
}

async function backToCluster(page, canvas) {
  const back = await labelOf(page, `t.endsWith("Back To Cluster")`);
  await canvas.click({ position: { x: back.x + back.w / 2, y: back.y - 3 } });
  await page.waitForTimeout(500);
}

async function signInToStarmap(page, url, email) {
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  await openTab(page, "starmap");
  const canvas = page.locator("#starmap-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  return canvas;
}

/** 30 frames of the current view under 4x CPU throttling, from the isp:starmap-render measure. */
async function frameTimes(page, cdp) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const times = await page.evaluate(async () => {
    performance.clearMeasures("isp:starmap-render");
    for (let i = 0; i < 30; i += 1) {
      window.dispatchEvent(new Event("resize"));
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    return performance.getEntriesByName("isp:starmap-render").map((e) => e.duration);
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const sorted = [...times].sort((a, b) => a - b);
  return { frames: times.length, medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(2), maxMs: +sorted.at(-1).toFixed(2) };
}

test("every system's bodies render procedurally and the same after a reload, with frame times recorded", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const email = `bodies-qa-${Date.now()}@example.test`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-bodies-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-docked-account.mjs", dir, email, PASSWORD, "earth-station-prime"], {
    cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
  });
  if (seeded.status !== 0) throw new Error(`seed-docked-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
  const { child, url } = await startServer(dir);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  try {
    await page.addInitScript(() => {
      window.__labels = [];
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
        window.__labels.push({ t: String(text), x, y, w: this.measureText(String(text)).width });
        return fillText.call(this, text, x, y, ...rest);
      };
    });
    const cdp = await context.newCDPSession(page);
    let canvas = await signInToStarmap(page, url, email);
    const results = {};

    for (const [name, id] of SYSTEMS) {
      await openSystem(page, canvas, name);
      await page.waitForTimeout(600);
      if (id !== "sol") await canvas.screenshot({ path: path.join(SCREEN_DIR, `ab742-${id}-1280x800.png`) });
      results[id] = await frameTimes(page, cdp);
      // Close-ups: the body view draws the planet at 15% of the canvas, where the surface can actually be seen, with
      // its moons around it (Bug #2112: the moons outside Sol had no parent and were drawn nowhere).
      for (const [planet, moon] of CLOSE_UPS[id] || []) {
        const label = await labelOf(page, `t === ${JSON.stringify(planet)}`);
        await page.evaluate(() => { window.__labels = []; });
        await canvas.click({ position: { x: label.x - 4, y: label.y + 4 } });
        await page.waitForTimeout(600);
        expect(await labelOf(page, `t.endsWith("Back To System")`), `${planet} close-up opened`).toBeTruthy();
        if (moon) expect(await labelOf(page, `t === ${JSON.stringify(moon)}`), `${moon} orbits ${planet}`).toBeTruthy();
        const slug = planet.toLowerCase().replace(/[^a-z]+/g, "-");
        await canvas.screenshot({ path: path.join(SCREEN_DIR, `ab742-${slug}-body-1280x800.png`) });
        results[`${slug}-body`] = await frameTimes(page, cdp);
        const back = await labelOf(page, `t.endsWith("Back To System")`);
        await page.evaluate(() => { window.__labels = []; });
        await canvas.click({ position: { x: back.x + back.w / 2, y: back.y - 3 } });
        await page.waitForTimeout(600);
      }
      await backToCluster(page, canvas);
    }
    // Reported, not written into the checkout (AB#1827): an attachment in the Playwright report, and the run's output.
    await test.info().attach("ab742-frame-times.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
    console.log(`[ab742] frame times at 4x CPU throttle: ${JSON.stringify(results)}`);

    // Seeded: the Alpha Centauri view is the same pixels after a reload.
    await openSystem(page, canvas, "Alpha Centauri");
    await page.waitForTimeout(600);
    const before = await canvas.evaluate((c) => c.toDataURL());
    await page.reload();
    await page.waitForURL(/\/\?account=|\/$/);
    await openTab(page, "starmap");
    canvas = page.locator("#starmap-canvas");
    await page.waitForTimeout(800);
    await openSystem(page, canvas, "Alpha Centauri");
    await page.waitForTimeout(600);
    const after = await canvas.evaluate((c) => c.toDataURL());
    expect(after === before, "Alpha Centauri renders identically after a reload").toBe(true);

    // Measured, not asserted (P-STOPWATCH-TEST): a shared machine moved the placeholder build's median from 7 to 27 ms
    // between systems, so a threshold here would fail on load, not on the render. The numbers go in the PR.
    for (const [id, r] of Object.entries(results)) expect(r.frames, `${id}: frames measured`).toBeGreaterThanOrEqual(30);
    expect(errors).toEqual([]);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
    await context.close();
  }
});
