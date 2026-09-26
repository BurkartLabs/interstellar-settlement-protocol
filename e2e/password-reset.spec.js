// AB#988 (ISP-281): from the login page's "Forgot your password?" to a reset link in the test transport's outbox, the
// set-new-password page, and a login with the new password. Starts its own server with the dev surface on, because
// the outbox is readable only there (GET /api/dev/outbox). Screenshots at 375x812 and 1280x800.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const SECRET = "password-reset-e2e-secret-0123456789abcd";
const OLD_PASSWORD = "playtest-password-not-real";
const NEW_PASSWORD = "a-new-playtest-password";

function startServer(dir, port) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    // PORT is fixed per run so ISP_PUBLIC_URL can name it: links are built from the configured URL, never the Host.
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

/** The primary fill as the stylesheet defines it: a fresh button, never hovered and with nothing to transition. */
const primaryFill = (page) => page.evaluate(() => {
  const probe = document.createElement("button");
  probe.className = "ui-button ui-button--primary";
  document.body.append(probe);
  const fill = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return fill;
});

const VIEWPORTS = [
  { label: "375x812", width: 375, height: 812, port: 38861 },
  { label: "1280x800", width: 1280, height: 800, port: 38862 }
];

for (const vp of VIEWPORTS) {
  test(`forgot password, follow the link, set a new one, log in with it, at ${vp.label}`, async ({ page, request }) => {
    test.setTimeout(60_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-password-reset-e2e-"));
    const { child, url } = await startServer(dir, vp.port);
    try {
      const email = `reset-${Date.now()}@example.test`;
      const reg = await request.post(`${url}/api/auth/register`, { data: { email, password: OLD_PASSWORD, ceoName: "Playtest CEO", corpName: `Reset Corp ${Date.now()}` } });
      expect(reg.status()).toBe(201);

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${url}/login.html`);
      await page.screenshot({ path: path.join(SCREEN_DIR, `login-forgot-link-${vp.label}.png`) });
      await page.click("#forgot-password-link");
      await expect(page).toHaveURL(`${url}/forgot-password.html`);
      await page.fill("#forgot-email", email);
      await page.click("#forgot-btn");
      await expect(page.locator("#forgot-status")).toHaveText("If that address has an account, a link to reset its password is on its way. It works for one hour.");
      await page.screenshot({ path: path.join(SCREEN_DIR, `forgot-password-${vp.label}.png`) });

      const { messages } = await (await request.get(`${url}/api/dev/outbox`)).json();
      const link = messages.filter((m) => m.to === email).at(-1)?.text.match(/https?:\/\/\S+#token=[A-Za-z0-9_-]+/)?.[0];
      expect(link, "a reset link in the outbox").toBeTruthy();
      expect(link.startsWith(`${url}/reset-password.html#token=`)).toBe(true);

      await page.goto(link);
      await page.fill("#reset-password", NEW_PASSWORD);
      await page.fill("#reset-confirm", NEW_PASSWORD);
      await page.screenshot({ path: path.join(SCREEN_DIR, `reset-password-${vp.label}.png`) });
      await page.click("#reset-btn");
      await expect(page.locator("#reset-title")).toHaveText("Your password is changed");
      await expect(page).toHaveURL(`${url}/reset-password.html`); // the spent token is out of the address bar
      await page.mouse.move(0, 0); // AB#765: the form hides and Log In can move under the pointer; read the resting fill
      await expect(page.locator("#reset-login")).toHaveCSS("background-color", await primaryFill(page));
      await page.screenshot({ path: path.join(SCREEN_DIR, `password-changed-${vp.label}.png`) });

      // The owner is told, and only the new password logs in.
      const after = (await (await request.get(`${url}/api/dev/outbox`)).json()).messages.filter((m) => m.to === email);
      expect(after.at(-1).subject).toBe("Your password was changed");
      expect((await request.post(`${url}/api/auth/login`, { data: { email, password: OLD_PASSWORD } })).status()).toBe(401);
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", NEW_PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=|\/$/);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
