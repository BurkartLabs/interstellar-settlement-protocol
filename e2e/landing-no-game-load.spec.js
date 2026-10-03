// Bug #4840: the logged-out landing loaded the socket.io client (37 KB), connected a socket that was pushed the
// world's state, and fetched /api/bootstrap and the station registry, none of which it shows. They load when the game
// opens. This checks both halves: the landing requests none of them, and signing in still gets all of them.
//
// Run: `npx playwright test e2e/landing-no-game-load.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gameDrawn } from "./nav.mjs"; // AB#2468: the header is a sheet on a phone

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "landing-no-game-load-e2e-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const GAME_LOAD = /\/socket\.io\/|\/api\/(bootstrap|stations|buildings|ceo-insight|mission-agents|research|systems|section-codes)\b/;

let server, url, email;
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-landing-load-e2e-"));
  email = `landing-load-${Date.now()}@example.test`;
  const run = spawnSync(process.execPath, ["e2e/seed-industry-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (run.status !== 0) throw new Error(`seed failed: ${run.stdout}\n${run.stderr}`);
  server = spawn(process.execPath, ["server/index.js"], { cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
});
test.afterAll(() => server?.kill());

test("the logged-out landing loads no socket and no game data; signing in loads both", async ({ page }) => {
  test.setTimeout(60_000);
  const requests = [];
  page.on("request", (r) => requests.push(r.url().replace(url, "")));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${url}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await expect(page.locator("#landing-title")).toBeVisible();
  expect(requests.filter((u) => GAME_LOAD.test(u)), "game loads on the landing").toEqual([]);

  requests.length = 0;
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await gameDrawn(page);
  await expect.poll(() => requests.some((u) => u.startsWith("/socket.io/socket.io.js"))).toBe(true);
  await expect.poll(() => requests.some((u) => u.startsWith("/socket.io/?EIO="))).toBe(true); // it connects
  expect(requests.some((u) => u.startsWith("/api/bootstrap"))).toBe(true);
  expect(await page.evaluate(() => typeof window.io)).toBe("function");
});
