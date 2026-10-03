// Two tabs of the game share one refresh cookie, and each refresh rotates it. Two tabs that refresh at the same moment
// (a browser restoring its tabs, or two sockets told "auth:expired" by the same tick) both present the same cookie;
// the server takes the first, refuses the second as revoked and clears the cookie, and that tab is sent to log in.
// The page serializes its refreshes across tabs so the second waits and presents the rotated cookie (Bug #2300).
//
// Run: `npx playwright test e2e/two-tabs-refresh.spec.js` (it starts its own server).
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
const SECRET = "two-tabs-e2e-fixture-secret-0123456789ab";

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

test("two tabs that refresh at the same moment both stay signed in", async ({ page, context }) => {
  test.setTimeout(90_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-two-tabs-e2e-"));
  const { child, url } = await startServer(dir);
  try {
    const email = `two-tabs-${Date.now()}@example.test`;
    await page.request.post(`${url}/api/auth/register`, { data: { email, password: PASSWORD, ceoName: "Two Tabs QA", corpName: `Two Tabs Corp ${Date.now()}` } });
    await page.request.post(`${url}/api/auth/verify-email`, { data: { token: await verificationToken(page.request, url, email) } });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${url}/login.html`);
    await page.fill("#login-email", email);
    await page.fill("#login-password", PASSWORD);
    await page.click("#credential-login-btn");
    await page.waitForURL(/\/\?account=/);
    await gameDrawn(page);

    const second = await context.newPage();
    await second.setViewportSize({ width: 1280, height: 800 });
    await second.goto(page.url());
    await gameDrawn(second);

    // A refresh token minted in the same second as the one it replaces is the same string; wait so rotation shows.
    await page.waitForTimeout(1100);
    // Both tabs refresh at once, as two sockets told "auth:expired" by one tick do: each calls the page's own
    // refreshSessionToken (the module instance the page runs, by its URL). A few milliseconds decide whether the two
    // requests overlap, so the route holds each refresh until the other is in flight too, or 500 ms have passed: two
    // tabs that do not wait for each other go out together, and two that do go out one after the other.
    let held = [];
    await context.route("**/api/auth/refresh", (route) => {
      held.push(route);
      if (held.length >= 2) {
        for (const r of held.splice(0)) r.continue();
        return;
      }
      setTimeout(() => {
        if (!held.includes(route)) return;
        held = held.filter((r) => r !== route);
        route.continue();
      }, 500);
    });
    const refresh = (tab) => tab.evaluate(async () => (await import("/scripts/apiClient.js")).refreshSessionToken());
    expect(await Promise.all([refresh(page), refresh(second)]), "both refreshes succeed").toEqual([true, true]);
    await context.unroute("**/api/auth/refresh");
    await Promise.all([page.reload(), second.reload()]);
    for (const tab of [page, second]) {
      await gameDrawn(tab);
      await expect(tab).not.toHaveURL(/login\.html/);
    }
    expect((await context.cookies()).some((c) => c.name === "isp_refresh"), "the refresh cookie survives").toBe(true);
    await second.screenshot({ path: path.join(SCREEN_DIR, "two-tabs-both-signed-in-1280x800.png") });
  } finally {
    child.kill();
  }
});
