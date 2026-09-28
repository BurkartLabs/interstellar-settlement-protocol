// AB#1452 (ISP-44a): the Galactic Exchange and the finance charts are the two costliest views in a full re-render (74 and
// 51 ms of ~178 at 4x throttling, scripts/bench-render.mjs). They draw only while their tab is on screen, and on the
// switch to it, so a click on any other tab no longer pays for them. Starts its own server (the suites-flavor.spec.js
// pattern) and drives the page's own updateAllViews, the call every action and refresh makes.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyAndLogIn } from "./verification.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "hidden-views-e2e-secret-0123456789abcdef";
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const CHARTS = ["cashflow-chart", "netflow-chart", "asset-chart", "sector-chart", "composition-chart", "pnl-chart"];

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

/** One full re-render through the page's own module, counting what it changed inside the market tab. */
const rerenderCountingMarket = (page) =>
  page.evaluate(async () => {
    const { updateAllViews } = await import("/scripts/views/shared.js");
    let changes = 0;
    const observer = new MutationObserver((records) => { changes += records.length; });
    observer.observe(document.getElementById("market"), { subtree: true, childList: true, characterData: true, attributes: true });
    updateAllViews();
    await new Promise((r) => setTimeout(r, 0));
    observer.disconnect();
    return changes;
  });

const chartsDrawn = (page) =>
  page.evaluate((ids) => ids.map((id) => {
    const chart = typeof Chart === "undefined" ? undefined : Chart.getChart(id);
    return chart ? { id, width: chart.width, height: chart.height } : null;
  }), CHARTS);

test("the market and the finance charts draw only on their own tab, and on the switch to it", async ({ page }) => {
  test.setTimeout(60_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-hidden-views-e2e-"));
  const { child, url } = await startServer(dir);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await page.goto(`${url}/register.html`);
    await page.fill("#register-email", `hidden-${stamp}@example.test`);
    await page.fill("#register-password", "playtest-password-not-real");
    await page.fill("#register-ceo", "Playtest CEO");
    await page.fill("#register-corp", `Hidden Corp ${stamp}`);
    await page.click('#register-form button[type="submit"]');
    await verifyAndLogIn(page, url, `hidden-${stamp}@example.test`, "playtest-password-not-real"); // AB#2288: verify, then log in
    await page.waitForURL(/\/\?account=/);
    await page.getByRole("button", { name: "I'll find my own way" }).click();
    await expect(page.locator("#overview")).toHaveClass(/active/);

    // On Overview: a full re-render leaves the hidden market alone, and no finance chart has been drawn at all.
    expect(await rerenderCountingMarket(page), "a re-render changed the hidden market tab").toBe(0);
    expect(await chartsDrawn(page), "a finance chart was drawn on a tab nobody opened").toEqual(CHARTS.map(() => null));

    // Opening the Exchange draws it from the current state.
    await openTab(page, "market");
    await expect(page.locator("#market-station-banner")).not.toBeEmpty();
    await expect(page.locator("#exchange-filter-bar")).toBeAttached();
    // While it is on screen, a re-render does redraw it.
    expect(await rerenderCountingMarket(page), "the visible market was not redrawn").toBeGreaterThan(0);
    await page.screenshot({ path: path.join(SCREEN_DIR, "hidden-views-market-1280x800.png") });

    // Opening Finance draws its charts; the ones on its Trends page (AB#2470) are sized as that page opens. Each has a
    // real size once its page is on screen (not the 0x0 of a canvas drawn while hidden).
    await openTab(page, "finance");
    const summary = (await chartsDrawn(page))[0];
    expect(summary?.width, "the Summary page's cash chart").toBeGreaterThan(0);
    await page.locator('#finance-subnav [data-finance-sub="trends"]').click();
    await expect(page.locator("#finance-sub-trends")).toBeVisible();
    await page.waitForFunction(() => Chart.getChart("pnl-chart")?.width > 0);
    const drawn = await chartsDrawn(page);
    for (const [i, chart] of drawn.entries()) {
      expect(chart, `${CHARTS[i]} was not drawn on opening Finance`).not.toBeNull();
      expect(chart.width, CHARTS[i]).toBeGreaterThan(0);
      expect(chart.height, CHARTS[i]).toBeGreaterThan(0);
    }
    await page.locator("#netflow-chart").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREEN_DIR, "hidden-views-finance-1280x800.png") });
    expect(errors).toEqual([]);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
