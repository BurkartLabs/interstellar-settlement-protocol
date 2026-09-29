// AB#2288 (ISP-305): the verification gate as a new player meets it. Register, try to log in before verifying and be
// told to check your email with a resend action beside it, follow that action, open the link from the mail, then log
// in and land in the game. Starts its own server with the dev surface on, so the test transport's outbox can be read
// (GET /api/dev/outbox); ISP_PUBLIC_URL names its port, so the link in the mail is the one a player would open.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const SECRET = "verification-gate-e2e-secret-0123456789";
const PASSWORD = "playtest-password-not-real";

function startServer(dir, port) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: String(port), NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "1", ISP_PUBLIC_URL: `http://127.0.0.1:${port}` },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => {
      out += chunk;
      if (/listening on port \d+/.test(out)) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}

const VIEWPORTS = [
  { label: "375x812", width: 375, height: 812, port: 38971 },
  { label: "1280x800", width: 1280, height: 800, port: 38972 }
];

for (const vp of VIEWPORTS) {
  test(`register, be refused until verified, verify, log in, at ${vp.label}`, async ({ page }) => {
    test.setTimeout(90_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-verification-gate-e2e-"));
    const { child, url } = await startServer(dir, vp.port);
    try {
      const stamp = Date.now();
      const email = `gate-${stamp}@example.test`;
      await page.setViewportSize({ width: vp.width, height: vp.height });

      await page.goto(`${url}/register.html`);
      await page.fill("#register-email", email);
      await page.fill("#register-password", PASSWORD);
      await page.fill("#register-ceo", "Gate CEO");
      await page.fill("#register-corp", `Gate Corp ${stamp}`);
      await page.click('#register-form button[type="submit"]');
      await page.waitForURL(`${url}/check-email.html`);
      await page.screenshot({ path: path.join(SCREEN_DIR, `gate-after-register-${vp.label}.png`) });

      // A real login attempt before verifying: refused, with the resend action beside the message.
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      const status = page.locator("#login-status");
      await expect(status).toContainText("Check your email to verify your account.");
      await expect(status.locator("a")).toHaveText("Send a new link.");
      await expect(page).toHaveURL(`${url}/login.html`);
      await page.screenshot({ path: path.join(SCREEN_DIR, `gate-login-refused-${vp.label}.png`) });

      await status.locator("a").click();
      await page.waitForURL(`${url}/check-email.html`);
      await expect(page.locator("#check-email-title")).toHaveText(/Check your email to verify your account\.$/); // AB#943: after its document code
      await page.screenshot({ path: path.join(SCREEN_DIR, `gate-check-email-${vp.label}.png`) });

      // The link from the mail, opened as a player opens it.
      const { messages } = await (await page.request.get(`${url}/api/dev/outbox`)).json();
      const link = messages.filter((m) => m.to === email).at(-1)?.text.match(/https?:\/\/\S+#token=[A-Za-z0-9_-]+/)?.[0];
      expect(link?.startsWith(`${url}/verify-email.html#token=`)).toBe(true);
      await page.goto(link);
      await page.click("#verify-btn");
      await expect(page.locator("#verify-title")).toHaveText("Your email is verified");
      await page.screenshot({ path: path.join(SCREEN_DIR, `gate-verified-${vp.label}.png`) });

      await page.click("#verify-login");
      await page.waitForURL(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      await expect(page.locator("#logout-btn")).toBeVisible({ timeout: 20_000 });
      await page.screenshot({ path: path.join(SCREEN_DIR, `gate-in-the-game-${vp.label}.png`) });
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
