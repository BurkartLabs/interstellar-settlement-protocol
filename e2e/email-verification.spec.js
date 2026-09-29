// AB#987 (ISP-280), slice 1: the "check your email" page asks for a link, the link arrives in the test transport's
// outbox, and the page it opens verifies the account and shows the verified landing. Starts its own server with the
// dev surface on, because the outbox is readable only there (GET /api/dev/outbox). Screenshots at 375x812 and 1280x800.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const SECRET = "email-verification-e2e-secret-0123456789";

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

const VIEWPORTS = [
  { label: "375x812", width: 375, height: 812, port: 38751 },
  { label: "1280x800", width: 1280, height: 800, port: 38752 }
];

for (const vp of VIEWPORTS) {
  test(`check your email, follow the link, land verified, at ${vp.label}`, async ({ page, request }) => {
    test.setTimeout(60_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-email-verification-e2e-"));
    const { child, url } = await startServer(dir, vp.port);
    try {
      const email = `verify-${Date.now()}@example.test`;
      const reg = await request.post(`${url}/api/auth/register`, { data: { email, password: "playtest-password-not-real", ceoName: "Playtest CEO", corpName: `Verify Corp ${Date.now()}` } });
      expect(reg.status()).toBe(201);

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${url}/check-email.html`);
      // AB#943: the heading opens with its form code (aria-hidden), so the words are checked, not the whole text
      await expect(page.locator("#check-email-title")).toContainText("Check your email to verify your account.");
      await page.fill("#resend-email", email);
      await page.click("#resend-btn");
      await expect(page.locator("#resend-status")).toHaveText("If that address has an account that still needs verifying, a new link is on its way.");
      await page.screenshot({ path: path.join(SCREEN_DIR, `check-email-${vp.label}.png`) });

      const { messages } = await (await request.get(`${url}/api/dev/outbox`)).json();
      const link = messages.filter((m) => m.to === email).at(-1)?.text.match(/https?:\/\/\S+#token=[A-Za-z0-9_-]+/)?.[0];
      expect(link, "a verification link in the outbox").toBeTruthy();
      expect(link.startsWith(`${url}/verify-email.html#token=`)).toBe(true);

      await page.goto(link);
      await page.click("#verify-btn");
      await expect(page.locator("#verify-title")).toHaveText("Your email is verified");
      await expect(page).toHaveURL(`${url}/verify-email.html`); // the spent token is out of the address bar
      // Log In becomes the page's one primary: wait for its colour transition, so the picture shows where it ends.
      // The primary fill as the stylesheet defines it: a fresh button, never hovered and with nothing to transition.
      const primaryFill = await page.evaluate(() => {
        const probe = document.createElement("button");
        probe.className = "ui-button ui-button--primary";
        document.body.append(probe);
        const fill = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return fill;
      });
      // AB#765: the Verify button hides and Log In moves up under the pointer that pressed it; the design system's
      // primary has a hover colour, so the pointer moves off before the resting fill is read.
      await page.mouse.move(0, 0);
      await expect(page.locator("#verify-login")).toHaveCSS("background-color", primaryFill);
      await page.screenshot({ path: path.join(SCREEN_DIR, `email-verified-${vp.label}.png`) });

      // The same link again is spent. Via about:blank: a fragment-only change is not a page load, and a player opens
      // the link from their mail as a fresh page.
      await page.goto("about:blank");
      await page.goto(link);
      await page.click("#verify-btn");
      await expect(page.locator("#verify-title")).toHaveText("This link cannot be used");
      await expect(page.locator("#verify-new-link")).toBeVisible();
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
