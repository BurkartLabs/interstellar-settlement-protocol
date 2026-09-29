// AB#832: the Rare Metals track on screen, from the running game at 1280x800 and 375x812: Kestrel's panel on the Starmap
// (a lease now, and what a yard there mines: Cobalt 10% among its catalog shares), and the Refinery view listing the
// track's two new chains. Screenshots to e2e/screenshots/ab-832/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import { backShown, openSystem, recordCanvas, lastLabel } from "./starmapCanvas.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-832");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "belt-panel-e2e-fixture-secret-0123456789ab";

function startServer(dir, { tickers }) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: tickers ? "" : "1" },
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

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800, mobile: false },
  { label: "375x812", width: 375, height: 812, mobile: true }
];

for (const vp of VIEWPORTS) {
  test(`the Rare Metals track on the Starmap and in the Refinery view at ${vp.label}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-rare-metals-e2e-"));
    const email = `rare-metals-${Date.now()}-${vp.width}@example.test`;
    execFileSync(process.execPath, ["e2e/seed-belt-panel.mjs", dir, email, PASSWORD, "static"], { cwd: REPO_ROOT, env: { ...process.env, JWT_SECRET: SECRET } });
    const server = await startServer(dir, { tickers: false });
    try {
      await recordCanvas(page);
      await page.goto(`${server.url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "starmap");
      const canvas = page.locator("#starmap-canvas");
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await openSystem(page, canvas, "Epsilon Eridani");
      await page.waitForTimeout(400);

      // Kestrel: the drawn planet nearest its label.
      const label = await lastLabel(page, "Kestrel");
      expect(label, "Kestrel is labelled").toBeTruthy();
      // Every circle the map drew near Kestrel's label, nearest first: clicked in turn until Kestrel's own panel (its lease)
      // opens. A station marker (AB#811) or a neighbouring body may take the first; the system is reopened after either.
      const candidates = await page.evaluate((l) => {
        const cx = l.x + l.w / 2;
        return window.__arcs.filter((a) => a.r >= 2 && a.r <= 30).map((a) => ({ x: a.x, y: a.y, d: Math.hypot(a.x - cx, a.y - l.y) }))
          .filter((a) => a.d < 60).sort((a, b) => a.d - b.d);
      }, label);
      const details = page.locator("#map-details");
      const isKestrel = async () => (await details.locator("[data-lease-cost]").count()) > 0 && (await details.innerText()).includes("Kestrel");
      for (const c of candidates) {
        await canvas.click({ position: { x: c.x, y: c.y } });
        await page.waitForTimeout(350);
        if (await isKestrel()) break;
        if (await backShown(page)) {
          const back = (await lastLabel(page, "◂ Back To System")) || null;
          if (back) { await canvas.click({ position: { x: back.x + back.w / 2, y: back.y - 3 } }); await page.waitForTimeout(350); }
        }
      }
      await expect(details).toContainText("Kestrel");
      await expect(details.locator("[data-lease-cost]")).toHaveText("60,000 credits");
      await expect(details.locator("[data-body-yield]")).toContainText("Cobalt 10%");
      await details.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `kestrel-panel-${vp.label}.png`) });

      // The Refinery view: the two new chains, each naming the research that opens it.
      await openTab(page, "refinery");
      const view = page.locator("#refinery");
      await expect(view).toContainText("Rare-Earth Magnets");
      await expect(view).toContainText("Thorium Fuel Rods");
      // Bug AB#4682: the view can redraw under a node being scrolled to ("not attached to the DOM"); find it afresh and retry
      await expect(async () => { await view.getByText("Rare-Earth Magnets").first().scrollIntoViewIfNeeded({ timeout: 2_000 }); }).toPass({ timeout: 15_000 });
      await page.screenshot({ path: path.join(SHOT_DIR, `refinery-chains-${vp.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      server.child.kill();
    }
  });
}
