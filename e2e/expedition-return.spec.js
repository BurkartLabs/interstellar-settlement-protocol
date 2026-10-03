// AB#1295: the Expedition Complete notification, as a player reads it in the bell, names the belt, its system and the
// deposit station, not "belt" and "earth-station-prime". Starts its own server on a seeded data dir
// (e2e/seed-expedition-account.mjs): an Alpha Centauri expedition that finishes seconds after start.
//
// Run: npx playwright test e2e/expedition-return.spec.js (no server needed).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { toggleNotifications } from "./nav.mjs"; // AB#2468: the header is a sheet on a phone

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "expedition-e2e-fixture-secret-0123456789ab";

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

for (const vp of [{ label: "1280x800", width: 1280, height: 800 }, { label: "375x812", width: 375, height: 812 }]) {
  test(`the Expedition Complete notification names places, at ${vp.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-expedition-e2e-"));
    const email = `expedition-${Date.now()}-${vp.width}@example.test`;
    execFileSync(process.execPath, ["e2e/seed-expedition-account.mjs", dir, email, PASSWORD], {
      cwd: REPO_ROOT, env: { ...process.env, JWT_SECRET: SECRET }
    });
    const { child, url } = await startServer(dir);
    try {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/(\?|$)/);

      // The expedition tick runs every 10 seconds; the notification arrives over the socket into the open list.
      // (Registering and signing in leave notifications of their own, so the badge alone proves nothing.)
      await toggleNotifications(page);
      const item = page.locator("#notification-list li", { hasText: "Expedition Complete" }).first();
      await expect(item).toBeVisible({ timeout: 30_000 });
      const text = await item.innerText();
      expect(text).toContain("returned from the Centauri Belt (Alpha Centauri)");
      expect(text).toMatch(/deposited at [A-Z]/);
      expect(text).not.toMatch(/ac-belt|alpha-centauri|-station|-dock|-orbital/);
      await page.screenshot({ path: path.join(SCREEN_DIR, `expedition-return-${vp.label}.png`) });
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
