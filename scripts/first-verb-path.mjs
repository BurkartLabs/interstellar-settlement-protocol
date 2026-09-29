// scripts/first-verb-path.mjs: ISP-259 (AB#955). A stranger's path from the landing page to the first extractor, walked in
// a real browser and counted: every click and every field a player has to make, per stage, the way a player makes them
// (the confirmations and receipts included, and on a phone the nav group taps too). The walkthrough is followed, as a
// stranger who presses "Brief me" would. At each stage a screenshot, and at the end the telemetry the page sent
// (funnel_step and the rest), read from the server's own store.
//
// It starts its own server on a scratch data directory (NODE_ENV=test, ISP_DEV=1 for the email outbox), so it touches
// nothing else. The email's link is opened as the player would open it, and counted as one click.
//
// Run: node scripts/first-verb-path.mjs [width] [height] [outDir]   (default 375 812, screenshots to e2e/screenshots/first-verb-path)
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [width = 375, height = 812] = process.argv.slice(2, 4).map(Number);
const OUT = process.argv[4] || path.join(ROOT, "e2e", "screenshots", "first-verb-path");
fs.mkdirSync(OUT, { recursive: true });
// A port nothing else holds, asked of the system: a guessed one can be another app's (a random one once found a
// different product's server here and walked into its login page).
const PORT = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-first-verb-"));
const stamp = Date.now() % 100000;
const player = { email: `stranger-${stamp}@example.test`, password: `stranger password ${stamp}`, ceo: "Ada Vance", corp: `Vance Holdings ${stamp}` };

const server = spawn(process.execPath, ["server/index.js"], {
  cwd: ROOT,
  env: { ...process.env, ISP_DATA_DIR: dir, PORT: String(PORT), NODE_ENV: "test", ISP_DEV: "1", JWT_SECRET: `first-verb-path-${stamp}-0123456789abcdef`, ISP_PUBLIC_URL: BASE },
  stdio: ["ignore", "pipe", "pipe"]
});
await new Promise((resolve, reject) => {
  let out = ""; const t = setTimeout(() => reject(new Error(`the server did not start: ${out}`)), 30000);
  const read = (c) => { out += c; if (new RegExp(`listening on port ${PORT}\\b`).test(out)) { clearTimeout(t); resolve(); } };
  server.stdout.on("data", read); server.stderr.on("data", read);
  server.once("exit", (code) => { clearTimeout(t); reject(new Error(`the server exited (${code}) before listening: ${out.slice(-300)}`)); });
});
// and it is this game answering, not something else on the port
if (!/Interstellar Settlement Protocol/.test(await (await fetch(`${BASE}/`)).text())) throw new Error(`${BASE} is not this game's server`);

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "msedge" });
const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
if (process.env.FVP_DEBUG) {
  // every script-driven scroll, with where it came from
  await page.addInitScript(() => {
    const note = (kind, arg) => console.log(`[scroll] ${kind} ${JSON.stringify(arg)} at ${Math.round(scrollY)} from ${(new Error().stack || "").split("\n").slice(2, 4).map((l) => l.trim().replace(/https?:\/\/[^/]+/, "")).join(" < ")}`);
    for (const k of ["scrollBy", "scrollTo", "scroll"]) { const f = window[k].bind(window); window[k] = (...a) => { note(k, a[0]); return f(...a); }; }
    const siv = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...a) { note(`scrollIntoView ${this.id || this.className}`, a[0]); return siv.apply(this, a); };
  });
  page.on("console", (m) => { if (m.text().startsWith("[scroll]")) console.log(" ", m.text().slice(0, 260)); });
}

