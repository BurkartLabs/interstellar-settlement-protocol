// AB#1202: the lease milestone never strands a player at a station short of staff with no way to hire.
//
// The bug, as filed on 2026-09-21: Level 2's "Purchase a Mining Lease on Mars" card sent a Level 1 player holding
// an Earth lease and five staff to Mars Orbital Dock, where a second lease needs ten on payroll and there was no
// office to hire at. This plays that path on the current build: the Level 2 card, then the claims office and the
// Executive Suites at Mars. Screenshots go to docs/ab-1202/.
//
// Run: start a dev server (npm run dev), then `npx playwright test e2e/lease-staffing.spec.js`. Dev timings make the
// Earth-Mars approach five seconds.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const SHOT_DIR = path.join(process.cwd(), "docs", "ab-1202");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });

/** Open a station building from the Station tab, which reopens whichever building was viewed last. */
async function enterBuilding(page, action) {
  await page.click('.tab-btn[data-tab="station"]');
  const back = page.locator("#station-back-btn");
  if (await back.isVisible()) await back.click();
  await page.click(`[data-building-action="building:${action}"]`);
}

test("the Level 2 lease card keeps a five-staff player at home, and Mars can be staffed where it is filed", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `lease-staff-${stamp}@example.test`);
  await page.fill("#register-password", "playtest-password-not-real");
  await page.fill("#register-ceo", "Playtest CEO");
  await page.fill("#register-corp", `Lease Staff Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  await page.getByRole("button", { name: "I'll find my own way" }).click();

  // Level 1 at Earth Station Prime: an office and five staff.
  await enterBuilding(page, "orbital-executive-suites");
  await page.selectOption("#rent-office-duration", "7");
  await page.click("#rent-office-btn");
  await page.fill("#office-hire-count", "5");
  await page.click('#office-hire-form button[type="submit"]');
  await expect(page.locator("#office-hire-hint")).toContainText("Staffing: 5 /");

  // The Level 2 lease card, before any lease: filed here, not a journey to Mars.
  await page.click('.tab-btn[data-tab="overview"]');
  const leaseCard = page.locator(".requirement-card", { hasText: "Purchase a Mining Lease" });
  await expect(leaseCard).toBeVisible();
  await expect(leaseCard).not.toContainText("Mars");
  await expect(leaseCard.locator(".requirement-state")).toHaveText("Go to Station →");
  await shot(page, "01-level2-card-before-lease");

  // The Earth lease, as the bug's repro has it. The Level 2 lease requirement is then met.
  await enterBuilding(page, "isa-claims-leases");
  await page.click('.purchase-lease-btn[data-body="Earth"]');
  await expect(page.locator(".lease-card")).toHaveCount(1);
  await page.click('.tab-btn[data-tab="overview"]');
  await expect(leaseCard.locator(".requirement-state")).toHaveText("Completed");
  await shot(page, "02-level2-card-after-earth-lease");

  // Nothing sends this player to Mars now, but a player can still choose to go. Travel there through the real route,
  // then wait until the server has the corporation docked.
  // AB#757: the page keeps its access token in memory, so this gets its own from the HttpOnly refresh cookie.
  const api = (method, url, body) => page.evaluate(async ({ method, url, body }) => {
    const id = localStorage.getItem("isp.accountId");
    const { accessToken } = await (await fetch("/api/auth/refresh", { method: "POST" })).json();
    const res = await fetch(url.replace(":id", id), {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json() };
  }, { method, url, body });
  const travel = await api("POST", "/api/accounts/:id/gameplay/travel", { toStationId: "mars-orbital-dock" });
  expect(travel.status, JSON.stringify(travel.body)).toBe(200);
  await expect.poll(async () => (await api("GET", "/api/accounts/:id")).body?.state?.corp?.currentStationId, { timeout: 30_000 })
    .toBe("mars-orbital-dock");
  await page.reload();

  // At Mars with five staff and one lease: what the claims office says.
  await enterBuilding(page, "isa-claims-leases");
  await expect(page.locator("body")).toContainText("Mars Orbital Dock");
  await shot(page, "03-mars-claims-office");

  // The Executive Suites at Mars rent an office, and that office hires.
  await enterBuilding(page, "orbital-executive-suites");
  await shot(page, "04-mars-suites-before-office");
  await page.selectOption("#rent-office-duration", "7");
  await page.click("#rent-office-btn");
  await page.fill("#office-hire-count", "5");
  await page.click('#office-hire-form button[type="submit"]');
  await expect(page.locator("#office-hire-hint")).toContainText("Staffing: 10 /");
  await shot(page, "05-mars-suites-hired-to-ten");

  // And the Mars lease files at Mars, without flying home.
  await enterBuilding(page, "isa-claims-leases");
  await page.click('.purchase-lease-btn[data-body="Mars"]');
  await expect(page.locator(".lease-body-badge", { hasText: "Mars" })).toBeVisible();
  await shot(page, "06-mars-lease-filed-at-mars");

  expect(errors).toEqual([]);
});
