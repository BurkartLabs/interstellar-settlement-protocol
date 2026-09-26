// Bug AB#2338: a Corporate R&D card whose node needs a higher corporation level is locked, saying the level it needs
// and the corporation's own, and offers no Enqueue; at the level it offers Enqueue and the server takes it. A Level 5
// corporation with Tier 1 and Near-Star Navigation Array done looks at Deep-Star Cartography Suite (Level 10).
// Screenshots go to e2e/screenshots/ab-2338/. Starts its own server on a seeded data directory.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2338");
const PASSWORD = "playtest-password-not-real";
const SECRET = "research-e2e-fixture-secret-0123456789abcd";
const PREREQS = "tt-fleet-coordination,tt-proxima-navigation";

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

for (const [level, width, height] of [[5, 1280, 800], [5, 375, 812], [10, 1280, 800]]) {
  test(`Deep-Star Cartography Suite's card at corporation level ${level}, ${width}x${height}`, async ({ page }) => {
    test.setTimeout(60_000);
    const email = `research-${Date.now()}-${level}-${width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-research-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-research-account.mjs", dir, email, PASSWORD, String(level), PREREQS], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
    });
    if (seeded.status !== 0) throw new Error(`seed-research-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    try {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "rnd");
      const card = page.locator(".research__node", { has: page.locator(".ui-card__title", { hasText: /^Deep-Star Cartography Suite$/ }) });
      await expect(card).toBeVisible();
      if (level < 10) {
        await expect(card).toContainText(`Requires Corporation Level 10 (you are level ${level})`);
        await expect(card.locator(".research__enqueue")).toHaveCount(0);
      } else {
        await card.locator(".research__enqueue").click();
        await expect(page.locator("#rnd-queue")).toContainText("Deep-Star Cartography Suite");
      }
      await card.scrollIntoViewIfNeeded();
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOT_DIR, `deep-star-level-${level}-${width}x${height}.png`) });
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
