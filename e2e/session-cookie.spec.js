// AB#757: login tokens are out of localStorage. A real browser signs in through the login page, reloads the game and
// is still signed in (the page refreshes from its HttpOnly cookie), finds no token in web storage or document.cookie,
// then logs out and is sent to the login page on the next load. Secure cookies over http work here only because the
// browser treats 127.0.0.1 as a secure context; that is the local setup, and production is https.
//
// Run: `npx playwright test e2e/session-cookie.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verificationToken, verifyAndLogIn } from "./verification.mjs";
import { gameDrawn, pressHeader } from "./nav.mjs"; // AB#2468: the header is a sheet on a phone

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "session-e2e-fixture-secret-0123456789ab";

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

const storedTokens = (page) => page.evaluate(() => {
  const all = { ...Object.fromEntries(Object.entries(localStorage)), ...Object.fromEntries(Object.entries(sessionStorage)) };
  return Object.entries(all).filter(([k, v]) => /token/i.test(k) || /^eyJ/.test(String(v)));
});

test("sign in, reload and stay signed in, with no token a script can read; log out and the session is gone", async ({ page, context }) => {
  test.setTimeout(90_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-session-e2e-"));
  const { child, url } = await startServer(dir);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const email = `session-qa-${Date.now()}@example.test`;

  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Register through the real page, so the cookie is set the way a player's is.
    await page.goto(`${url}/register.html`);
    await page.fill("#register-email", email);
    await page.fill("#register-password", PASSWORD);
    const confirm = page.locator("#register-confirm-password, #register-password-confirm");
    if (await confirm.count()) await confirm.first().fill(PASSWORD);
    await page.fill("#register-ceo", "Session QA");
    await page.fill("#register-corp", `Session QA Corp ${Date.now()}`);
    await page.click('#register-form button[type="submit"]');
    await verifyAndLogIn(page, url, email, PASSWORD); // AB#2288: verify, then log in, which is where the cookie is set
    await page.waitForURL(/\/\?account=/);
    await gameDrawn(page);

    const cookies = await context.cookies();
    const refresh = cookies.find((c) => c.name === "isp_refresh");
    expect(refresh, "the browser kept the refresh cookie").toBeTruthy();
    expect(refresh).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/api/auth" });
    expect(await page.evaluate(() => document.cookie)).not.toContain("isp_refresh");
    expect(await storedTokens(page)).toEqual([]);

    // A reload holds no token in memory: the page must get one from the cookie and come back signed in.
    await page.reload();
    await gameDrawn(page);
    await expect(page).toHaveURL(/\/\?account=|\/$/);
    expect(await storedTokens(page)).toEqual([]);
    await page.screenshot({ path: path.join(SCREEN_DIR, "ab757-signed-in-after-reload-1280x800.png") });

    await pressHeader(page, "#logout-btn");
    await expect.poll(async () => (await context.cookies()).some((c) => c.name === "isp_refresh")).toBe(false);
    await page.goto(`${url}/`);
    await page.waitForURL(/\/login\.html|\/$/);
    await expect(page.locator("#logout-btn")).toBeHidden();
    await page.screenshot({ path: path.join(SCREEN_DIR, "ab757-after-logout-reload-1280x800.png") });
    expect(errors).toEqual([]);
  } finally {
    child.kill();
  }
});

// A player who last signed in on a build before AB#757 has tokens in localStorage and no cookie. The page must not
// use them: it wipes them and asks the player to log in once more.
test("a browser holding tokens from an older build is asked to log in once, and the old tokens are wiped", async ({ page }) => {
  test.setTimeout(60_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-session-legacy-e2e-"));
  const { child, url } = await startServer(dir);
  try {
    const email = `legacy-qa-${Date.now()}@example.test`;
    await fetch(`${url}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, ceoName: "Legacy QA", corpName: `Legacy QA Corp ${Date.now()}` })
    });
    // AB#2288: registering gives no session; verify, then log in for the account and token an older build stored.
    await page.request.post(`${url}/api/auth/verify-email`, { data: { token: await verificationToken(page.request, url, email) } });
    const reg = await (await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD })
    })).json();
    await page.goto(`${url}/login.html`);
    await page.evaluate((r) => {
      localStorage.setItem("isp.accountId", r.account.id);
      localStorage.setItem("isp.accessToken", r.accessToken);
      localStorage.setItem("isp.refreshToken", "an-old-build-refresh-token");
    }, reg);

    await page.goto(`${url}/?account=${reg.account.id}`);
    await page.waitForURL(/\/login\.html\?reason=expired/);
    await expect(page.locator("#login-status")).toContainText(/session expired/i);
    expect(await storedTokens(page)).toEqual([]);
    await page.screenshot({ path: path.join(SCREEN_DIR, "ab757-older-build-asked-to-log-in-1280x800.png") });
  } finally {
    child.kill();
  }
});
