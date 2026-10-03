// AB#2294: the access token lives 30 minutes, and the page renews it two minutes before it lapses, with no reload and
// nothing the player sees. The page's clock is Playwright's, so half an hour passes in a moment; the server's clock
// is real, so this checks when the page renews, and tests/integration/access-token-lifetime.test.js checks the
// server's side of the expiry.
//
// Run: `npx playwright test e2e/token-renewal.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verificationToken } from "./verification.mjs";
import { gameDrawn } from "./nav.mjs"; // AB#2468: the header is a sheet on a phone

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "renewal-e2e-fixture-secret-0123456789abc";

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "1" },
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

test("an open game renews its access token two minutes before the 30 are up, and stays in the game", async ({ page }) => {
  test.setTimeout(90_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-renewal-e2e-"));
  const { child, url } = await startServer(dir);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    const email = `renewal-${Date.now()}@example.test`;
    await page.request.post(`${url}/api/auth/register`, { data: { email, password: PASSWORD, ceoName: "Renewal QA", corpName: `Renewal Corp ${Date.now()}` } });
    await page.request.post(`${url}/api/auth/verify-email`, { data: { token: await verificationToken(page.request, url, email) } });
    await page.clock.install();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${url}/login.html`);
    await page.fill("#login-email", email);
    await page.fill("#login-password", PASSWORD);
    await page.click("#credential-login-btn");
    await page.waitForURL(/\/\?account=/);
    await gameDrawn(page);

    const renewals = [];
    page.on("response", (r) => { if (r.url().endsWith("/api/auth/refresh")) renewals.push(r.status()); });
    await page.clock.fastForward("27:00");
    await new Promise((resolve) => setTimeout(resolve, 500)); // the page's own waitForTimeout runs on the installed clock
    expect(renewals, "nothing renews at 27 minutes").toEqual([]);
    await page.clock.fastForward("01:30");
    await expect.poll(() => renewals, { message: "renewed by 28.5 minutes" }).toEqual([200]);
    // The next one is scheduled from the renewed token: again 28 minutes on.
    await page.clock.fastForward("28:30");
    await expect.poll(() => renewals).toEqual([200, 200]);

    await expect(page).not.toHaveURL(/login\.html/);
    await gameDrawn(page); // AB#2468: Log Out is in the ☰ sheet on a phone
    const session = await page.evaluate(async () => (await (await import("/scripts/apiClient.js")).apiFetch("/api/auth/session")).status);
    expect(session, "a signed-in call after the renewals").toBe(200);
    await page.screenshot({ path: path.join(SCREEN_DIR, "token-renewal-still-in-game-1280x800.png") });
    expect(errors).toEqual([]);
  } finally {
    child.kill();
  }
});
