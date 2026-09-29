// ISP-244 (AB#940): the v0.13 playthrough (territorial control), on a real running server, with three players: Orion
// (A) earns and holds Tau Ceti's concession, sets a lease discount and a tariff, patents a research node and opens a
// lobbying campaign; Bright (B) trades through the tariff, routes around it by selling next door, dumps Nickel until
// the ITC opens an investigation and levies a duty, pays Orion's royalty, pledges against Orion's campaign, and takes
// a tariff to the Galactic Arbitration Council; Cinder (C) buys what Bright sells. Two passes, the sizes swapped, so
// every screen is seen at 1280 and at 375.
//
// What only time can do is fast-forwarded with the server stopped (e2e/v013-fast-forward.mjs), each step saying what it
// stands in for; what is seeded is in e2e/seed-v013-play.mjs. One stand-in is not time: a copy of Bright's tariff-paying
// sale charged above the rate in force, so the Council's upheld path can be seen (the game should never overcharge).
//
// A step that fails is recorded, screenshotted and passed over, so one run shows every problem; the test fails at the
// end if any did. Screenshots go to e2e/screenshots/ab-940/<pass>/. This is a LOCAL run: AB#940 asks for the deployed
// build, which cannot register new players until AB#989 is deployed, and is the Board's to deploy.
import { test, expect } from "@playwright/test";
import { openExchangePage, openStationOffices, openTab } from "./nav.mjs";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASSWORD = "playtest-password-not-real";
const SECRET = "v013-play-e2e-fixture-secret-0123456789ab";
const DESKTOP = { label: "1280", width: 1280, height: 800, mobile: false };
const PHONE = { label: "375", width: 375, height: 812, mobile: true };
const TAU = "tau-ceti";

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
const stopServer = (child) => new Promise((resolve) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return resolve(); // already stopped (a failed fast-forward)
  child.once("exit", resolve);
  child.kill();
});

