// AB#1759 (ISP-290): login and register each show exactly one primary (cyan) control now, everything else
// secondary or a link, per visual-design Critique AB#1757's "cyan on at most one primary control per screen" rule.
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/auth-primary-button.spec.js`.

import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

const PAGES = [
  { url: "/login.html", id: "login" },
  { url: "/register.html", id: "register" }
];

for (const page of PAGES) {
  for (const viewport of VIEWPORTS) {
    test(`${page.id} at ${viewport.label}`, async ({ page: p }) => {
      await p.setViewportSize({ width: viewport.width, height: viewport.height });
      await p.goto(page.url);
      await p.waitForSelector(".auth-page__actions");
      await p.screenshot({ path: path.join(SCREEN_DIR, `after-${page.id}-${viewport.label}.png`), fullPage: true });
    });
  }
}
