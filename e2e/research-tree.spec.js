// AB#1049: Corporate R&D now renders from GET /api/research (data/research.json) instead of a client-side literal.
// Real browser, following the pattern in e2e/first-hour.spec.js (AB#747) and e2e/mission-agents.spec.js (AB#1051).
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/research-tree.spec.js`.

import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import path from "node:path";

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

async function shoot(page, viewportLabel, stepId, width) {
  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: fullHeight });
  await page.screenshot({ path: path.join(SCREEN_DIR, `${stepId}-${viewportLabel}.png`) });
  await page.setViewportSize({ width, height: VIEWPORTS.find((v) => v.width === width).height });
}

async function assertNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { scrollWidth: el.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(overflow.scrollWidth, "document.scrollingElement.scrollWidth <= innerWidth").toBeLessThanOrEqual(overflow.innerWidth);
}

function uniqueAccount() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `playtest-research-${stamp}@example.test`,
    password: "playtest-password-not-real",
    ceoName: "Playtest CEO",
    corpName: `Playtest Corp ${stamp}`
  };
}

for (const viewport of VIEWPORTS) {
  test(`Corporate R&D shows the research tree from GET /api/research at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const account = uniqueAccount();
    const mobile = viewport.width < 600;

    let researchResponse;
    page.on("response", (res) => {
      if (res.url().endsWith("/api/research")) researchResponse = res;
    });

    await page.goto("/register.html");
    await page.fill("#register-email", account.email);
    await page.fill("#register-password", account.password);
    await page.fill("#register-ceo", account.ceoName);
    await page.fill("#register-corp", account.corpName);
    await page.click('#register-form button[type="submit"]');
    await page.waitForURL(/\/\?account=/);
    await page.getByRole("button", { name: "I'll find my own way" }).click();
    await expect(page.locator("#dialogue-modal")).toBeHidden();

    await openTab(page, "rnd");
    const rows = page.locator("#rnd-tech-tree .rnd-row");
    await expect(rows.first(), "the tech tree (GET /api/research, data/research.json) must render at least one node").toBeVisible();

    expect(researchResponse, "the client must have called GET /api/research to populate this tab").toBeTruthy();
    expect(researchResponse.status()).toBe(200);
    const body = await researchResponse.json();
    expect(body.nodes.length).toBeGreaterThan(0);
    await expect(rows).toHaveCount(body.nodes.length);

    // Tier 1 nodes have no prereqs and no corp-level gate, so at least one row is available with cost/duration shown.
    await expect(page.locator("#rnd-tech-tree .rnd-row--available").first()).toBeVisible();
    await expect(page.locator(".rnd-enqueue-btn").first()).toBeVisible();

    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "01-rnd-tech-tree", viewport.width);
  });
}
