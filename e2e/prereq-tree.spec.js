// AB#2477: Corporate R&D and CEO Insight each draw their prerequisites as a connected tree (views/prereqGraph.js), in
// a real browser at 1280x800 and 375x812, for a corporation part-way up the tree with research and a CEO program
// running (e2e/seed-industry-account.mjs). The layout is public/scripts/prereqGraph.js (unit-tested); this checks the
// page draws it: a node per item, a lane per prerequisite pointing down, names that do not collide, nothing wider than
// the page, and a locked item's chain lit with what it still waits on. Screenshots go to e2e/screenshots/ab-2477/
// (gitignored; the PR's are copied to docs/ab-2477/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2477");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "prereq-tree-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const TREE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "research.json"), "utf8")).nodes;
const PROGRAMS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "ceo-insight.json"), "utf8")).programs;
const links = (nodes) => nodes.reduce((n, node) => n + node.prereqs.length, 0);

let server, url, email;
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-prereq-tree-e2e-"));
  email = `prereq-tree-${Date.now()}@example.test`;
  const seeded = spawnSync(process.execPath, ["e2e/seed-industry-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
  server = spawn(process.execPath, ["server/index.js"], { cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
}

/** The tree as drawn: node and lane counts, lanes that point up, names that overlap, and whether it is wider than the page. */
async function measure(page, id) {
  return page.evaluate((graphId) => {
    const el = document.getElementById(graphId);
    const names = [...el.querySelectorAll(".prereq-node__name")].map((n) => n.getBoundingClientRect());
    let overlaps = 0;
    for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) {
      const a = names[i], b = names[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps += 1;
    }
    const map = el.querySelector(".prereq-graph__map").getBoundingClientRect();
    const outside = names.filter((r) => r.left < map.left - 1 || r.right > map.right + 1).length;
    const upward = [...el.querySelectorAll(".prereq-lane")].filter((p) => {
      const n = p.getAttribute("d").match(/-?\d+(\.\d+)?/g).map(Number);
      return n[n.length - 1] <= n[1];
    }).length;
    return {
      nodes: el.querySelectorAll("button.prereq-node").length,
      lanes: el.querySelectorAll(".prereq-lane").length,
      chainLanes: el.querySelectorAll(".prereq-lane--chain").length,
      names: names.length, overlaps, outside, upward,
      pageWider: document.documentElement.scrollWidth > window.innerWidth,
      detail: el.querySelector(".prereq-graph__detail").textContent.trim()
    };
  }, id);
}

// The panel from a full-page shot scrolled to the top, clipped to the panel: an element shot scrolls the panel under
// the sticky header (AB#894).
async function shootPanel(page, graph, file) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await graph.locator("xpath=ancestor::section[1]").evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; });
  await page.screenshot({ path: path.join(SHOT_DIR, file), fullPage: true, clip: box, animations: "disabled" });
}

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test.describe(`${width}x${height}`, () => {
    test.beforeAll(start);
    test.afterAll(() => server?.kill());

    test(`both research pages draw their prerequisites as a connected tree at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);

      await openTab(page, "rnd");
      const rnd = page.locator("#rnd-prereq-graph");
      await expect(rnd.locator("button.prereq-node")).toHaveCount(TREE.length, { timeout: 15_000 });
      let m = await measure(page, "rnd-prereq-graph");
      expect(m).toMatchObject({ lanes: links(TREE), upward: 0, overlaps: 0, outside: 0, pageWider: false });
      expect(m.names).toBe(width >= 1000 ? TREE.length : 1); // a phone names only the selected node, as the Starmap does
      expect(m.detail).toMatch(/ is waiting on \d+ prerequisites?: /); // it opens on a locked item

      // the deepest item: its whole chain is lit, and the line names what it still waits on
      await rnd.locator('[data-prereq-id="tt-antimatter-confinement"]').click();
      await expect(rnd.locator('[data-prereq-id="tt-antimatter-confinement"]')).toHaveAttribute("aria-pressed", "true");
      m = await measure(page, "rnd-prereq-graph");
      expect(m.detail).toMatch(/^Antimatter Confinement is waiting on \d+ prerequisites: .*Exotic Containment.*\. (In the queue:|Start with) /);
      expect(m.chainLanes).toBeGreaterThan(10);
      expect(m).toMatchObject({ overlaps: 0, outside: 0, pageWider: false });
      await shootPanel(page, rnd, `rnd-${width}x${height}.png`);

      await openTab(page, "ceo");
      const ceo = page.locator("#ceo-prereq-graph");
      await expect(ceo.locator("button.prereq-node")).toHaveCount(PROGRAMS.length);
      await ceo.locator('[data-prereq-id="ceo-decision-fatigue-reduction"]').click();
      m = await measure(page, "ceo-prereq-graph");
      expect(m).toMatchObject({ lanes: links(PROGRAMS), upward: 0, overlaps: 0, outside: 0, pageWider: false });
      expect(m.detail).toMatch(/Decision Fatigue Reduction: planned for a later version/);
      await ceo.locator('[data-prereq-id="ceo-contract-law"]').click();
      m = await measure(page, "ceo-prereq-graph");
      expect(m.detail).toMatch(/Contract Law/);
      await shootPanel(page, ceo, `ceo-${width}x${height}.png`);
    });
  });
}
