// ISP-254 slice C1b (AB#4821): the conglomerate's pooled assets in protocol language, in the running game at 1280x800.
// A founder's treasury deposit refused for want of credits (Unfunded, with how much it can deposit); a large
// withdrawal announced (Filed, awaiting review, on its line and in the announced list); a station project filed
// (Lodged) and a contribution over what it needs (Denied, with how much it takes); and a stakeholder's vote, open
// (Filed, awaiting review) and then carried (In force). Seeded by e2e/seed-construction-account.mjs; nothing is mocked.
// Shots go to e2e/screenshots/ab-4821/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-4821");
const PASSWORD = "playtest-password-not-real";
const SECRET = "pooled-protocol-e2e-fixture-secret-012345";

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

async function session(browser, kind) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const email = `${kind}-${Date.now()}@example.test`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `isp-${kind}-pooled-e2e-`));
  const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, kind], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-construction-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
  const { child, url } = await startServer(dir);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\?account=/);
  const tab = async (name) => {
    await openTab(page, "conglomerate");
    await page.locator(`[data-role="cong-tab"][data-tab="${name}"]`).click();
  };
  return { page, errors, tab, done: async () => { await context.close(); child.kill(); } };
}
const shot = (locator, name) => locator.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });

test("the treasury and a station project carry the protocol line, at 1280", async ({ browser }) => {
  test.setTimeout(150_000);
  const s = await session(browser, "cg-start");
  const { page } = s;
  try {
    // 1. a deposit of more than the corporation holds: Unfunded, and how much it can deposit
    await s.tab("treasury");
    const treasury = page.locator('[data-role="cong-treasury"]');
    await page.fill("#cong-deposit-amount", "99,000,000");
    await page.locator('[data-role="cong-treasury-deposit"] button[type="submit"]').click();
    await page.locator("#trade-confirm-ok").click();
    const depositLine = page.locator('[data-role="cong-treasury-deposit-status"]');
    await expect(depositLine).toContainText(/it cannot deposit 99,000,000\. Deposit [\d,]+ or less\./);
    await expect(depositLine.locator(".protocol-line")).toContainText("Unfunded, balance insufficient");
    await treasury.scrollIntoViewIfNeeded();
    await shot(treasury, "1-treasury-deposit-unfunded");

    // 2. a withdrawal over the notice line, within today's cap: announced, Filed, awaiting review
    const balance = Number((await page.locator('[data-role="cong-treasury-balance"]').textContent()).replace(/[^\d]/g, ""));
    await page.fill("#cong-withdraw-amount", String(Math.floor(balance * 0.15)));
    await page.locator('[data-role="cong-treasury-withdraw"] button[type="submit"]').click();
    await page.locator("#trade-confirm-ok").click();
    const withdrawLine = page.locator('[data-role="cong-treasury-withdraw-status"]');
    await expect(withdrawLine).toContainText("Announced.");
    await expect(withdrawLine.locator(".protocol-line")).toContainText("Filed, awaiting review");
    await expect(treasury.locator(".cong-list .protocol-line").first()).toContainText("Filed, awaiting review");
    await treasury.scrollIntoViewIfNeeded();
    await shot(treasury, "2-treasury-withdrawal-announced");

    // 3. a station project filed: Lodged, on the form's line and beside the project's state
    await s.tab("station");
    await page.selectOption("#cong-station-site", "sol|Venus");
    await page.selectOption("#cong-station-name", "3");
    await page.locator('[data-role="cong-station-none"]').getByRole("button", { name: "File the station project" }).click();
    await page.locator("#trade-confirm-ok").click();
    const project = page.locator('[data-role="cong-station-project"]');
    await expect(project.locator(".station__overline .protocol-line")).toContainText("Lodged");
    await expect(page.locator('[data-role="cong-station-start-status"], [data-role="cong-station-project"]').first()).toBeVisible();
    // the head, scrolled clear of the sticky page header, then clipped to it (a tall panel's element shot sits under it)
    const head = project.locator(".cong-station__head");
    await head.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 200));
    const box = await head.boundingBox();
    await page.screenshot({ path: path.join(SHOT_DIR, "3-station-project-lodged.png"), clip: { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 } });

    // 4. more credits than the project needs: Denied, and how much it takes
    await page.fill("#cong-give-credits", "2,000,001");
    await page.locator('[data-role="cong-station-give"][data-source="own"] button[type="submit"]').click();
    await page.locator("#trade-confirm-ok").click();
    const giveLine = page.locator('[data-role="cong-station-give-own-status"]');
    await expect(giveLine).toContainText("more credits. Put in 2,000,000 or less.");
    await expect(giveLine.locator(".protocol-line")).toContainText("Denied");
    await page.locator('[data-role="cong-station-give"][data-source="own"]').scrollIntoViewIfNeeded();
    await shot(page.locator('[data-role="cong-station-give"][data-source="own"]'), "4-contribution-denied");
    expect(s.errors).toEqual([]);
  } finally {
    await s.done();
  }
});

test("a stake vote, open and then carried, carries the protocol line, at 1280", async ({ browser }) => {
  test.setTimeout(150_000);
  const s = await session(browser, "cg-gov");
  const { page } = s;
  try {
    await s.tab("station");
    const proposal = page.locator('[data-role="cong-proposal"]');
    await expect(proposal.locator(".protocol-line")).toContainText("Filed, awaiting review");
    const governance = page.locator('[data-role="cong-station-governance"]');
    await proposal.scrollIntoViewIfNeeded();
    await shot(governance, "5-vote-open");
    await proposal.getByRole("button", { name: "Vote yes" }).click();
    const voteLine = page.locator('[data-role="cong-vote-status"]');
    await expect(voteLine).toContainText("Your vote carried it");
    await expect(voteLine.locator(".protocol-line")).toContainText("In force");
    await expect(governance).toContainText("Recent votes");
    await governance.scrollIntoViewIfNeeded();
    await shot(governance, "6-vote-carried");
    expect(s.errors).toEqual([]);
  } finally {
    await s.done();
  }
});