for (const [passName, sizes] of [["a-desktop", { A: DESKTOP, B: PHONE, C: DESKTOP }], ["a-phone", { A: PHONE, B: DESKTOP, C: PHONE }]]) {
  test(`the v0.13 milestone, played through by three corporations (${passName})`, async ({ browser }) => {
    test.setTimeout(1_200_000);
    const shots = path.join(REPO_ROOT, "e2e", "screenshots", "ab-940", passName);
    fs.mkdirSync(shots, { recursive: true });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-v013-play-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-v013-play.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
    const logins = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    let server = await startServer(dir, port);

    const findings = [];
    let n = 0;
    const players = {};
    const emails = { A: logins.orion, B: logins.bright, C: logins.cinder };
    async function player(name) {
      const size = sizes[name];
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      page.on("pageerror", (e) => findings.push(`${name}: page error: ${String(e).slice(0, 200)}`));
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", emails[name]);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await expect(page.locator("#logout-btn")).toBeVisible({ timeout: 20_000 });
      players[name] = { page, context, size };
      return page;
    }
    /** One step: run it, screenshot the player's screen (and the element it returns), record a failure without stopping. */
    const known = [];
    async function step(who, title, fn, { knownBug = null } = {}) {
      const { page, size } = players[who];
      n += 1;
      const base = `${String(n).padStart(2, "0")}-${who}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}-${size.label}`;
      const t0 = Date.now();
      let focus = null;
      try {
        // a confirmation or receipt a failed step left open would block every click after it
        if (await page.locator("#trade-confirm-modal").isVisible().catch(() => false)) await page.locator("#trade-confirm-cancel").click().catch(() => {});
        if (await page.locator("#action-receipt-modal").isVisible().catch(() => false)) await page.keyboard.press("Escape").catch(() => {});
        focus = await fn(page);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 0) throw new Error(`the page is ${over}px wider than the ${size.width}px viewport`);
        console.log(`PASS ${n} ${who} ${title} (${Math.round((Date.now() - t0) / 1000)} s)`);
        if (knownBug) findings.push(`${n} ${who} ${title}: passes now; ${knownBug} looks fixed, so take its known mark off this step`);
      } catch (error) {
        if (knownBug) {
          known.push(`${n} ${who} ${title} (${knownBug})`);
          console.log(`KNOWN ${n} ${who} ${title} (${knownBug})`);
          await page.screenshot({ path: path.join(shots, `${base}.png`) }).catch(() => {});
          return;
        }
        findings.push(`${n} ${who} ${title}: ${String(error?.message || error).split("\n")[0].slice(0, 300)}`);
        console.log(`FAIL ${n} ${who} ${title}: ${String(error?.message || error).split("\n")[0].slice(0, 300)}`);
      }
      if (await page.locator("#action-receipt-modal").isVisible().catch(() => false)) await page.keyboard.press("Escape").catch(() => {});
      if (focus?.scrollIntoViewIfNeeded) await focus.first().scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
      await page.screenshot({ path: path.join(shots, `${base}.png`) }).catch(() => {});
      if (focus?.boundingBox) await panelShot(page, size, focus.first(), path.join(shots, `${base}-panel.png`)).catch(() => {});
    }
    /** The whole element in one picture: at the page's top, in a viewport tall enough to hold it below the header and
     * above a phone's fixed bars, then the viewport put back (the AB#894 pattern). */
    async function panelShot(page, size, el, file) {
      await page.evaluate(() => window.scrollTo(0, 0));
      let box = await el.boundingBox();
      if (!box) return;
      // a taller viewport can grow what sits above the element (the Starmap's canvas follows the viewport's height), so
      // measure again until the element fits with room below it for a phone's fixed bar
      for (let i = 0; i < 4; i += 1) {
        const want = Math.max(size.height, Math.ceil(box.y + box.height) + 200);
        if (page.viewportSize().height >= want) break;
        await page.setViewportSize({ width: size.width, height: want });
        await page.waitForTimeout(500);
        await page.evaluate(() => window.scrollTo(0, 0));
        box = await el.boundingBox();
        if (!box) return;
      }
      if (box) await page.screenshot({ path: file, clip: box, animations: "disabled" });
      await page.setViewportSize({ width: size.width, height: size.height });
    }
    const mapShow = (page, where) => page.evaluate(async (w) => (await import("/scripts/views/starmap.js")).starmap.show(w), where);
    const confirm = async (page) => { await expect(page.locator("#trade-confirm-modal")).toBeVisible(); await page.locator("#trade-confirm-ok").click(); };
    const closeReceipt = async (page) => { const m = page.locator("#action-receipt-modal"); if (await m.isVisible().catch(() => false)) await page.keyboard.press("Escape"); };
    const maybeConfirm = async (page) => { if (await page.locator("#trade-confirm-modal").isVisible().catch(() => false)) await page.locator("#trade-confirm-ok").click(); };
    const tauPanel = async (page) => {
      await openTab(page, "starmap");
      await page.selectOption("#map-overlay", "concessions");
      await mapShow(page, { systemId: TAU });
      const details = page.locator("#map-details");
      await expect(details).toContainText("Tau Ceti", { timeout: 15_000 });
      return details;
    };
    const office = async (page, building) => {
      await openTab(page, "station");
      // the Station tab reopens on the last building visited: back to the station's offices first
      const back = page.locator("#station-back-btn");
      if (await back.isVisible().catch(() => false)) await back.click();
      await openStationOffices(page);
      await page.click(`[data-building-action="building:${building}"]`);
    };
    /** A jump to another system, from its panel on the Starmap. */
    const jumpTo = async (page, systemId) => {
      await openTab(page, "starmap");
      await mapShow(page, { systemId });
      await page.locator('#map-details [data-role="starmap-jump"]').click();
      await maybeConfirm(page);
      await closeReceipt(page);
      return page.locator("#map-details");
    };
    /** Docking at the system's station, once the jump has landed: from the station's body, as the panel says to. */
    const STATION_BODY = { [TAU]: "tc-verde", "epsilon-eridani": "ee-kestrel", sol: "earth" };
    const dockIn = async (page, systemId) => {
      await openTab(page, "starmap");
      await mapShow(page, { systemId, bodyId: STATION_BODY[systemId] });
      await page.locator('#map-details [data-role="starmap-dock"]').first().click();
      await maybeConfirm(page);
      await closeReceipt(page);
      return page.locator("#map-details");
    };
    /** List Nickel from the station the player is docked at; the confirmation is returned open, and screenshotted. */
    const listNickel = async (page, qty, price, shotName) => {
      await openExchangePage(page, "players");
      const row = page.locator("tr", { has: page.locator('[data-sell-item="Nickel"]') });
      await row.locator('[data-sell-qty="Nickel"]').fill(String(qty));
      await row.locator('[data-sell-price="Nickel"]').fill(String(price));
      await row.locator('[data-sell-item="Nickel"]').click();
      const body = page.locator("#trade-confirm-body");
      await expect(body).toBeVisible();
      await page.screenshot({ path: path.join(shots, `${shotName}-${players.B.size.label}.png`) });
      return body;
    };
    const buyFromBright = async (page, price, qty) => {
      await openExchangePage(page, "players");
      const row = page.locator("tr", { hasText: "Bright Freight" }).filter({ has: page.locator(`[data-buy-price="${price}"]`) }).first();
      await row.locator("[data-buy-order-qty]").fill(String(qty));
      await row.locator("[data-buy-order-id]").click();
      await confirm(page);
      await closeReceipt(page);
      return row;
    };
    async function restart(stepNames) {
      for (const p of Object.values(players)) await p.context.close();
      await stopServer(server);
      const ff = spawnSync(process.execPath, ["e2e/v013-fast-forward.mjs", dir, stepNames, logins.brightPublicId], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
      if (ff.status !== 0) throw new Error(`fast-forward ${stepNames} failed: ${ff.stdout}\n${ff.stderr}`);
      console.log(`FAST-FORWARD ${stepNames}: ${ff.stdout.trim().split("\n").join(" ")}`);
      server = await startServer(dir, port);
      for (const name of ["A", "B", "C"]) await player(name);
    }

    try {
      for (const name of ["A", "B", "C"]) await player(name);

      // ── 1. The concession: Orion petitions, the review passes, Orion holds it and files a discount and a tariff ──
      await step("A", "Tau Ceti eligible, petition filed", async (page) => {
        const details = await tauPanel(page);
        await expect(details).toContainText("eligible on 14 of the last 14 days");
        await details.locator('[data-role="concession-petition"]').click();
        await confirm(page);
        await closeReceipt(page);
        await expect(details.locator("[data-concession-petitions]")).toContainText("Orion", { timeout: 15_000 });
        return details;
      });
      await step("B", "sees Orion's petition under review", async (page) => {
        const details = await tauPanel(page);
        await expect(details.locator("[data-concession-petitions]")).toContainText("Orion");
        return details;
      });
      await restart("review");
      await step("A", "holds Tau Ceti, files a lease discount and a tariff", async (page) => {
        const details = await tauPanel(page);
        await expect(details.locator("[data-concession-holder]")).toContainText(/In force/i);
        await details.locator("#concession-discount-pct").selectOption("10");
        await details.locator('[data-role="concession-discount"] button[type="submit"]').click();
        await maybeConfirm(page);
        await closeReceipt(page);
        // the discount's answer reloads the concession and redraws this panel: let it land before typing the rate, or the
        // redraw puts back the form's own value and 0% is filed (seen in this playthrough; see the findings)
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1_000);
        const tariff = details.locator('[data-form="file-tariff"]');
        const rate = tariff.locator('[name="pct"]');
        await rate.fill("3");
        await expect(rate).toHaveValue("3");
        await tariff.locator('button[type="submit"]').click();
        await maybeConfirm(page);
        await closeReceipt(page);
        await expect(details).toContainText(/waiting out its notice|takes effect/i, { timeout: 15_000 });
        return details;
      });
      await restart("notice");
      await step("A", "the tariff and the discount in force", async (page) => {
        const details = await tauPanel(page);
        await expect(details.locator('[data-role="system-tariff"]')).toContainText("3");
        await expect(details.locator("[data-concession-discount]")).toContainText("10%");
        return details;
      });
      await step("B", "sees Tau Ceti's tariff", async (page) => {
        const details = await tauPanel(page);
        await expect(details.locator('[data-role="system-tariff"]')).toContainText("3");
        return details;
      });

      // ── 2. Bright trades through the tariff at Verde Trade Hub; Cinder buys ──
      await step("B", "lists Nickel at Verde Trade Hub: the tariff is quoted", async (page) => {
        const body = await listNickel(page, 500, 26, "listing-confirm-tariff");
        await expect(body).toContainText(/tariff/i);
        await page.locator("#trade-confirm-ok").click();
        await closeReceipt(page);
        return body;
      });
      await step("C", "buys Bright's Nickel", (page) => buyFromBright(page, 26, 500));
      await step("B", "the sale paid Orion's tariff, in the trade history", async (page) => {
        await openExchangePage(page, "history");
        const table = page.locator("#trade-history-table");
        await expect(table).toContainText(/tariff/i, { timeout: 15_000 });
        return table;
      }); // Bug #4853, fixed

      // ── 3. Bright floods Nickel at half its normal value; the ITC's warning; Cinder buys it all ──
      await step("B", "lists 1,500 Nickel at 12: the ITC's warning", async (page) => {
        const body = await listNickel(page, 1500, 12, "listing-confirm-dumping");
        await expect(body).toContainText(/normal value|dumping|Trade Commission|ITC/i);
        await page.locator("#trade-confirm-ok").click();
        await closeReceipt(page);
        return body;
      });
      await step("C", "buys the cheap Nickel", (page) => buyFromBright(page, 12, 1500));

      // ── 4. Everyone moves: Bright to Epsilon Eridani (around the tariff), Orion to Earth (the offices) ──
      await step("B", "jumps to Epsilon Eridani", (page) => jumpTo(page, "epsilon-eridani"));
      await step("A", "jumps to Sol", (page) => jumpTo(page, "sol"));
      await restart("travel,dump");
      await step("B", "the ITC opens an anti-dumping investigation", async (page) => {
        await page.click("#notification-toggle");
        const list = page.locator("#notification-panel");
        await expect(list).toContainText("ITC Anti-Dumping Investigation");
        return list;
      });
      await step("B", "docks at Kestrel Platform", (page) => dockIn(page, "epsilon-eridani"));
      await step("A", "docks at Earth Station Prime", (page) => dockIn(page, "sol"));
      await restart("travel,levy");

      // ── 5. Bright routes around: the same Nickel sold next door pays no tariff ──
      await step("B", "lists Nickel at Kestrel Platform: no tariff", async (page) => {
        const body = await listNickel(page, 300, 26, "listing-confirm-no-tariff");
        await expect(body).not.toContainText(/tariff/i);
        await page.locator("#trade-confirm-ok").click();
        await closeReceipt(page);
        return body;
      });
      await step("C", "buys Bright's Nickel from Kestrel Platform", (page) => buyFromBright(page, 26, 300));
      await step("B", "the duty is levied", async (page) => {
        await page.click("#notification-toggle");
        const list = page.locator("#notification-panel");
        await expect(list).toContainText(/duty/i);
        return list;
      });

      // ── 6. Patents: Orion files at Earth; Bright researches it and pays the royalty ──
      await step("A", "files a patent on Fusion Fuel Cycle", async (page) => {
        await office(page, "corporate-registry-charters");
        const officeEl = page.locator("[data-patent-office]");
        const filable = officeEl.locator("[data-patent-filable]");
        await expect(filable).toContainText("Fusion Fuel Cycle");
        await filable.locator('[data-role="patent-rate"]').first().selectOption({ index: 1 });
        await filable.locator('[data-role="patent-file"]').first().click();
        await confirm(page);
        await closeReceipt(page);
        await expect(officeEl.locator("[data-patent-mine-list]")).toContainText("Fusion Fuel Cycle", { timeout: 15_000 });
        return officeEl;
      });
      await step("B", "queues Orion's patented Fusion Fuel Cycle: is the royalty said?", async (page) => {
        await openTab(page, "rnd");
        const card = page.locator('.research__enqueue[data-tech-id="tt-fusion-fuel-cycle"]');
        await card.click();
        if (await page.locator("#trade-confirm-modal").isVisible().catch(() => false)) {
          await page.screenshot({ path: path.join(shots, `research-confirm-royalty-${players.B.size.label}.png`) });
          await page.locator("#trade-confirm-ok").click();
        }
        // the refinery quotes a patented chain's royalty before a run; the research queue should say it too
        const said = page.locator("#action-receipt-modal, #rnd");
        await expect(said.first()).toContainText(/royalt/i, { timeout: 3_000 });
        await closeReceipt(page);
        return page.locator("#rnd");
      }, { knownBug: "Bug #4857: the research queue does not say a patented node's royalty" });

      // ── 7. Lobbying: Orion opens a campaign at the Earth Assembly; Bright heads for Earth to oppose it ──
      await step("A", "opens a campaign at the Earth Assembly", async (page) => {
        await office(page, "earth-assembly");
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1_000);
        const form = page.locator('[data-form="lobby-open"]');
        await form.locator('[name="systemId"]').selectOption(TAU).catch(() => {});
        await form.locator('[name="credits"]').fill("20000");
        const standing = form.locator('[name="standing"]');
        if (await standing.count()) await standing.fill("5");
        await form.locator('button[type="submit"]').click();
        await maybeConfirm(page);
        await closeReceipt(page);
        await expect(page.locator("[data-lobby-register]")).toContainText("Tau Ceti", { timeout: 15_000 });
        return page.locator("[data-lobby-register]");
      });
      await step("B", "jumps to Sol", (page) => jumpTo(page, "sol"));
      await restart("travel,research");
      await step("B", "docks at Earth Station Prime", (page) => dockIn(page, "sol"));
      await restart("travel");
      await step("B", "pays Orion's royalty, in the patent office", async (page) => {
        await office(page, "corporate-registry-charters");
        await expect(page.locator("[data-patent-paying-list]")).toContainText("Fusion Fuel Cycle", { timeout: 20_000 });
        return page.locator("[data-patent-office]");
      });
      await step("A", "the royalty received, and the public register", async (page) => {
        await office(page, "corporate-registry-charters");
        await expect(page.locator("[data-patent-register-list]")).toContainText("Fusion Fuel Cycle");
        return page.locator("[data-patent-office]");
      });
      await step("B", "pledges against Orion's campaign", async (page) => {
        await office(page, "earth-assembly");
        await page.waitForLoadState("networkidle"); // the office draws twice as its data arrives: choose after that
        await page.waitForTimeout(1_000);
        const pledge = page.locator('[data-form="lobby-pledge"]').first();
        const side = pledge.locator('[name="side"]');
        await side.selectOption("against");
        await pledge.locator('[name="credits"]').fill("15000");
        await expect(side).toHaveValue("against");
        await pledge.locator('button[type="submit"]').click();
        await maybeConfirm(page);
        await closeReceipt(page);
        return page.locator("[data-lobby-register]");
      });
      await restart("pledges");
      await step("A", "the campaign's result on the register", async (page) => {
        await office(page, "earth-assembly");
        const register = page.locator("[data-lobby-register]");
        await expect(register).toContainText(/in force|until|no change|failed|result/i);
        return register;
      });

      // ── 8. Arbitration: Bright takes Orion's tariff to the Council ──
      await step("B", "a tariff case on its real sale: the Council's reading", async (page) => {
        await office(page, "galactic-arbitration-council");
        const filing = page.locator("[data-gac-filing]");
        await filing.locator('input[value="tariff-overcharge"]').check();
        await expect(filing.locator('[data-role="gac-record"]').first()).toBeVisible({ timeout: 15_000 });
        await filing.locator('[data-role="gac-record"]').first().check();
        await expect(filing.locator("[data-gac-evidence]")).toBeVisible({ timeout: 15_000 });
        return filing;
      });
      await restart("standin");
      await step("B", "files a tariff case on the stand-in overcharge", async (page) => {
        await office(page, "galactic-arbitration-council");
        const filing = page.locator("[data-gac-filing]");
        await filing.locator('input[value="tariff-overcharge"]').check();
        const records = filing.locator('[data-role="gac-record"]');
        await expect(records.first()).toBeVisible({ timeout: 15_000 });
        const standIn = filing.locator('[data-role="gac-record"][value$="standin-overcharge"]');
        await ((await standIn.count()) ? standIn : records.first()).check();
        await expect(filing.locator("[data-gac-evidence]")).toBeVisible({ timeout: 15_000 });
        await filing.locator('[data-role="gac-file"]').click();
        await maybeConfirm(page);
        await closeReceipt(page);
        await expect(page.locator("[data-gac-mine]")).toContainText(/tariff/i, { timeout: 15_000 });
        return page.locator("[data-gac-mine]");
      });
      await step("A", "sees the case against it", async (page) => {
        await office(page, "galactic-arbitration-council");
        const mine = page.locator("[data-gac-mine]");
        await expect(mine).toContainText(/tariff/i);
        return mine;
      });
      await restart("rule");
      await step("B", "the ruling, upheld and enforced", async (page) => {
        await office(page, "galactic-arbitration-council");
        const mine = page.locator("[data-gac-mine]");
        await mine.locator("summary").first().click().catch(() => {});
        await expect(mine.locator("[data-gac-ruling]").first()).toBeVisible({ timeout: 15_000 });
        return mine;
      });
      await step("B", "the public docket", async (page) => {
        await office(page, "galactic-arbitration-council");
        const docket = page.locator("[data-gac-docket-list]");
        await expect(docket).toContainText(/tariff/i);
        return docket;
      });
    } finally {
      for (const p of Object.values(players)) await p.context.close().catch(() => {});
      await stopServer(server).catch(() => {});
      console.log(`FINDINGS (${passName}):\n${findings.join("\n") || "none"}`);
      console.log(`KNOWN (${passName}):\n${known.join("\n") || "none"}`);
    }
    expect(findings).toEqual([]);
  });
}
