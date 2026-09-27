// ISP-220 (AB#915): the v0.12 playthrough, on a real running server, with two players on two "devices": one browser
// at 1280x800 and one at 375x812, then again with the sizes swapped, so every screen is seen at both. The players do
// every step in the UI: found a conglomerate, invite and join, deposit to the treasury and the hangar, buy a level,
// share intel, send a private message, file and fund a station, vote, and use a member benefit, and they check the
// dominance overlays. What only time or other players can do is fast-forwarded with the server stopped
// (e2e/v012-fast-forward.mjs), and each such step says what it stands in for.
//
// A step that fails is recorded, screenshotted and passed over, so one run shows every problem; the test fails at the
// end if any did. A step with a filed bug is marked `known`: its failure is listed against the bug and does not fail
// the test, and once it passes the test says so, so the mark comes off. Every step also checks that the page is no
// wider than its viewport. Screenshots go to e2e/screenshots/ab-915/<pass>/.
//
// This is a local run: AB#915 asks for the deployed build, which is the Board's to deploy.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASSWORD = "playtest-password-not-real";
const SECRET = "construction-panel-e2e-fixture-secret-0123";
const DESKTOP = { label: "1280", width: 1280, height: 800, mobile: false };
const PHONE = { label: "375", width: 375, height: 812, mobile: true };

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

function startServer(dir, port) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: String(port), NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 30_000);
    const read = (chunk) => { out += chunk; if (/listening on port/.test(out)) { clearTimeout(timer); resolve(child); } };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}
const stopServer = (child) => new Promise((resolve) => { child.once("exit", resolve); child.kill(); });

