// Bug #4834: a system's panel on the Starmap read the Rats' activity on every redraw, and each read redrew the panel,
// so the page fetched and redrew without end for as long as a system was open: the panel was replaced under the
// player's pointer, and a click or a scroll could stall (on main: 560 reads in eight seconds). With the panel open for
// eight seconds, the page reads the activity at most once (the throttle is a minute).
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASSWORD = "playtest-password-not-real";
const SECRET = "starmap-read-loop-e2e-secret-0123456789ab";

test("an open system panel reads the Rats' activity once, not on every redraw (Bug #4834)", async ({ browser }) => {
  test.setTimeout(90_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-read-loop-e2e-"));
  const email = `read-loop-${Date.now()}@example.test`;
  const seeded = spawnSync(process.execPath, ["e2e/seed-v012-play.mjs", dir, email, `other-${email}`, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
  const child = spawn(process.execPath, ["server/index.js"], { cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "" }, stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (c) => { out += c; const p = out.match(/listening on port (\d+)/)?.[1]; if (p) { clearTimeout(timer); resolve(`http://127.0.0.1:${p}`); } };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  let reads = 0;
  page.on("request", (r) => { if (r.url().includes("/rats/activity")) reads += 1; });
  try {
    await page.goto(`${url}/login.html`);
    await page.fill("#login-email", email);
    await page.fill("#login-password", PASSWORD);
    await page.click('#login-form button[type="submit"]');
    await page.waitForURL(/\?account=/);
    await openTab(page, "starmap");
    await page.waitForTimeout(800);
    expect(await page.evaluate(async () => (await import("/scripts/views/starmap.js")).starmap.show({ systemId: "wolf-359" }))).toBe(true);
    await page.locator("#map-details h3, #map-details h2").first().waitFor();
    const before = reads;
    await page.waitForTimeout(8_000);
    expect(reads - before, `reads of /rats/activity while one system stayed open`).toBeLessThanOrEqual(1);
  } finally {
    await context.close();
    child.kill();
  }
});
