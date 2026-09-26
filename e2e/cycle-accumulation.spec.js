// AB#746 (ISP-60): a running mining cycle shows what it is doing: tonnes and credits this cycle, the rate, and a bar
// that fills with elapsed time. A real cycle is built through the routes and moved 1 minute or 1 hour into its 4 hours
// (e2e/seed-running-cycle.mjs; the server's own mining code settles the time). This checks the Active Mining Cycles
// panel and the lease view's extractor panel at 1280x800 and 375x812: the bar is the elapsed fraction before and
// after a reload, the spend is the server's own figure (not the clock estimate), and "Mined this cycle" rises on the
// 5-second mining:updated event without a reload. Starts its own server.
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
const SECRET = "cycle-e2e-fixture-secret-0123456789abcdef";
const CYCLE_MS = 4 * 60 * 60 * 1000;

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];
const OFFSETS = [
  { label: "1min", ms: 60 * 1000 },
  { label: "1h", ms: 60 * 60 * 1000 }
];

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

/** The Active Mining Cycles card for the running extractor, and its figures as the player reads them. */
async function panelFigures(page) {
  const card = page.locator("#mine-cycle-list .queue-item", { has: page.locator(".cycle-figures") }).first();
  await expect(card).toBeVisible();
  return card.evaluate((el) => {
    const dd = (label) => [...el.querySelectorAll(".cycle-figures div")].find((d) => d.querySelector("dt")?.textContent === label)?.querySelector("dd")?.textContent || "";
    return {
      width: parseFloat(el.querySelector(".progress-bar").style.width),
      mined: Number(dd("Mined this cycle").replace(/[^\d]/g, "")),
      spent: dd("Spent this cycle"),
      rate: dd("Rate")
    };
  });
}

for (const offset of OFFSETS) {
  for (const viewport of VIEWPORTS) {
    test(`a cycle ${offset.label} in shows what it has done, at ${viewport.label}`, async ({ page }) => {
      test.setTimeout(120_000);
      const email = `cycle-qa-${Date.now()}-${offset.label}-${viewport.width}@example.test`;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-cycle-e2e-"));
      const seeded = spawnSync(process.execPath, ["e2e/seed-running-cycle.mjs", dir, email, PASSWORD, String(offset.ms)], {
        cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
      });
      if (seeded.status !== 0) throw new Error(`seed-running-cycle.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
      const { startedAt } = JSON.parse(seeded.stdout.trim().split("\n").pop());
      const { child, url } = await startServer(dir);
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));

      try {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`${url}/login.html`);
        await page.fill("#login-email", email);
        await page.fill("#login-password", PASSWORD);
        await page.click('#login-form button[type="submit"]');
        await page.waitForURL(/\/\?account=/);
        await openTab(page, "station");

        const expectedPct = () => ((Date.now() - startedAt) / CYCLE_MS) * 100;
        const first = await panelFigures(page);
        expect(Math.abs(first.width - expectedPct()), `bar ${first.width}% vs elapsed ${expectedPct().toFixed(1)}%`).toBeLessThan(2);
        expect(first.rate).toBe("120 t/h");
        expect(first.spent, "the server's own spend, not the clock estimate").not.toMatch(/est\./);
        // Not ">= 120": an extractor can break down at random (about 16% over an hour), pausing part of the hour, and
        // that is the game working. An hour in, something has been mined and the panel says so.
        if (offset.ms >= 60 * 60 * 1000) expect(first.mined, "an hour of mining shows on the panel").toBeGreaterThan(0);

        const panel = page.locator("#mine-cycle-list");
        await panel.scrollIntoViewIfNeeded();
        await panel.screenshot({ path: path.join(SCREEN_DIR, `ab746-cycles-panel-${offset.label}-${viewport.label}.png`) });

        // Accumulation on the event, no reload: 120 t/h is a tonne every 30 s, so give it two.
        await expect.poll(async () => (await panelFigures(page)).mined, { timeout: 75_000, intervals: [2_000] }).toBeGreaterThan(first.mined);

        // After a reload the bar is still the elapsed fraction.
        await page.reload();
        await page.waitForURL(/\/\?account=|\/$/);
        await openTab(page, "station");
        const reloaded = await panelFigures(page);
        expect(Math.abs(reloaded.width - expectedPct()), `after reload: bar ${reloaded.width}% vs ${expectedPct().toFixed(1)}%`).toBeLessThan(2);

        // The lease view's extractor panel, the other place a running cycle is shown.
        await page.click('[data-building-action="building:isa-claims-leases"]');
        const manage = page.locator('[data-action="manage-lease"], [data-lease-manage], button:has-text("Manage")').first();
        if (await manage.count()) await manage.click();
        const row = page.locator("[data-live-ex]").first();
        await expect(row).toBeVisible({ timeout: 10_000 });
        await expect(row.locator('[data-live="spent"]')).not.toContainText("est.");
        await row.scrollIntoViewIfNeeded();
        await row.screenshot({ path: path.join(SCREEN_DIR, `ab746-extractor-panel-${offset.label}-${viewport.label}.png`) });
        expect(errors).toEqual([]);
      } finally {
        child.kill();
      }
    });
  }
}
