// ISP-78 (AB#767): the Station tab and its building views - the Orbital Executive Suites, the ISA Claims and Leases
// Division, a lease's view with its extractor yard - rebuilt on the design system, in a real browser at 375x812,
// 768x1024 and 1280x800: no sideways scroll; at 375, no visible text under 14px and every control at least 44px each
// way (a link inside running text is exempt). Then every station's header, each docked in turn, showing the body it
// orbits. Screenshots go to e2e/screenshots/ab-767/ (gitignored; the ones the pull request shows were copied to
// docs/ab-767/ by hand).
//
// Run: npm start (or npm run dev) with ISP_DEV=1 in one terminal, then `npx playwright test e2e/station-screens.spec.js`.
// The second test starts its own server on a seeded data directory (the suites-flavor.spec.js pattern).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab, openStationOffices } from "./nav.mjs";
import { acknowledgeReceipt } from "./receipt.mjs";
import { verifyAndLogIn } from "./verification.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-767");
const SIZES = [[375, 812], [768, 1024], [1280, 800]];
const PASSWORD = "playtest-password-not-real";

async function register(page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `station-${stamp}@example.test`);
  await page.fill("#register-password", PASSWORD);
  await page.fill("#register-ceo", "Station CEO");
  await page.fill("#register-corp", `Station Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", `station-${stamp}@example.test`, PASSWORD); // AB#2288
  await page.waitForURL(/\/\?account=/);
  await page.getByRole("button", { name: "I'll find my own way" }).click();
  await expect(page.locator("#dialogue-modal")).toBeHidden();
}

/** The measures the Station is held to, inside its panel. */
async function measure(page, label, width) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${label}: sideways scroll`).toBe(0);
  if (width !== 375) return;
  const tiny = await page.locator("#station").evaluate((panel) => {
    const out = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el.getClientRects().length || el.closest("[hidden], canvas, option")) continue;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
    }
    return out;
  });
  expect(tiny, `${label}: text under 14px`).toEqual([]);
  const small = await page.locator("#station").locator("button:visible, input:visible, select:visible, textarea:visible, a:visible").evaluateAll((els) =>
    els
      .filter((el) => !el.closest("p, li:not(:has(> button))"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${el.tagName} "${(el.textContent || el.id).trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
  );
  expect(small, `${label}: controls under 44px`).toEqual([]);
}

/** A building's artwork is drawn, at full strength where no words sit on it. */
async function expectBuildingArt(page, file) {
  const header = page.locator("#station-building-content > .station__building-header");
  await expect(header).toHaveCSS("background-image", new RegExp(`${file}`));
  const box = await header.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(180);
}

for (const [width, height] of SIZES) {
  test(`the Station and its buildings at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height });
    await register(page);
    const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), fullPage: true });

    await openTab(page, "station");
    await expect(page.locator("#station-location-header .station__body")).toBeVisible();
    await expect(page.locator("#station-location-header")).toContainText("Earth Station Prime");
    await expect(page.locator("#station-location-header img.station__body")).toHaveJSProperty("complete", true);
    expect(await page.locator("#station-location-header img.station__body").evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    await measure(page, "station", width);
    await shot("station");

    // The Orbital Executive Suites: rent an office, hire five.
    await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
    await page.click('[data-building-action="building:orbital-executive-suites"]');
    await expect(page.locator("#rent-office-duration")).toBeVisible();
    await expectBuildingArt(page, "orbital_executive_suites");
    await measure(page, "suites", width);
    await shot("suites");
    await page.selectOption("#rent-office-duration", "7");
    await page.click("#rent-office-btn");
    await acknowledgeReceipt(page);
    await expect(page.getByText("Active Lease")).toBeVisible();
    await page.fill("#office-hire-count", "5");
    await page.click('#office-hire-form button[type="submit"]');
    await acknowledgeReceipt(page);
    await expect(page.locator("#office-hire-hint")).toContainText("5 / ");
    await measure(page, "suites-office", width);
    await shot("suites-office");

    // The ISA Claims and Leases Division: file the Earth claim.
    await page.click("#station-back-btn");
    await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
    await page.click('[data-building-action="building:isa-claims-leases"]');
    await expectBuildingArt(page, "isa_claims_leases_division");
    await measure(page, "claims", width);
    await shot("claims");
    await page.click('[data-action="purchase-lease"][data-body="Earth"]');
    await acknowledgeReceipt(page);
    await expect(page.locator('[data-role="lease-card"]')).toHaveCount(1);
    await measure(page, "claims-lease", width);
    await shot("claims-lease");

    // The lease's view: commission a yard, and its extractor panel with the cycle form.
    await page.click('[data-action="manage-lease"]');
    await page.click("#lease-build-extractor-btn");
    await acknowledgeReceipt(page);
    await expect(page.locator(".extractor")).toBeVisible();
    await expect(page.locator('.extractor [data-role="yard-status"]')).toHaveText("Idle");
    await expect(page.locator('[data-form="mine"]')).toBeVisible();
    await measure(page, "lease", width);
    await shot("lease");

    // Back on the Station, the yard is in the corporation's holdings.
    await page.click("#station-back-btn");
    await expect(page.locator("#station-player-buildings .station__card")).toHaveCount(1);
    await measure(page, "station-holdings", width);
    await shot("station-holdings");
  });
}

function startServer(dir, secret) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: secret, ISP_DEV: "" },
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

// Every station, docked in turn: its header shows the body it orbits, a photograph in Sol and a drawn body elsewhere.
test("every station's header shows the body it orbits", async ({ browser }) => {
  test.setTimeout(180_000);
  const stations = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/stations.json"), "utf8"));
  const list = Array.isArray(stations) ? stations : stations.stations;
  const secret = "station-art-e2e-fixture-secret-0123456789";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-station-art-e2e-"));
  const emails = {};
  for (const station of list) {
    emails[station.id] = `art-${station.id}-${Date.now()}@example.test`;
    const seeded = spawnSync(process.execPath, ["e2e/seed-docked-account.mjs", dir, emails[station.id], PASSWORD, station.id], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: secret }
    });
    if (seeded.status !== 0) throw new Error(`seed-docked-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
  }
  const { child, url } = await startServer(dir, secret);
  try {
    for (const station of list) {
      for (const [width, height] of [[375, 812], [1280, 800]]) {
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.goto(`${url}/login.html`);
        await page.fill("#login-email", emails[station.id]);
        await page.fill("#login-password", PASSWORD);
        await page.click('#login-form button[type="submit"]');
        await page.waitForURL(/\/\?account=/);
        await openTab(page, "station");
        const header = page.locator("#station-location-header");
        await expect(header).toContainText(station.name);
        await expect(header).toContainText(`In orbit of ${station.body}`);
        const art = header.locator(".station__body");
        await expect(art).toBeVisible();
        expect(await art.evaluate((el) => el.getAttribute("alt") || el.getAttribute("aria-label"))).toContain(station.body);
        // Drawn: the canvas has painted pixels. A photograph: it loaded.
        const drawn = await art.evaluate(async (el) => {
          if (el.tagName === "IMG") {
            if (!el.complete) await new Promise((r) => el.addEventListener("load", r, { once: true }));
            return el.naturalWidth > 0;
          }
          const data = el.getContext("2d").getImageData(0, 0, el.width, el.height).data;
          let lit = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i] > 200) lit += 1;
          return lit > (el.width * el.height) / 4;
        });
        expect(drawn, `${station.name}: its body is drawn`).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${station.name}: sideways scroll`).toBe(0);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(SHOT_DIR, `header-${station.id}-${width}x${height}.png`) });
        expect(errors).toEqual([]);
        await context.close();
      }
    }
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
