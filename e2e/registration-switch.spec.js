// AB#781: registration is open to anyone with no invitation, and REGISTRATION_OPEN=false closes it. Starts its own
// server each way (the register-rate-limit.spec.js pattern) and looks at register.html as a stranger meets it: open,
// where a registration goes through, and closed, where the page says so instead of "failed on our side".
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "registration-switch-e2e-secret-0123456789";

function startServer(dir, env) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ...env },
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

async function withServer(env, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-registration-switch-e2e-"));
  const { child, url } = await startServer(dir, env);
  try {
    await fn(url);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function fill(page, stamp) {
  await page.fill("#register-email", `switch-${stamp}@example.test`);
  await page.fill("#register-password", PASSWORD);
  await page.fill("#register-ceo", "Playtest CEO");
  await page.fill("#register-corp", `Switch Corp ${stamp}`);
}

test.use({ viewport: { width: 375, height: 812 } });

test("open: a stranger registers with no invitation", async ({ page }) => {
  test.setTimeout(60_000);
  await withServer({}, async (url) => {
    await page.goto(`${url}/register.html`);
    await expect(page.locator("#register-form")).toBeVisible();
    await expect(page.locator("#register-form")).not.toContainText(/invit/i);
    await fill(page, `${Date.now()}-open`);
    await page.screenshot({ path: path.join(SCREEN_DIR, "registration-open-375x812.png") });
    await page.click('#register-form button[type="submit"]');
    // AB#2288: registering now lands on "Check your email"; the account plays once the link is followed.
    await page.waitForURL(/\/check-email\.html$/);
  });
});

test("closed: the page says registration is closed for now", async ({ page }) => {
  test.setTimeout(60_000);
  await withServer({ REGISTRATION_OPEN: "false" }, async (url) => {
    await page.goto(`${url}/register.html`);
    await fill(page, `${Date.now()}-closed`);
    await page.click('#register-form button[type="submit"]');
    const status = page.locator("#register-status");
    await expect(status).toHaveText("Registration is closed for now.");
    await expect(page).toHaveURL(/register\.html/);
    await page.screenshot({ path: path.join(SCREEN_DIR, "registration-closed-375x812.png") });
  });
});
