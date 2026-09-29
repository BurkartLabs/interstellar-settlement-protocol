// ISP-287 (AB#994): a building a raid damaged, and repairing it, from the running app. e2e/seed-building-repair.mjs
// leaves a raid on a defender's Earth buildings arrived but unfought; the running server's raid tick fights it. The
// defender then sees its Station's Damaged Buildings: the Refinery at 80 (repair 2,000, which it can pay) and the
// Orbital Shipyard at the floor, 50 (repair 7,500, which it cannot, so the button is disabled with the reason). It
// repairs the Refinery. At 1440x900 and 390x844; screenshots go to e2e/screenshots/ab-994/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import { acknowledgeReceipt } from "./receipt.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-994");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "building-repair-fixture-secret-0123456789ab";
const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900, mobile: false },
  { label: "390x844", width: 390, height: 844, mobile: true }
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
  test(`a raid's damage and its repair at the Station, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-repair-e2e-"));
    const r = spawnSync(process.execPath, ["e2e/seed-building-repair.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (r.status !== 0) throw new Error(`seed failed: ${r.stdout}\n${r.stderr}`);
    const { defender } = JSON.parse(r.stdout.trim().split("\n").at(-1));
    const { child, url } = await startServer(dir);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", defender);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\?account=/);
      // the server's raid tick runs every 30 seconds: wait for it to have fought the raid
      await expect.poll(async () => page.evaluate(async () => {
        const { apiFetch } = await import("/scripts/apiClient.js");
        const { appState } = await import("/scripts/state.js");
        if (!appState.accountId) return "not signed in yet";
        const res = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/building-repairs`);
        return res.ok ? (await res.json()).buildings.length : `HTTP ${res.status}`;
      }), { timeout: 60_000, intervals: [2_000] }).toBe(2);
      await page.goto(page.url(), { waitUntil: "domcontentloaded" }); // the page's state from after the battle
      await openTab(page, "station");
      const section = page.locator("#station-repairs-section");
      await expect(section).toBeVisible();
      const card = (name) => section.locator("[data-role=repair-card]", { hasText: name });
      await expect(card("Refinery").locator("[data-role=repair-condition]")).toHaveText("80 of 100");
      await expect(card("Refinery").locator("[data-role=repair-output]")).toHaveText("80% until repaired");
      await expect(card("Refinery").locator("[data-role=repair-cost]")).toHaveText("¤2,000");
      await expect(card("Refinery").locator("button[data-repair-building]")).toBeEnabled();
      await expect(card("Orbital Shipyard").locator("[data-role=repair-condition]")).toHaveText("50 of 100");
      await expect(card("Orbital Shipyard").locator("[data-role=repair-cost]")).toHaveText("¤7,500");
      await expect(card("Orbital Shipyard").locator("button[data-repair-building]")).toBeDisabled();
      await expect(card("Orbital Shipyard")).toContainText("Needs ¤7,500; you have ¤5,000.");
      await section.locator("h3").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: path.join(SHOT_DIR, `damaged-buildings-${viewport.label}.png`) });
      if (viewport.mobile) { // the second card, below the first on a phone: the repair it cannot pay for
        await card("Orbital Shipyard").evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.screenshot({ path: path.join(SHOT_DIR, `damaged-shipyard-${viewport.label}.png`) });
      }

      // repair the Refinery: confirm at the server's price, and the receipt
      await card("Refinery").locator("button[data-repair-building]").click();
      const confirm = page.getByRole("dialog");
      await expect(confirm).toContainText("Repair the Refinery to full condition?");
      await expect(confirm).toContainText("Condition 80 → 100; output 80% → 100%");
      await page.screenshot({ path: path.join(SHOT_DIR, `repair-confirm-${viewport.label}.png`) });
      await confirm.getByRole("button", { name: /Repair \(¤2,000\)/ }).click();
      const receipt = page.locator("#action-receipt-modal");
      await expect(receipt).toBeVisible();
      await expect(receipt).toContainText("Building Repaired");
      await expect(receipt).toContainText("Refinery, from condition 80 to 100.");
      await page.screenshot({ path: path.join(SHOT_DIR, `repair-receipt-${viewport.label}.png`) });
      await acknowledgeReceipt(page);
      await expect(card("Refinery")).toHaveCount(0);
      await expect(card("Orbital Shipyard").locator("button[data-repair-building]")).toBeDisabled();
      await expect(card("Orbital Shipyard")).toContainText("Needs ¤7,500; you have ¤3,000.");
      await page.screenshot({ path: path.join(SHOT_DIR, `after-repair-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
