// ISP-256 (AB#952): every minimum event fires at its trigger in a real session and is stored by the server, with no
// account id, email or address in any row. A fresh corporation logs in (app_open), opens the briefing and steps once
// (funnel_step), rents an office and hires five (verb_first, verb_repeat, and rank_up as it reaches level 1), the
// page throws once (error), and the page is left (session_end, sent as a beacon). The stored rows are written to
// e2e/screenshots/telemetry-rows.jsonl for the pull request.
//
// Run: `npx playwright test e2e/telemetry.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab, openStationOffices } from "./nav.mjs";
import { acknowledgeReceipt } from "./receipt.mjs";
import { verificationToken } from "./verification.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "telemetry-e2e-fixture-secret-0123456789abcd";

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "1", ISP_DISABLE_TICKERS: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); } };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}

const storedRows = (dir) => {
  const folder = path.join(dir, "telemetry");
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).filter((f) => f.endsWith(".jsonl")).flatMap((f) => fs.readFileSync(path.join(folder, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
};

test("every minimum event fires at its trigger and is stored without an account, email or address", async ({ page }) => {
  test.setTimeout(120_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-telemetry-e2e-"));
  const { child, url } = await startServer(dir);
  try {
    const email = `telemetry-${Date.now()}@example.test`;
    await page.request.post(`${url}/api/auth/register`, { data: { email, password: PASSWORD, ceoName: "Telemetry QA", corpName: `Telemetry Corp ${Date.now() % 100000}` } });
    await page.request.post(`${url}/api/auth/verify-email`, { data: { token: await verificationToken(page.request, url, email) } });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${url}/login.html`);
    await page.fill("#login-email", email);
    await page.fill("#login-password", PASSWORD);
    await page.click("#credential-login-btn");
    await expect(page.locator("#logout-btn")).toBeVisible({ timeout: 20_000 });

    // funnel_step: the briefing's first step, and the next
    await page.getByRole("button", { name: "Brief me" }).click();
    await page.click("#walkthrough-next");
    await page.click("#walkthrough-end");

    // verb_first (the office), verb_repeat (the hire), and rank_up as the corporation reaches level 1
    await openTab(page, "station");
    await openStationOffices(page);
    await page.click('[data-building-action="building:orbital-executive-suites"]');
    await page.selectOption("#rent-office-duration", "7");
    await page.click("#rent-office-btn");
    await acknowledgeReceipt(page);
    await page.fill("#office-hire-count", "5");
    await page.click('#office-hire-form button[type="submit"]');
    await acknowledgeReceipt(page);

    // error: an uncaught one, whose message carries a URL with an account id and an email, which must not be kept
    await page.evaluate(() => setTimeout(() => { throw new Error("telemetry e2e probe failed at https://game.test/?account=acc-123 for qa@example.test"); }, 0));
    await page.waitForTimeout(300);

    // session_end: leaving the page sends it as a beacon
    await page.goto("about:blank");
    await expect.poll(() => storedRows(dir).some((r) => r.event === "session_end"), { timeout: 15_000 }).toBe(true);

    const rows = storedRows(dir);
    fs.writeFileSync(path.join(SCREEN_DIR, "telemetry-rows.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const of = (name) => rows.filter((r) => r.event === name);
    expect(of("app_open")[0]).toMatchObject({ props: { source: "login" }, platform: "web-desktop" });
    expect(of("funnel_step").map((r) => r.props.step)).toEqual(expect.arrayContaining(["licence"]));
    expect(of("funnel_step").length).toBeGreaterThanOrEqual(2);
    expect(of("verb_first")).toHaveLength(1);
    expect(of("verb_first")[0].props.latency_ms).toBeGreaterThan(0);
    expect(of("verb_repeat")[0]).toMatchObject({ props: { count_in_session: 2 } });
    expect(of("rank_up")[0]).toMatchObject({ props: { level: 1 } });
    expect(of("error")[0].props.message).toBe("Uncaught Error: telemetry e2e probe failed at <url> for <email>");
    expect(of("error")[0].props.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(of("session_end")).toHaveLength(1); // pagehide and visibilitychange both fire on leaving: one event
    expect(of("session_end")[0].props.actions).toBe(2);
    expect(new Set(rows.map((r) => r.app_version))).toEqual(new Set([JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version]));

    // one browser, one id, one session; nothing that names the player
    expect(new Set(rows.map((r) => r.distinct_id)).size).toBe(1);
    expect(new Set(rows.map((r) => r.session_id)).size).toBe(1);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(email);
    expect(text).not.toMatch(/acc-[0-9a-z]/);
    expect(text).not.toContain("127.0.0.1");
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["app_version", "at", "distinct_id", "event", "platform", "props", "session_id"]);
  } finally {
    child.kill();
  }
});
