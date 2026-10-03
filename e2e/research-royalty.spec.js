// Bug #4857: queuing research another corporation had patented said nothing of the royalty; it was taken at completion
// unannounced. Bright here (e2e/seed-patented-research.mjs) may queue Fusion Fuel Cycle, which Orion patented at 1%: the
// card must name the royalty before Bright queues it, and the "Research Queued" receipt after. Screenshots of both at 1280
// and 375 go to e2e/screenshots/bug-4857/ (SHOT_LABEL names them; "before" was taken on main's code for the pull request).
//
// Run: `npx playwright test e2e/research-royalty.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gameDrawn, openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "bug-4857");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const LABEL = process.env.SHOT_LABEL || "after";
const PASSWORD = "playtest-password-not-real";
const SECRET = "research-royalty-e2e-fixture-secret-0123";

// each width gets its own world, since queuing the node changes it
async function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-research-royalty-e2e-"));
  const run = spawnSync(process.execPath, ["e2e/seed-patented-research.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (run.status !== 0) throw new Error(`seed failed: ${run.stdout}\n${run.stderr}`);
  const seeded = JSON.parse(run.stdout.trim().split("\n").at(-1));
  const server = spawn(process.execPath, ["server/index.js"], { cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
  return { seeded, server, url };
}

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`the research card and its receipt name the royalty on a patented node, at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(90_000);
    const { seeded, server, url } = await world();
    try {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", seeded.user);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await gameDrawn(page);

      await openTab(page, "rnd");
      const card = page.locator(`#research-node-${seeded.node}`);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState("networkidle"); // the patent register, which the card quotes
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await card.screenshot({ path: path.join(SHOT_DIR, `card-${LABEL}-${width}.png`), animations: "disabled" });
      const cardText = await card.innerText();

      await card.locator(".research__enqueue").click();
      await expect(page.locator("#action-receipt-title")).toHaveText("Research Queued", { timeout: 10_000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOT_DIR, `receipt-${LABEL}-${width}.png`), animations: "disabled" });

      expect(cardText).toMatch(/Patented by Orion Holdings \w+: 1% royalty, 120 credits, charged when the research completes/);
      await expect(page.locator("#action-receipt-body")).toContainText(/Patent royalty\s*120 credits to Orion Holdings \w+ \(1% of the research cost\), charged when it completes/);
    } finally {
      server.kill();
    }
  });
}