for (const [passName, sizeA, sizeB] of [["a-desktop", DESKTOP, PHONE], ["a-phone", PHONE, DESKTOP]]) {
  test(`the v0.12 milestone, played through by two corporations (${passName})`, async ({ browser }) => {
    test.setTimeout(900_000);
    const shots = path.join(REPO_ROOT, "e2e", "screenshots", "ab-915", passName);
    fs.mkdirSync(shots, { recursive: true });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-v012-play-"));
    const stamp = Date.now();
    const emailA = `orion-${stamp}@example.test`, emailB = `bright-${stamp}@example.test`;
    const seeded = spawnSync(process.execPath, ["e2e/seed-v012-play.mjs", dir, emailA, emailB, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    let server = await startServer(dir, port);

    const findings = [];
    const known = [];
    let n = 0;
    const players = {};
    async function player(name, email, size) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000); // a step that cannot happen fails in 15 s, not at the test's end
      page.on("pageerror", (e) => findings.push(`${name}: page error: ${String(e).slice(0, 200)}`));
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\?account=/);
      players[name] = { page, context, size };
      return page;
    }
    /** One step of the playthrough: run it, screenshot the player's screen, and record a failure without stopping. */
    async function step(who, title, fn, { knownBug = null } = {}) {
      const { page, size } = players[who];
      n += 1;
      const file = path.join(shots, `${String(n).padStart(2, "0")}-${who}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}-${size.label}.png`);
      const t0 = Date.now();
      let focus = null;
      try {
        focus = await fn(page);
        // every screen, checked: nothing wider than the viewport (a phone that scrolls sideways has lost its layout)
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 0) throw new Error(`the page is ${over}px wider than the ${size.width}px viewport`);
        console.log(`PASS ${n} ${who} ${title} (${Math.round((Date.now() - t0) / 1000)} s)`);
        if (knownBug) findings.push(`${n} ${who} ${title}: passes now; ${knownBug} looks fixed, so take its known mark off this step`);
      } catch (error) {
        if (knownBug) {
          known.push(`${n} ${who} ${title} (${knownBug})`);
          console.log(`KNOWN ${n} ${who} ${title} (${knownBug})`);
          await page.screenshot({ path: file }).catch(() => {});
          return;
        }
        findings.push(`${n} ${who} ${title}: ${String(error?.message || error).split("\n")[0].slice(0, 300)}`);
        console.log(`FAIL ${n} ${who} ${title}: ${String(error?.message || error).split("\n")[0].slice(0, 300)}`);
      }
      // the screenshot shows what the step is about: the element it returned, scrolled into view
      if (focus?.scrollIntoViewIfNeeded) await focus.first().scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
      await page.screenshot({ path: file }).catch(() => {});
    }
    // The Bureau (in the Station tab) and the Conglomerate tab draw the same view: every lookup names which one.
    const C = (page) => page.locator("#conglomerate");
    const BUREAU = (page) => page.locator("#station");
    const mapShow = (page, where) => page.evaluate(async (w) => (await import("/scripts/views/starmap.js")).starmap.show(w), where);
    const openStation = (page, id) => page.evaluate(async (x) => (await import("/scripts/views/starmap.js")).starmap.openStation(x), id);
    const corpNow = (page) => page.evaluate(async () => (await import("/scripts/state.js")).appState.data?.corp);
    const confirm = async (page) => { await expect(page.locator("#trade-confirm-modal")).toBeVisible(); await page.locator("#trade-confirm-ok").click(); };
    const congTab = async (page, tab) => {
      await openTab(page, "conglomerate");
      if (tab) await C(page).locator(`[data-role="cong-tab"][data-tab="${tab}"]`).click();
    };
    async function restart(stepName) {
      for (const p of Object.values(players)) await p.context.close();
      await stopServer(server);
      const ff = spawnSync(process.execPath, ["e2e/v012-fast-forward.mjs", dir, stepName], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
      if (ff.status !== 0) throw new Error(`fast-forward ${stepName} failed: ${ff.stdout}\n${ff.stderr}`);
      server = await startServer(dir, port);
      await player("A", emailA, sizeA);
      await player("B", emailB, sizeB);
    }

    try {
      await player("A", emailA, sizeA);
      await player("B", emailB, sizeB);

      // ── 1. Found a conglomerate at the Bureau (ISP-197, ISP-200) ──
      await step("A", "Bureau before a charter", async (page) => {
        await openTab(page, "station");
        await page.click('[data-building-action="building:conglomerate-affairs-bureau"]');
        await expect(BUREAU(page).locator('[data-role="cong-charter"]')).toBeVisible();
      });
      await step("A", "Charter the Orion Accord", async (page) => {
        await BUREAU(page).locator("#cong-name").fill("Orion Accord");
        await BUREAU(page).locator('[data-role="cong-charter-submit"]').click();
        await confirm(page);
        await expect(BUREAU(page).locator('[data-role="cong-mine"], [data-role="cong-roster"]').first()).toBeVisible();
      });
      await step("A", "Conglomerate tab roster", async (page) => {
        await congTab(page, "roster");
        await expect(C(page).locator('[data-role="cong-roster"]')).toContainText("Orion Survey Company");
      });
      // ── 2. Invite and join (ISP-198) ──
      await step("A", "Invite Brightwater", async (page) => {
        await C(page).locator("#cong-invite-name").fill("Brightwater");
        await C(page).locator('[data-role="cong-invite-search"] button[type="submit"]').click();
        await C(page).locator('[data-role="cong-invite"]').first().click();
        await expect(C(page).locator('[data-role="cong-invite-status"]')).toContainText(/Invitation sent/);
      });
      await step("B", "Invitation arrives", async (page) => {
        await congTab(page);
        await expect(C(page).locator('[data-role="cong-invitation-accept"]')).toBeVisible({ timeout: 15_000 });
        return C(page).locator('[data-role="cong-invitations"]');
      });
      await step("B", "Accept and join", async (page) => {
        await C(page).locator('[data-role="cong-invitation-accept"]').first().click();
        await expect(C(page).locator('[data-role="cong-roster"]')).toContainText("Brightwater Haulage", { timeout: 15_000 });
        return C(page).locator('[data-role="cong-roster"]');
      });
      await step("B", "Overview card", async (page) => {
        await openTab(page, "overview");
        await expect(page.getByText("Orion Accord").first()).toBeVisible();
        return page.getByText("Orion Accord").first();
      });
      // ── 3. The treasury and the hangar (ISP-204, ISP-205, ISP-206) ──
      await step("A", "Deposit to the treasury", async (page) => {
        await congTab(page, "treasury");
        await C(page).locator("#cong-deposit-amount").fill("250,000");
        await C(page).locator('[data-role="cong-treasury-deposit"] button[type="submit"]').click();
        await confirm(page);
        await expect(C(page).locator('[data-role="cong-treasury-balance"]')).toContainText("255,000");
        return C(page).locator('[data-role="cong-treasury"]');
      });
      await step("B", "Deposit goods to the hangar", async (page) => {
        await congTab(page, "hangar");
        await C(page).locator("#cong-goods-in-item").selectOption("Silicates");
        await C(page).locator("#cong-goods-in-qty").fill("500");
        await C(page).locator('[data-role="cong-hangar-deposit"] button[type="submit"]').click();
        await expect(C(page).locator('[data-role="cong-hangar"]')).toContainText("500");
        return C(page).locator('[data-role="cong-hangar"]');
      });
      await step("B", "Treasury as a member sees it", async (page) => {
        await congTab(page, "treasury");
        await expect(C(page).locator('[data-role="cong-treasury-ledger"]')).toBeVisible();
        return C(page).locator('[data-role="cong-treasury-ledger"]');
      });
      await step("A", "Level panel before its requirements", async (page) => {
        await congTab(page, "roster");
        await expect(C(page).locator('[data-role="cong-level"]')).toBeVisible();
        return C(page).locator('[data-role="cong-level"]');
      });

      // ── 4. Three days and two more members (fast-forward: time, and corporations that are not in this run) ──
      await restart("level");
      await step("A", "Buy level 2", async (page) => {
        await congTab(page, "roster");
        await C(page).locator('[data-role="cong-level-buy"]').click();
        await confirm(page);
        await expect(page.locator("#action-receipt-modal")).toBeVisible();
        await expect(page.locator("#action-receipt-modal")).toContainText("2");
      });
      await step("B", "B sees the level reached", async (page) => {
        // the room's event brings the moment to B's open page, wherever it is: looked for before B touches anything
        await expect(page.locator("#action-receipt-modal")).toBeVisible({ timeout: 15_000 });
        await expect(page.locator("#action-receipt-modal")).toContainText("Orion Accord");
      });
      for (const p of ["A", "B"]) await players[p].page.locator("#action-receipt-close").click({ timeout: 3_000 }).catch(() => {});
      // ── 5. Shared intel (ISP-207, ISP-208): a belt A scouts, B can use; B's listing, A sees as a partner's ──
      await step("A", "Scout the Sol belt", async (page) => {
        await openTab(page, "starmap");
        await page.waitForTimeout(500);
        expect(await mapShow(page, { systemId: "sol", bodyId: "belt" })).toBe(true);
        await page.locator("#scout-belt-btn").click();
        await expect(page.locator("#map-details")).toContainText("Material Composition");
        return page.locator("#map-details");
      });
      await step("B", "Shared intel on the belt", async (page) => {
        await openTab(page, "starmap");
        await page.waitForTimeout(500);
        expect(await mapShow(page, { systemId: "sol", bodyId: "belt" })).toBe(true);
        await page.waitForTimeout(1000);
        await expect(page.locator("[data-belt-shared]")).toBeVisible({ timeout: 5_000 });
      }, { knownBug: "AB#4665" });
      await step("B", "Shared intel after a reload", async (page) => {
        await page.reload();
        await page.locator(".nav-tab").first().waitFor();
        await openTab(page, "starmap");
        await page.waitForTimeout(800);
        expect(await mapShow(page, { systemId: "sol", bodyId: "belt" })).toBe(true);
        await expect(page.locator("[data-belt-shared]")).toBeVisible();
        return page.locator("[data-belt-shared]");
      });
      await step("B", "List Silicates for sale", async (page) => {
        await openTab(page, "market");
        const row = page.locator("#market-sell-grid tr", { has: page.locator('[data-sell-qty="Silicates"]') });
        await row.locator('[data-sell-qty="Silicates"]').fill("100");
        await row.locator("button").first().click();
        await confirm(page).catch(() => {}); // a listing is confirmed first when the design asks it to be
        await expect(page.locator("#action-receipt-modal")).toContainText("Listing Posted");
        await page.locator("#action-receipt-close").click();
      });
      await step("A", "A partner's listing on the Exchange", async (page) => {
        await openTab(page, "market");
        await page.locator("#exchange-sellers-filter").selectOption("conglomerate");
        await expect(page.locator("#exchange-buy-table")).toContainText("Brightwater");
        return page.locator("#exchange-buy-table");
      });
      // ── 6. A private message ──
      await step("A", "Write to Brightwater", async (page) => {
        await openTab(page, "inbox");
        await page.locator("#inbox-compose-trigger").click();
        await page.locator("#compose-to").fill("Brightwater Haulage");
        await page.locator("#compose-body").fill("Venus Platform: file it this week? I will put in the goods.");
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect(page.getByText("Venus Platform: file it this week? I will put in the goods.").first()).toBeVisible();
      });
      await step("B", "The message arrives", async (page) => {
        await openTab(page, "inbox");
        await page.getByRole("tab", { name: /Players/ }).click(); // a player's message is under Players
        await expect(page.locator("#inbox-list-view")).toContainText("Orion", { timeout: 15_000 });
        return page.locator("#inbox-list-view");
      });
      // ── 7. Dominance on the starmap (ISP-217, ISP-218) ──
      await step("A", "Corporate dominance overlay", async (page) => {
        await openTab(page, "starmap");
        await page.locator("#map-overlay").selectOption("corp-dominance");
        await page.locator("#map-reset").click();
        await expect(page.locator("#starmap-dominance-legend")).toBeVisible();
        return page.locator("#starmap-dominance-legend");
      });
      await step("B", "Conglomerate dominance overlay", async (page) => {
        await openTab(page, "starmap"); // through the tab bar, which the Inbox once pushed off a phone's screen (AB#4666)
        await page.locator("#map-overlay").selectOption("cong-dominance");
        await page.locator("#map-reset").click();
        await expect(page.locator("#starmap-dominance-legend")).toBeVisible();
        return page.locator("#starmap-canvas");
      });

      // ── 8. A station (ISP-210, ISP-213); level 4 is fast-forwarded (the ladder takes 11 days and 16 members) ──
      await restart("station");
      await step("A", "Station tab before a project", async (page) => {
        await congTab(page, "station");
        await expect(C(page).locator('[data-role="cong-station-none"]')).toBeVisible();
        return C(page).locator('[data-role="cong-station-none"]');
      });
      await step("A", "File Venus Platform", async (page) => {
        await C(page).locator("#cong-station-site").selectOption("sol|Venus");
        await C(page).locator("#cong-station-name").selectOption("3");
        await C(page).getByRole("button", { name: "File the station project" }).click();
        await confirm(page);
        await expect(C(page).locator('[data-role="cong-station-project"]')).toContainText("Venus Platform");
        return C(page).locator('[data-role="cong-station-project"]');
      });
      const give = async (page, body) => {
        if (body.credits) await C(page).locator("#cong-give-credits").fill(body.credits);
        else { await C(page).locator("#cong-give-item").selectOption(body.item); await C(page).locator("#cong-give-qty").fill(body.qty); }
        await C(page).locator('[data-role="cong-station-give"][data-source="own"] button[type="submit"]').click();
        await confirm(page);
      };
      await step("A", "A puts in 500,000 credits", async (page) => {
        await give(page, { credits: "500,000" });
        await expect(C(page).locator('[data-role="cong-station-line"][data-input="Credits"]')).toContainText("500,000");
        return C(page).locator('[data-role="cong-station-project"]');
      });
      await step("B", "B puts in 1,500,000 credits", async (page) => {
        await congTab(page, "station");
        await give(page, { credits: "1,500,000" });
        await expect(C(page).locator('[data-role="cong-station-line"][data-input="Credits"]')).toContainText("2,000,000");
        return C(page).locator('[data-role="cong-station-contributions"]');
      });
      await step("A", "A puts in the goods", async (page) => {
        await congTab(page, "station");
        for (const [item, qty] of [["Structural Alloys", "5000"], ["Pressure Vessels", "2000"], ["Precision Frames", "1000"]]) {
          await give(page, { item, qty });
          await expect(C(page).locator(`[data-role="cong-station-line"][data-input="${item}"]`)).toContainText(Number(qty).toLocaleString("en-US"));
        }
        await expect(C(page).locator('[data-role="cong-station-clock"]')).toContainText("Fully funded.");
        return C(page).locator('[data-role="cong-station-clock"]');
      });

      // ── 9. The station opens (fast-forward: 14 days of construction), its stakes govern it, a member uses it ──
      await restart("open");
      await step("A", "Venus Platform is built", async (page) => {
        await congTab(page, "station");
        await expect(C(page).locator('[data-role="cong-station-built"]')).toBeVisible({ timeout: 30_000 });
        return C(page).locator('[data-role="cong-station-built"]');
      });
      await step("A", "Propose members-only docking", async (page) => {
        await C(page).locator("#cong-propose-what").selectOption("access|members");
        await C(page).getByRole("button", { name: "Put it to the vote" }).click();
        await expect(C(page).locator('[data-role="cong-propose-status"]')).toContainText("Put to the vote");
        return C(page).locator('[data-role="cong-station-governance"]');
      });
      await step("B", "B's stake carries the vote", async (page) => {
        await congTab(page, "station");
        await C(page).locator('[data-role="cong-proposal"]').getByRole("button", { name: "Vote yes" }).click();
        await expect(C(page).locator('[data-role="cong-station-access"]')).toHaveText("Members only");
        return C(page).locator('[data-role="cong-station-governance"]');
      });
      await step("B", "B docks at Venus Platform", async (page) => {
        await openTab(page, "starmap");
        await page.waitForTimeout(500);
        expect(await mapShow(page, { systemId: "sol" })).toBe(true);
        await openStation(page, "cg-venus");
        await page.locator("#starmap-station-modal .starmap__station-dock").click();
        await expect.poll(async () => (await corpNow(page))?.currentStationId, { timeout: 45_000 }).toBe("cg-venus");
        return page.locator("#station-location-header");
      });
      await step("B", "The member rate at the Suites", async (page) => {
        await openTab(page, "station");
        await expect(page.locator('[data-role="own-station-panel"]')).toBeVisible();
        await page.click('[data-building-action="building:orbital-executive-suites"]');
        await expect(page.locator("#lease-suite-box")).toContainText("Member rate");
        await page.click("#rent-office-btn");
        await expect(page.locator("#action-receipt-modal")).toContainText("3,500");
      });
      await step("A", "The station on the starmap", async (page) => {
        await openTab(page, "starmap");
        await page.waitForTimeout(500);
        expect(await mapShow(page, { systemId: "sol" })).toBe(true);
        await openStation(page, "cg-venus");
        await expect(page.locator("#starmap-station-modal")).toContainText("Owned by Orion Accord");
      });
    } finally {
      for (const p of Object.values(players)) await p.context.close().catch(() => {});
      await stopServer(server).catch(() => {});
    }
    console.log(`KNOWN (${known.length}):\n${known.join("\n")}`);
    console.log(`FINDINGS (${findings.length}):\n${findings.join("\n")}`);
    expect(findings).toEqual([]);
  });
}
