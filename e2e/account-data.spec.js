// ISP-264 (AB#960): a player downloads its data and deletes its account, from the running app, and the other side of its
// mail sees what is left. e2e/seed-v012-play.mjs makes two players (A, Orion Survey Company; B, Brightwater Haulage);
// A has written to B. A opens Account, downloads its data (the file is read here and checked), starts a deletion,
// is refused once for a wrong password, then deletes with its password and DELETE, and is signed out; its login no
// longer works. B then opens the conversation: A's message is erased and A is "Anonymised corporation".
// At 1280x800 and 375x812; screenshots go to e2e/screenshots/ab-960/.
import { test, expect } from "@playwright/test";
import { gameDrawn, openTab, pressHeader } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-960");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "construction-panel-e2e-fixture-secret-0123";
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
async function signIn(browser, url, viewport, email) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\?account=/);
  return { context, page, errors };
}
const shot = (page, name, viewport) => page.screenshot({ path: path.join(SHOT_DIR, `${name}-${viewport.label}.png`) });

for (const viewport of VIEWPORTS) {
  test(`download your data, delete your account, and what the other side sees, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-account-data-e2e-"));
    const emailA = `a-${Date.now()}-${viewport.width}@example.test`, emailB = `b-${Date.now()}-${viewport.width}@example.test`;
    const env = { ...process.env, JWT_SECRET: SECRET };
    let r = spawnSync(process.execPath, ["e2e/seed-v012-play.mjs", dir, emailA, emailB, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env });
    if (r.status !== 0) throw new Error(`seed failed: ${r.stdout}\n${r.stderr}`);
    // A writes to B
    r = spawnSync(process.execPath, ["--input-type=module", "-e", `
      process.env.ISP_DATA_DIR = ${JSON.stringify(dir)}; process.env.NODE_ENV = "test";
      const store = await import("./server/gameState.js");
      const { accountsStore } = await import("./server/game/store.js");
      const { sendConversationMessage } = await import("./server/game/conversations.js");
      const find = (email) => Object.values(accountsStore.accounts).find((x) => x.email === email);
      const a = find(${JSON.stringify(emailA)}), b = find(${JSON.stringify(emailB)});
      const sent = sendConversationMessage(a.id, { toCorpId: b.state.corp.publicId, body: "Our private offer: Silicates at 40 a tonne, delivered to Earth." });
      if (sent.error) throw new Error(sent.error);
      await store.saveAccountsNow();`], { cwd: REPO_ROOT, encoding: "utf8", env });
    if (r.status !== 0) throw new Error(`setup failed: ${r.stdout}\n${r.stderr}`);
    const { child, url } = await startServer(dir);
    try {
      // A: the Account dialog, and the download
      let s = await signIn(browser, url, viewport, emailA);
      let page = s.page;
      await gameDrawn(page);
      await pressHeader(page, "#account-data-btn");
      const modal = page.locator("#account-data-modal");
      await expect(modal).toBeVisible();
      await shot(page, "account-dialog", viewport);
      const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#account-export-btn").click()]);
      expect(download.suggestedFilename()).toMatch(/^isp-account-data-\d{4}-\d{2}-\d{2}\.json$/);
      const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
      expect(exported.data["accounts-snapshot.json"].account.email).toBe(emailA);
      expect(exported.data["accounts-snapshot.json"].account.passwordHash).toBeUndefined();
      expect(exported.corporation.name).toBe("Orion Survey Company");
      expect(JSON.stringify(exported.data.messages)).toContain("Our private offer");
      await expect(page.locator("#account-export-status")).toContainText(/Saved isp-account-data-/);
      await shot(page, "export-saved", viewport);

      // A: the deletion, refused once, then done
      await page.locator("#account-delete-start").click();
      await expect(page.locator("#account-delete-form")).toBeVisible();
      await expect(page.locator("#account-delete-submit")).toBeDisabled();
      await page.fill("#account-delete-password", "not-the-password-1");
      await page.fill("#account-delete-confirm", "DELETE");
      await expect(page.locator("#account-delete-submit")).toBeEnabled();
      await page.locator("#account-delete-submit").click();
      await expect(page.locator("#account-delete-error")).toHaveText("That password is not correct. Nothing was deleted.");
      await shot(page, "delete-refused", viewport);
      await page.fill("#account-delete-password", PASSWORD);
      await shot(page, "delete-confirm", viewport);
      await page.locator("#account-delete-submit").click();
      await expect(modal.locator('[data-step="done"]')).toBeVisible();
      await shot(page, "deleted", viewport);
      await page.locator("#account-deleted-leave").click();
      await page.waitForURL((u) => !/\?account=/.test(u.href), { timeout: 15_000 }); // signed out, to the landing page
      // its login no longer works
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", emailA);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await expect(page.locator("#login-form")).toBeVisible();
      await page.waitForTimeout(800);
      expect(page.url()).not.toMatch(/\?account=/);
      await shot(page, "login-after-delete", viewport);
      expect(s.errors).toEqual([]);
      await s.context.close();

      // B: the conversation, with A's words erased and A anonymised
      s = await signIn(browser, url, viewport, emailB);
      page = s.page;
      await openTab(page, "inbox");
      await page.locator('#inbox-subtab-nav [data-subtype="players"]').click();
      const row = page.locator("#inbox-conversation-list [data-conv-id]").first();
      await expect(row).toContainText("Anonymised corporation");
      await row.click();
      await expect(page.locator("#inbox-thread-view")).toBeVisible();
      await expect(page.locator("#thread-messages li").first()).toContainText("This message was deleted with its sender's account.");
      await expect(page.locator("#inbox-thread-view")).not.toContainText("Our private offer");
      await shot(page, "other-side-conversation", viewport);
      expect(s.errors).toEqual([]);
      await s.context.close();
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
