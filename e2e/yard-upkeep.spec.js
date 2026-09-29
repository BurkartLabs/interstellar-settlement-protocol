// ISP-308 (AB#2304): a corporation with three extractor yards on one lease sees, in the lease view, each yard's cycle
// cost: the first two, the starting kit, with no upkeep, and the third paying 41.67 an hour of it. Starts its own server
// on a seeded data directory (the suites-flavor.spec.js pattern). The screenshot replaces AB#2284's two-yard one.
import { test, expect } from "@playwright/test";
import { openTab, openStationOffices } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots");
const PASSWORD = "playtest-password-not-real";
const SECRET = "yard-upkeep-e2e-fixture-secret-0123456789";

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

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`the lease view shows yards 1 and 2 free of upkeep and yard 3 paying it at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(60_000);
    const email = `upkeep-qa-${Date.now()}-${width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-upkeep-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-three-yards.mjs", dir, email, PASSWORD], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
    });
    if (seeded.status !== 0) throw new Error(`seed-three-yards.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "station");
      await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
      await page.click('[data-building-action="building:isa-claims-leases"]');
      await page.click('[data-action="manage-lease"]');
      const line = (n) => page.locator(`[data-role="mine-projection"][data-for="ext-upkeep-${n}"]`);
      for (const n of [1, 2]) {
        await expect(line(n), `yard ${n}`).toContainText(/At \d+ t\/h/); // AB#2480: each opens at its own best rate
        await expect(line(n), `yard ${n}, the starting kit`).not.toContainText("upkeep");
      }
      await expect(line(3)).toContainText("including ¤41.67/hour upkeep, paid by every yard after your first two");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await line(3).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `ab2304-three-yards-${width}x${height}.png`), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
