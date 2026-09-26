// ISP-302 (AB#2285): the Exchange's rate breakdown shows the ISA lease royalty as its own line. A corporation holding 3
// leases (10%: 8% sales tax and 2% royalty) sells Silicates to the standing buy order, and the confirmation lists
// both lines with what the seller receives; one holding 1 lease shows no royalty line. Starts its own server with
// the corporation seeded by e2e/seed-leased-account.mjs.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const SECRET = "lease-royalty-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" },
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

async function openSellConfirmation(page, leases, viewport) {
  const email = `royalty-${leases}-${Date.now()}@example.test`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-lease-royalty-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-leased-account.mjs", dir, email, PASSWORD, String(leases)], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-leased-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
  const { child, url } = await startServer(dir);
  await page.setViewportSize(viewport);
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await page.waitForURL(/\/\?account=/);
  // The navigation is grouped (AB#764): on a phone the Market group opens first, as a player taps it.
  const exchangeTab = page.locator('.nav-tab[data-tab="market"]');
  if (!(await exchangeTab.isVisible())) await page.click('.nav-group__button[data-group="market"]');
  await exchangeTab.click();
  const row = page.locator("#npc-buy-table tr", { has: page.locator('[data-npc-item="Silicates"]') }).first();
  await row.locator("[data-npc-sell-qty]").fill("100");
  await row.locator(".npc-sell-btn").click();
  return { child };
}

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

for (const vp of VIEWPORTS) {
  test(`at 3 leases the sell confirmation shows the royalty as its own line, at ${vp.label}`, async ({ page }) => {
    test.setTimeout(90_000);
    const { child } = await openSellConfirmation(page, 3, { width: vp.width, height: vp.height });
    try {
      const dialog = page.locator("#trade-confirm-modal");
    await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("GEX Sales Tax (8%)");
      await expect(dialog).toContainText("ISA Lease Royalty (2%)");
      await expect(dialog).toContainText("You Receive");
      await page.screenshot({ path: path.join(SCREEN_DIR, `lease-royalty-sell-3-leases-${vp.label}.png`) });
    } finally {
      child.kill();
    }
  });
}

test("at 1 lease the sell confirmation has no royalty line", async ({ page }) => {
  test.setTimeout(90_000);
  const { child } = await openSellConfirmation(page, 1, { width: 375, height: 812 });
  try {
    const dialog = page.locator("#trade-confirm-modal");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("GEX Sales Tax (8%)");
    await expect(dialog).not.toContainText("Royalty");
    await page.screenshot({ path: path.join(SCREEN_DIR, "lease-royalty-sell-1-lease-375x812.png") });
  } finally {
    child.kill();
  }
});