// ─── counting ────────────────────────────────────────────────────────────────────────────────────────────────────────
let clicks = 0, fields = 0;
const stages = [];
const log = [];
let stageStart = { clicks: 0, fields: 0, at: Date.now() };
let covered = 0, scrolls = 0;
const coveredLog = [];
async function click(what, locator) {
  await locator.waitFor({ state: "visible", timeout: 15000 });
  // wait for the page to settle (the walkthrough scrolls smoothly after each step): the same place twice, 250 ms apart
  for (let i = 0, last = null; i < 20; i++) {
    const at = await locator.evaluate((el) => `${Math.round(el.getBoundingClientRect().top)}:${Math.round(scrollY)}`);
    if (at === last) break;
    last = at;
    await page.waitForTimeout(250);
  }
  // Is the control the player needs hidden under something (the briefing card) where the page left it? Then the
  // player scrolls it into the clear band, as a person would: counted as friction, not as a click.
  const hidden = await locator.evaluate((el) => {
    const b = el.getBoundingClientRect();
    if (b.bottom < 0 || b.top > innerHeight) return "off screen";
    // the centre and four points just inside the corners: covered if anything else answers at any of them
    const pts = [[0.5, 0.5], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]];
    for (const [fx, fy] of pts) {
      const hit = document.elementFromPoint(b.left + b.width * fx, b.top + b.height * fy);
      if (!hit || !el.contains(hit)) return `under ${hit?.closest("[id]")?.id || hit?.tagName || "the window's edge"}`;
    }
    return null;
  });
  if (process.env.FVP_DEBUG) console.log("  before", what, await locator.evaluate((el) => { const b = el.getBoundingClientRect(); const c = document.querySelector("#walkthrough-modal:not([hidden]) .modal-card")?.getBoundingClientRect(); return `header ${Math.round(document.querySelector(".app-header")?.getBoundingClientRect().bottom)} target ${Math.round(b.top)}..${Math.round(b.bottom)} card ${c ? `${Math.round(c.top)}..${Math.round(c.bottom)}` : "none"} scrollY ${Math.round(scrollY)}`; }), "hidden:", hidden);
  if (hidden) {
    if (hidden !== "off screen") { covered += 1; coveredLog.push(`${what}: ${hidden}`); }
    scrolls += 1;
    await locator.evaluate((el) => {
      const header = document.querySelector(".app-header")?.getBoundingClientRect().bottom || 0;
      const card = document.querySelector("#walkthrough-modal:not([hidden]) .modal-card")?.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const bars = [...document.querySelectorAll(".app-nav, .nav-group__tabs")].filter((n) => getComputedStyle(n).position === "fixed" && n.getClientRects().length).map((n) => n.getBoundingClientRect().top).filter((t) => t > innerHeight / 2);
      const bottom = Math.min(innerHeight, ...bars);
      const bandTop = header + 8, bandBottom = Math.min(card && card.top > header ? card.top : bottom, bottom) - 8;
      window.scrollBy({ top: b.top - bandTop - Math.max(0, (bandBottom - bandTop - b.height) / 2), behavior: "instant" });
    });
    await page.waitForTimeout(300);
  }
  await locator.click({ timeout: 10000 });
  clicks += 1;
  log.push(`click  ${what}`);
  await page.waitForTimeout(350);
}
async function fill(what, locator, value) {
  await locator.waitFor({ state: "visible", timeout: 15000 });
  await locator.fill(value);
  fields += 1;
  log.push(`field  ${what}`);
}
/** A dialog the game puts up after a committing action: confirmed or acknowledged, one click each, when it is there. */
async function answerDialogs() {
  for (const [what, sel] of [["confirm", "#trade-confirm-ok"], ["acknowledge the receipt", '#action-receipt-modal button:has-text("Acknowledge")']]) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) await click(what, el);
    await page.waitForTimeout(250);
  }
}
/** A tab, as a player reaches it: its group first when the tab is not showing (the phone's two-row nav). */
async function tab(id) {
  const t = page.locator(`.nav-tab[data-tab="${id}"]`);
  if (!(await t.isVisible().catch(() => false))) await click(`nav group of ${id}`, page.locator(`.nav-group:has(.nav-tab[data-tab="${id}"]) > .nav-group__button`));
  await click(`${id} tab`, t);
}
async function stage(name) {
  // the walkthrough card's title, if one is showing (a count first: textContent would wait 30 s for one that is not)
  const title = page.locator("#walkthrough-title:visible, .walkthrough__title:visible").first();
  const card = (await title.count()) ? await title.textContent({ timeout: 1000 }).catch(() => null) : null;
  stages.push({ name, clicks: clicks - stageStart.clicks, fields: fields - stageStart.fields, totalClicks: clicks, totalFields: fields, seconds: Math.round((Date.now() - stageStart.at) / 1000), walkthrough: card?.trim() || null });
  stageStart = { clicks, fields, at: Date.now() };
  const file = `${String(stages.length).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
}

let stuck = null, stuckWhy = "";
try {
  // 1. the landing, then its one call to action
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(800);
  await stage("landing");
  await click("Register Corporation", page.locator("#show-register-btn"));
  await page.waitForURL(/register\.html/);
  await stage("register-page");

  // 2. registration: every field the form asks for
  await fill("email", page.locator("#register-email"), player.email);
  await fill("password", page.locator("#register-password"), player.password);
  await fill("CEO name", page.locator("#register-ceo"), player.ceo);
  await fill("corporation name", page.locator("#register-corp"), player.corp);
  await click("Register And Continue", page.locator('#register-form button[type="submit"]'));
  await page.waitForURL(/check-email\.html/, { timeout: 15000 });
  await stage("check-email");

  // 3. the email's link, opened as the player opens it
  const outbox = await (await fetch(`${BASE}/api/dev/outbox`)).json();
  const link = outbox.messages.filter((m) => m.to === player.email.toLowerCase()).at(-1)?.text.match(/https?:\/\/\S+verify-email\.html#token=[A-Za-z0-9_-]+/)?.[0];
  if (!link) throw new Error("no verification link in the outbox");
  await page.goto(link);
  clicks += 1; log.push("click  the link in the email");
  await page.waitForTimeout(1500);
  await stage("email-link-opened");

  // 4. the verify page's primary button (the link alone verifies nothing, so a scanner cannot spend it), then into the
  // game: whatever the page offers next, and the login form if it asks
  const verify = page.getByRole("button", { name: /verify my email/i });
  if (await verify.isVisible().catch(() => false)) {
    await click("Verify My Email", verify);
    await page.waitForTimeout(1200);
    await stage("verify-pressed");
  }
  if (!/\?account=/.test(page.url())) {
    const next = page.getByRole("link", { name: /log in|continue|enter/i }).or(page.getByRole("button", { name: /log in|continue|enter/i })).first();
    if (!/login\.html/.test(page.url())) await click(`"${(await next.textContent())?.trim()}" on the verified page`, next);
    if (/login\.html/.test(page.url()) || await page.locator("#login-email").isVisible().catch(() => false)) {
      await fill("login email", page.locator("#login-email"), player.email);
      await fill("login password", page.locator("#login-password"), player.password);
      await click("Log In", page.locator("#credential-login-btn"));
    }
  }
  await page.waitForURL(/\?account=/, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await stage("in-the-game");

  // 5. the opening: the guided first day
  await click("Brief me", page.getByRole("button", { name: "Brief me" }));
  await stage("opening");

  // 6. the walkthrough's steps to an office: the licence in the inbox, the Station, the suites
  await tab("inbox");
  await tab("station");
  const offices = page.locator("#station-subtab-offices");
  if (await offices.isVisible().catch(() => false) && (await offices.getAttribute("aria-selected")) !== "true") await click("Offices subpage", offices);
  await click("Orbital Executive Suites: Enter", page.locator('[data-building-action="building:orbital-executive-suites"]'));
  await click("Rent office", page.locator("#rent-office-btn"));
  await answerDialogs();
  await stage("office-rented");

  // 7. five hires, which the claims office asks for before it files a lease
  await fill("employees to hire", page.locator("#office-hire-count"), "5");
  await click("Hire", page.locator('#office-hire-form button[type="submit"]'));
  await answerDialogs();
  await stage("staff-hired");

  // 8. the claim on Earth
  const back = page.locator("#station-back-btn");
  if (await back.isVisible().catch(() => false)) await click("Back to the station", back);
  if (await offices.isVisible().catch(() => false) && (await offices.getAttribute("aria-selected")) !== "true") await click("Offices subpage", offices);
  await click("ISA Claims & Leases: Enter", page.locator('[data-building-action="building:isa-claims-leases"]'));
  await click("Purchase the Earth lease", page.locator('[data-action="purchase-lease"][data-body="Earth"]'));
  await answerDialogs();
  await stage("lease-filed");

  // 9. the first verb's end: an extractor yard on the lease
  await click("Manage lease", page.locator('[data-action="manage-lease"]').first());
  await click("Build extractor", page.locator("#lease-build-extractor-btn"));
  await answerDialogs();
  await page.locator(".extractor").first().waitFor({ state: "visible", timeout: 15000 });
  await stage("first-extractor");
} catch (error) {
  stuck = `${error.message.split("\n")[0]} (after: ${log.at(-1) || "nothing"})`;
  stuckWhy = error.message.split("\n").filter((l) => /intercept|not visible|not stable|outside|element is/.test(l)).slice(-3).join(" | ");
  // where things were: the walkthrough's highlighted control, its card, the sticky header, the scroll
  stuckWhy += " | geometry: " + await page.evaluate(() => {
    const r = (el) => { if (!el) return "none"; const b = el.getBoundingClientRect(); return `${Math.round(b.top)}..${Math.round(b.bottom)}`; };
    return JSON.stringify({ focus: r(document.querySelector(".walkthrough__focus")), focusIs: document.querySelector(".walkthrough__focus")?.outerHTML.slice(0, 90), card: r(document.querySelector("#walkthrough-modal .modal-card")), header: r(document.querySelector(".app-header")), scrollY: Math.round(scrollY), innerHeight });
  }).catch((e) => String(e));
  await page.screenshot({ path: path.join(OUT, "stuck.png") }).catch(() => {});
} finally {
  await page.waitForTimeout(2500); // the page's telemetry batch
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))).catch(() => {});
  await page.waitForTimeout(1000);
  await browser.close();
  server.kill();
}

const telemetry = fs.existsSync(path.join(dir, "telemetry"))
  ? fs.readdirSync(path.join(dir, "telemetry")).flatMap((f) => fs.readFileSync(path.join(dir, "telemetry", f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)))
  : [];
console.log(`first-verb path at ${width}x${height}${stuck ? `: STUCK ${stuck}` : ""}`);
if (stuckWhy) console.log("  why:", stuckWhy);
console.log("stage                clicks fields  total clicks/fields  seconds  walkthrough card");
for (const s of stages) console.log(`${s.name.padEnd(20)} ${String(s.clicks).padStart(6)} ${String(s.fields).padStart(6)}  ${String(s.totalClicks).padStart(12)}/${String(s.totalFields).padEnd(6)} ${String(s.seconds).padStart(7)}  ${s.walkthrough ?? ""}`);
console.log(`TOTAL to ${stages.at(-1)?.name}: ${clicks} clicks, ${fields} fields`);
console.log(`controls the page left under the briefing card: ${covered}${coveredLog.length ? ` (${coveredLog.join("; ")})` : ""}; scrolls to reach a control: ${scrolls}`);
console.log("telemetry:", telemetry.map((e) => e.event === "funnel_step" ? `funnel_step:${e.props?.step ?? e.step}` : e.event).join(", ") || "none");
console.log("page errors:", errors.length, errors.slice(0, 3).join(" | "));
console.log("actions:\n  " + log.join("\n  "));
fs.writeFileSync(path.join(OUT, "counts.json"), JSON.stringify({ width, height, stuck, clicks, fields, covered, coveredLog, scrolls, stages, telemetry: telemetry.map((e) => ({ event: e.event, props: e.props ?? null })), log }, null, 2));
