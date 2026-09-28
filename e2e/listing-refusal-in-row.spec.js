// AB#2057: Create Listing's refusal went into one line below the whole table, off-screen once the player had scrolled
// to a row's button, so a cleared price looked like a dead click. It now appears under the button that was pressed.
// This clears the price in the first and the last row at 1280x800 and 375x812, presses Create Listing with only that
// button brought into view, and measures the refusal: inside the viewport, beside that row, and in no other row.
// Starts its own server on a seeded data directory (the create-listing-empty.spec.js pattern); screenshots go to
// e2e/screenshots/ab-2057/.
import { test, expect } from "@playwright/test";
import { openExchangePage, openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-2057");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "listing-refusal-e2e-fixture-secret-012345";

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800, mobile: false },
  { label: "375x812", width: 375, height: 812, mobile: true }
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

for (const viewport of VIEWPORTS) {
  test(`a refused listing is said beside the row that was pressed, on screen, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile
    });
    const page = await context.newPage();
    const email = `listing-refusal-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-listing-refusal-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-stocked-account.mjs", dir, email, PASSWORD], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
    });
    if (seeded.status !== 0) throw new Error(`seed-stocked-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    try {
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      await openExchangePage(page, "players"); // AB#2472: the player order books
      const rows = page.locator("#market-sell-grid tr");
      await expect(rows).toHaveCount(6);

      for (const which of ["first", "last"]) {
        const row = which === "first" ? rows.first() : rows.last();
        const item = await row.locator("[data-sell-item]").getAttribute("data-sell-item");
        const button = row.locator("[data-sell-item]");
        // Scroll only as far as the button, as a player does: the button at the viewport's bottom edge.
        await button.evaluate((el) => el.scrollIntoView({ block: "end" }));
        await row.locator("[data-sell-price]").fill("");
        await button.click();

        const status = row.locator(".exchange__row-status");
        await expect(status, `${which} row (${item})`).toHaveText(/Sell listing failed: .+/);
        await expect(status).toHaveAttribute("role", "alert");
        const box = await status.boundingBox();
        const view = page.viewportSize();
        expect(box, `${which} row's refusal has a box`).toBeTruthy();
        expect(box.y, `${which} row's refusal top`).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, `${which} row's refusal bottom, in a ${view.height}px viewport`).toBeLessThanOrEqual(view.height);
        const buttonBox = await button.boundingBox();
        expect(box.y - (buttonBox.y + buttonBox.height), "right under the button").toBeLessThan(40);
        // Said once, in that row only; the line below the table is empty.
        await expect(page.locator(".exchange__row-status--error")).toHaveCount(1);
        await expect(page.locator("#listing-status")).toHaveText("");
        await page.screenshot({ path: path.join(SHOT_DIR, `refusal-${which}-row-${viewport.label}.png`) });
      }

      // The quantity is refused the same way, in its own row, and the inputs say they are required.
      const first = rows.first();
      await expect(first.locator("[data-sell-qty]")).toHaveAttribute("required", "");
      await expect(first.locator("[data-sell-price]")).toHaveAttribute("required", "");
      await first.locator("[data-sell-price]").fill("30");
      await first.locator("[data-sell-qty]").fill("0");
      await first.locator("[data-sell-item]").evaluate((el) => el.scrollIntoView({ block: "end" }));
      await first.locator("[data-sell-item]").click();
      await expect(first.locator(".exchange__row-status")).toHaveText(/Sell listing failed: .+/);
      await expect(page.locator(".exchange__row-status--error")).toHaveCount(1);

      // A listing that goes through says so in the same place, and the refusal is gone.
      const firstItem = await first.locator("[data-sell-item]").getAttribute("data-sell-item");
      await first.locator("[data-sell-qty]").fill("5");
      await first.locator("[data-sell-price]").fill("30");
      await first.locator("[data-sell-item]").click();
      await page.locator("#trade-confirm-ok").click();
      await page.locator("#action-receipt-close").click();
      const listed = page.locator("#market-sell-grid [data-sell-status]").filter({ hasText: "Listing created" });
      await expect(listed).toHaveAttribute("data-sell-status", firstItem);
      await expect(listed).toHaveText(new RegExp(`^Listing created: 5 ${firstItem} @ .*30`));
      await expect(listed).toHaveAttribute("role", "status");
      await expect(page.locator(".exchange__row-status--error")).toHaveCount(0);
      await listed.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: path.join(SHOT_DIR, `listed-first-row-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
      await context.close();
    }
  });
}
