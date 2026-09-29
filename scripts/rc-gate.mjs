// ISP-275 (AB#971): the 1.0 release-candidate gate's run, on a production-like build. `npm run gate:rc -- <outDir>`.
//
// PRODUCTION-LIKE, and what that means here. The image is built from this checkout exactly as production's is
// (Dockerfile: NODE_ENV=production, production dependencies only) and run at production's size (0.5 CPU, 1 GiB), its
// data on a Docker volume. Mail is real SMTP over TLS with the certificate verified, as production sends it, to a local
// catcher on the same Docker network: its self-signed certificate is trusted through NODE_EXTRA_CA_CERTS, a Node
// setting, so no product code changes and a player registers and verifies by email exactly as in production. The
// hosted deployment is never touched (no production action).
//
// THE RUN, every step in a real browser, screenshots of each:
//   1. the public pages, then account A registers, verifies from the emailed link, and plays the first hour
//      (e2e/first-hour.spec.js's steps: office, five staff, a lease, a yard, a cycle, a sale, research, a contract);
//   2. every screen, at 1280: every navigation tab, each of its subpages, and each building the Station opens;
//   3. FAST-FORWARD (stated in the report): the saved data is advanced with the server's own code, while the app is
//      stopped, to what weeks of play would give: both corporations past new-corporation protection at level 12, A
//      holding goods and a garrison, B ships and troops in reserve. Nothing about how a player acts is scripted by it;
//   4. account B registers and verifies, buys what A lists on the Exchange, forms a fleet and declares a raid on A,
//      all in the browser; a second fast-forward brings the raid's arrival to now, and both sides read their reports;
//   5. every screen again, at 375, with a check that none scrolls sideways;
//   6. a return visit: the app is stopped and started, and A's browser comes back with its saved session.
// Then the checks the gate asks for that a run can answer: the telemetry rows stored, the design allowlist's count,
// page errors, and screens that scroll sideways at 375. It writes report.md and results.json beside the screenshots.
//
// Needs Docker and OpenSSL. A few minutes of image build, then about ten of play.

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { openTab, openStationOffices, openExchangePage } from "../e2e/nav.mjs";
import { ALLOW_RESTRICTED_PORTS_ARG } from "./chromium-ports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), `isp-rc-gate-${Date.now()}`));
const SHOTS = path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const NAME = { app: `isp-gate-app-${stamp}`, smtp: `isp-gate-smtp-${stamp}`, net: `isp-gate-net-${stamp}`, vol: `isp-gate-data-${stamp}` };
const IMAGE = "isp-gate:local";
const SECRET = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
const PASSWORD = "gate-password-not-real-9f3a";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "isp-gate-"));
const certs = path.join(work, "certs");
const mails = path.join(work, "mails");
fs.mkdirSync(certs); fs.mkdirSync(mails);

const log = (...a) => console.log(`[gate ${new Date().toISOString().slice(11, 19)}]`, ...a);
const docker = (args, { allowFail = false, timeout = 10 * 60_000 } = {}) => {
  const r = spawnSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw new Error(`docker ${args.slice(0, 3).join(" ")} failed: ${(r.stderr || r.stdout || "").slice(-1500)}`);
  return (r.stdout || "").trim();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });

const results = { startedAt: new Date().toISOString(), commit: spawnSync("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim(), steps: [], screens: [], pageErrors: [], sideways: [], fastForwards: [], checks: {} };
const save = () => fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));

// ─── the TLS mail catcher, and the patch script run against the data while the app is stopped ─────────────────────
fs.writeFileSync(path.join(certs, "catcher.mjs"), `
import tls from "node:tls"; import fs from "node:fs";
const server = tls.createServer({ key: fs.readFileSync("/certs/key.pem"), cert: fs.readFileSync("/certs/cert.pem") }, (s) => {
  let buf = "", inData = false, data = "", n = 0;
  const say = (l) => s.write(l + "\\r\\n");
  say("220 smtp-catcher ESMTP");
  s.on("data", (c) => { buf += c.toString("utf8"); let i;
    while ((i = buf.indexOf("\\r\\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (inData) { if (line === ".") { inData = false; fs.writeFileSync("/mails/" + Date.now() + "-" + (n++) + ".eml", data); data = ""; say("250 OK queued"); } else data += (line.startsWith("..") ? line.slice(1) : line) + "\\n"; continue; }
      const u = line.toUpperCase();
      if (u.startsWith("EHLO") || u.startsWith("HELO")) { say("250-smtp-catcher"); say("250 AUTH PLAIN LOGIN"); }
      else if (u.startsWith("AUTH PLAIN")) say(u.split(" ").length > 2 ? "235 OK" : "334 ");
      else if (u === "AUTH LOGIN") say("334 VXNlcm5hbWU6");
      else if (u === "DATA") { inData = true; say("354 go ahead"); }
      else if (u === "QUIT") { say("221 bye"); s.end(); }
      else if (/^[A-Za-z0-9+/=]+$/.test(line) && !u.startsWith("MAIL") && !u.startsWith("RCPT")) say("235 OK");
      else say("250 OK");
    } });
  s.on("error", () => {});
});
server.listen(465, () => console.log("catcher on 465"));
`);
fs.writeFileSync(path.join(certs, "patch.mjs"), `
// Run inside the image with the data volume, the app stopped: the saved world advanced with the server's own code.
const [, , step, argJson] = process.argv; const args = JSON.parse(argJson);
const store = await import("/app/server/gameState.js");
const { accountsStore, saveStateNow } = await import("/app/server/game/store.js");
const { formFleet } = await import("/app/server/fleets.js");
const DAY = 86400000, EARTH = "earth-station-prime", now = Date.now();
const byEmail = (email) => Object.values(accountsStore.accounts).find((a) => a.email === email);
const out = {};
if (step === "weeks") {
  for (const [email, role] of [[args.a, "a"], [args.b, "b"]]) {
    const acc = byEmail(email); if (!acc) throw new Error("no account " + email);
    acc.createdAt = now - 30 * DAY;
    store.mutateAccountState(acc.id, (s) => {
      const c = s.corp;
      c.level = Math.max(Number(c.level) || 0, 12); c.buildingSlots = Math.max(Number(c.buildingSlots) || 0, 8);
      c.finances.credits = (Number(c.finances.credits) || 0) + 400000; c.currentStationId = EARTH;
      c.inventory = c.inventory || {}; c.inventory[EARTH] = c.inventory[EARTH] || {};
      if (role === "a") { c.inventory[EARTH].Silicates = (Number(c.inventory[EARTH].Silicates) || 0) + 3000; c.military = { ...(c.military || {}), units: { ...(c.military?.units || {}), dt: 10 }, garrisons: { [EARTH]: 10 } }; }
      else c.military = { ...(c.military || {}), units: { ...(c.military?.units || {}), ds: 6, at: 12 } };
    }, { sanitize: false, settleMining: false });
    out[role] = { id: acc.id, level: acc.state.corp.level };
  }
} else if (step === "arrive") {
  const raids = store.getState().market?.raids || [];
  store.mutateState((draft) => { for (const r of draft.market?.raids || []) if (r.state === "inbound") { r.arrivesAt = now - 60000; out.raid = r.id; } });
  for (const acc of Object.values(accountsStore.accounts)) {
    store.mutateAccountState(acc.id, (s) => { for (const f of s.corp.military?.fleets || []) if (f.transit?.raidId) f.transit.arrivesAt = now - 60000; }, { sanitize: false, settleMining: false });
  }
  out.inbound = raids.filter((r) => r.state === "inbound").length;
}
await store.saveAccountsNow(); saveStateNow();
console.log(JSON.stringify(out));
process.exit(0);
`);

function certificate() {
  const r = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(certs, "key.pem"), "-out", path.join(certs, "cert.pem"), "-days", "2", "-subj", "/CN=smtp-catcher", "-addext", "subjectAltName=DNS:smtp-catcher"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`openssl: ${r.stderr}`);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  for (const n of [NAME.app, NAME.smtp]) docker(["rm", "-f", n], { allowFail: true });
  docker(["volume", "rm", NAME.vol], { allowFail: true });
  docker(["network", "rm", NAME.net], { allowFail: true });
  process.exit(130);
});

let port = 0;
const base = () => `http://127.0.0.1:${port}`;
async function startApp(first = false) {
  if (first) {
    docker(["run", "-d", "--name", NAME.app, "--network", NAME.net, "--cpus", "0.5", "--memory", "1g", "-p", `127.0.0.1:${port}:3000`,
      "-v", `${NAME.vol}:/data`, "-v", `${certs}:/certs:ro`,
      "-e", `JWT_SECRET=${SECRET}`, "-e", "ISP_SMTP_HOST=smtp-catcher", "-e", "ISP_SMTP_PORT=465", "-e", "ISP_SMTP_USER=gate",
      "-e", "ISP_SMTP_PASSWORD=gate-mail-password-not-real", "-e", "ISP_MAIL_FROM=registry@isp-gate.example", "-e", `ISP_PUBLIC_URL=${base()}`,
      "-e", "NODE_EXTRA_CA_CERTS=/certs/cert.pem", IMAGE]);
  } else docker(["start", NAME.app]);
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base()}/healthz`)).ok) return; } catch { /* not up yet */ }
    if (i > 120) throw new Error(`the app did not answer /healthz:\n${docker(["logs", "--tail", "60", NAME.app], { allowFail: true })}`);
    await sleep(500);
  }
}
const stopApp = () => docker(["stop", "-t", "20", NAME.app]);
function patch(step, args) {
  stopApp();
  const out = docker(["run", "--rm", "-v", `${NAME.vol}:/data`, "-v", `${certs}:/work:ro`, "-e", "ISP_DATA_DIR=/data", "-e", "NODE_ENV=test", "-e", `JWT_SECRET=${SECRET}`,
    "-e", "ISP_DISABLE_TICKERS=1", "-e", "PORT=0", IMAGE, "node", "/work/patch.mjs", step, JSON.stringify(args)]);
  const line = out.split("\n").reverse().find((l) => l.startsWith("{")) || "{}";
  results.fastForwards.push({ step, args, result: JSON.parse(line) });
  save();
  return JSON.parse(line);
}

/** The verification link the catcher received for `email`. */
async function mailedLink(email) {
  for (let i = 0; i < 60; i++) {
    for (const f of fs.readdirSync(mails).sort().reverse()) {
      const raw = fs.readFileSync(path.join(mails, f), "utf8");
      if (!raw.includes(email)) continue;
      const body = raw.split(/\n\n/).slice(1).join("\n\n").replace(/\n/g, "");
      const text = /^[A-Za-z0-9+/=]+$/.test(body) ? Buffer.from(body, "base64").toString("utf8") : raw;
      const link = text.match(/https?:\/\/[^\s"<>]+verify-email[^\s"<>]*/)?.[0];
      if (link) return link;
    }
    await sleep(1000);
  }
  throw new Error(`no verification mail for ${email}`);
}

// ─── looking ──────────────────────────────────────────────────────────────────────────────────────────────────────
let shotN = 0;
async function shoot(page, name, { full = true } = {}) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(250);
  shotN += 1;
  const file = `${String(shotN).padStart(3, "0")}-${name}.png`;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, file), fullPage: full });
  return file;
}
async function step(page, id, what, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const shot = await shoot(page, id);
    results.steps.push({ id, what, ok: true, shot, ms: Date.now() - t0 });
    log(`ok   ${id}: ${what}`);
  } catch (error) {
    const shot = await shoot(page, `${id}-FAILED`).catch(() => null);
    results.steps.push({ id, what, ok: false, error: String(error?.message || error).split("\n")[0].slice(0, 300), shot });
    log(`FAIL ${id}: ${String(error?.message || error).split("\n")[0]}`);
  }
  save();
}
const receipt = async (page) => {
  const modal = page.locator("#action-receipt-modal");
  await modal.waitFor({ state: "visible", timeout: 15_000 });
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
};
function watchErrors(page, who) {
  page.on("pageerror", (e) => results.pageErrors.push({ who, url: page.url(), message: e.message.slice(0, 300) }));
  page.on("console", (m) => { if (m.type() === "error") results.pageErrors.push({ who, url: page.url(), message: `console: ${m.text().slice(0, 300)}` }); });
}

/** Every screen for a signed-in player at the page's current width: tabs, their subpages, the Station's buildings. */
async function sweep(page, label) {
  const width = page.viewportSize().width;
  await briefingOffered(page);
  const look = async (name, scope) => {
    const file = await shoot(page, `${label}-${name}`);
    const wide = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    const blank = scope ? await page.locator(scope).evaluate((el) => (el.innerText || "").trim().length < 20).catch(() => false) : false;
    results.screens.push({ label, width, name, shot: file, sidewaysPx: wide, nearlyEmpty: blank });
    if (wide > 0) results.sideways.push({ label, name, px: wide });
  };
  await look("shell", null);
  try {
    await openTab(page, "station");
    await openStationOffices(page);
    const actions = await page.locator('#station-npc-buildings [data-building-action^="building:"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-building-action")));
    for (const action of actions) {
      await openTab(page, "station");
      await openStationOffices(page);
      await page.locator(`#station-npc-buildings [data-building-action="${action}"]`).click();
      await page.waitForTimeout(300);
      if (!(await page.locator("#station-building-view").isVisible())) continue;
      await look(`building-${action.slice(9)}`, "#station-building-view");
      await page.locator("#station-back-btn").click();
    }
  } catch (error) { results.pageErrors.push({ who: label, url: page.url(), message: `sweep buildings: ${String(error?.message || error).split("\n")[0]}` }); }
  const tabs = await page.locator(".nav-tab[data-tab]").evaluateAll((els) => els.filter((e) => !e.hidden).map((e) => e.getAttribute("data-tab")));
  for (const tab of tabs) {
    try {
      await openTab(page, tab);
      if (!(await page.locator(`#${tab}`).isVisible().catch(() => false))) continue;
      await look(tab, `#${tab}`);
      const subs = page.locator(`#${tab} [role=tablist] [role=tab], #${tab} [data-role="cong-tab"]`);
      const n = await subs.count();
      for (let i = 1; i < n; i += 1) {
        const t = subs.nth(i);
        if (!(await t.isVisible().catch(() => false))) continue;
        const id = ((await t.textContent()) || "").trim().toLowerCase().replace(/\(\d+\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || String(i);
        await t.click();
        await look(`${tab}--${id}`, `#${tab}`);
      }
      if (n > 1) await subs.first().click().catch(() => {});
    } catch (error) { results.pageErrors.push({ who: label, url: page.url(), message: `sweep ${tab}: ${String(error?.message || error).split("\n")[0]}` }); }
  }
  save();
}

/** Whether the first-day briefing was offered on this sign-in (and declined, so the run can go on). */
async function briefingOffered(page) {
  const skip = page.getByRole("button", { name: "I'll find my own way" });
  const shown = await skip.waitFor({ state: "visible", timeout: 8_000 }).then(() => true, () => false);
  if (shown) {
    await skip.click();
    await page.locator("#dialogue-modal").waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  }
  return shown;
}
/** The first-day briefing arrives a moment after the first sign-in: wait for it, and decline it (the run plays the verbs itself). */
async function declineBriefing(page) {
  const skip = page.getByRole("button", { name: "I'll find my own way" });
  await skip.waitFor({ state: "visible", timeout: 8_000 }).then(() => skip.click(), () => {});
  await page.locator("#dialogue-modal").waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
}

async function register(page, who, email, corpName) {
  await page.goto(`${base()}/register.html`);
  await page.fill("#register-email", email);
  await page.fill("#register-password", PASSWORD);
  await page.fill("#register-ceo", `${who} CEO`);
  await page.fill("#register-corp", corpName);
  await page.click('#register-form button[type="submit"]');
  await page.waitForURL(/check-email\.html/, { timeout: 20_000 });
}
async function verifyAndSignIn(page, email) {
  const link = await mailedLink(email);
  const url = new URL(link);
  await page.goto(`${base()}${url.pathname}${url.search}${url.hash}`);
  // the link alone verifies nothing (a mail scanner opening it must not): the player presses Verify My Email
  await page.click("#verify-btn");
  await page.locator("#verify-status").filter({ hasText: /./ }).waitFor({ timeout: 20_000 });
  await shoot(page, `verify-${email.split("@")[0]}`);
  await page.goto(`${base()}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/, { timeout: 20_000 });
  await page.locator("#logout-btn").waitFor({ state: "visible", timeout: 20_000 });
}

// ─── the run ──────────────────────────────────────────────────────────────────────────────────────────────────────
const A = { email: `gate-a-${stamp}@isp-gate.example`, corp: "Halden Survey Works" };
const B = { email: `gate-b-${stamp}@isp-gate.example`, corp: "Oriel Freight Syndicate" };
let browser;
try {
  log(`out ${OUT}`);
  certificate();
  log("building the production image...");
  docker(["build", "-q", "-t", IMAGE, ROOT], { timeout: 20 * 60_000 });
  docker(["network", "create", NAME.net]);
  docker(["volume", "create", NAME.vol]);
  docker(["run", "-d", "--name", NAME.smtp, "--network", NAME.net, "--network-alias", "smtp-catcher", "--user", "root", "-v", `${certs}:/certs:ro`, "-v", `${mails}:/mails`, IMAGE, "node", "/certs/catcher.mjs"]);
  port = await freePort();
  await startApp(true);
  log(`app up at ${base()} (production image, 0.5 CPU, 1 GiB, TLS mail to a local catcher)`);
  browser = await chromium.launch({ args: [ALLOW_RESTRICTED_PORTS_ARG] });

  // 1. the public pages and account A's first hour, at 1280
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const a = await ctxA.newPage();
  watchErrors(a, "A");
  for (const [id, route] of [["landing", "/"], ["how-to-start", "/how-to-start.html"], ["login", "/login.html"], ["register", "/register.html"]]) {
    await step(a, `public-${id}`, `the public page ${route}`, async () => { await a.goto(`${base()}${route}`); });
  }
  await step(a, "a-register", "A registers; the site says to check the mail", () => register(a, "Halden", A.email, A.corp));
  await step(a, "a-verified", "A opens the emailed link, verifies, and signs in", async () => {
    await verifyAndSignIn(a, A.email);
    await declineBriefing(a);
  });
  await step(a, "a-inbox", "the inbox: the licence letter", () => openTab(a, "inbox"));
  await step(a, "a-office", "rent an office for 7 days", async () => {
    await openTab(a, "station"); await openStationOffices(a);
    await a.click('[data-building-action="building:orbital-executive-suites"]');
    await a.selectOption("#rent-office-duration", "7");
    await a.click("#rent-office-btn"); await receipt(a);
  });
  await step(a, "a-hire", "hire five", async () => {
    await a.fill("#office-hire-count", "5"); await a.click('#office-hire-form button[type="submit"]'); await receipt(a);
  });
  await step(a, "a-lease", "file the Earth claim", async () => {
    await a.click("#station-back-btn"); await openStationOffices(a);
    await a.click('[data-building-action="building:isa-claims-leases"]');
    await a.click('[data-action="purchase-lease"][data-body="Earth"]'); await receipt(a);
  });
  await step(a, "a-yard", "commission a yard", async () => {
    await a.click('[data-action="manage-lease"]'); await a.click("#lease-build-extractor-btn"); await receipt(a);
  });
  await step(a, "a-cycle", "start a cycle, and wait for the first tonnes", async () => {
    const f = a.locator('[data-form="mine"]');
    await f.locator('[name="amount"]').fill("250"); await f.locator('[name="hours"]').fill("24");
    await f.locator('button[type="submit"]').click(); await receipt(a);
    await a.locator('.extractor [data-live="mined"]').filter({ hasNotText: /^0( t)?$/ }).waitFor({ timeout: 120_000 });
  });
  await step(a, "a-sell", "sell to the standing order", async () => {
    await openTab(a, "market");
    await a.locator('[data-npc-item="Silicates"]').first().click();
    await a.click("#trade-confirm-ok"); await receipt(a);
  });
  await step(a, "a-research", "queue research", async () => {
    await openTab(a, "rnd"); await a.click('.research__enqueue[data-tech-id="tt-basic-extraction"]'); await receipt(a);
  });
  await step(a, "a-contract", "accept a contract", async () => {
    await openTab(a, "missions");
    await a.locator("[data-agent-id]").first().click();
    await a.locator("[data-mission-id]").first().click();
    await a.click("#mission-accept-btn"); await receipt(a);
  });

  // 2. every screen at 1280, as a first-hour corporation sees it
  log("sweeping every screen at 1280...");
  await sweep(a, "a1280");
  await ctxA.storageState({ path: path.join(work, "a-state.json") });

  // 3. account B arrives, then the world is advanced to what weeks of play give (stated)
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const b = await ctxB.newPage();
  watchErrors(b, "B");
  await step(b, "b-register", "B registers", () => register(b, "Oriel", B.email, B.corp));
  await step(b, "b-verified", "B verifies from the emailed link and signs in", async () => {
    await verifyAndSignIn(b, B.email);
    await declineBriefing(b);
  });
  await ctxA.close(); await ctxB.close();
  log("fast-forward: weeks of play...");
  patch("weeks", { a: A.email, b: B.email });
  await startApp();

  // 4. trading and fighting, in the browser
  const ctxA2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const a2 = await ctxA2.newPage(); watchErrors(a2, "A");
  const ctxB2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const b2 = await ctxB2.newPage(); watchErrors(b2, "B");
  const signIn = async (page, email) => {
    await page.goto(`${base()}/login.html`);
    await page.fill("#login-email", email); await page.fill("#login-password", PASSWORD);
    await page.click('#login-form button[type="submit"]');
    await page.waitForURL(/\/\?account=/, { timeout: 20_000 });
    await page.locator("#logout-btn").waitFor({ state: "visible", timeout: 20_000 });
    // the first-day briefing is offered again on every new browser, whatever the level (a finding of this run)
    if (await briefingOffered(page)) results.checks.briefingReoffered = [...(results.checks.briefingReoffered || []), email.split("@")[0]];
  };
  await step(a2, "a-lists", "A lists 200 Silicates on the Exchange at 30", async () => {
    await signIn(a2, A.email);
    await openTab(a2, "market"); await openExchangePage(a2, "players");
    await a2.fill('[data-sell-qty="Silicates"]', "200"); await a2.fill('[data-sell-price="Silicates"]', "30");
    await a2.click('[data-sell-item="Silicates"]'); await a2.click("#trade-confirm-ok"); await receipt(a2);
  });
  await step(b2, "b-buys", "B buys 150 of A's Silicates", async () => {
    await signIn(b2, B.email);
    await openTab(b2, "market"); await openExchangePage(b2, "players");
    const row = b2.locator("#exchange-buy-table tr", { hasText: A.corp }).first();
    await row.locator("[data-buy-order-qty]").fill("150"); await row.locator("[data-buy-order-id]").click();
    await b2.click("#trade-confirm-ok"); await receipt(b2);
  });
  await step(a2, "a-sold", "A sees the sale in its trade history", async () => {
    await a2.reload(); await a2.locator("#logout-btn").waitFor({ state: "visible", timeout: 20_000 });
    await openTab(a2, "market"); await openExchangePage(a2, "history");
  });
  await step(b2, "b-fleet", "B forms a fleet from its reserve: 6 destroyers and 12 attack troops", async () => {
    await openTab(b2, "fleet");
    const form = b2.locator("[data-fleet-form]");
    await form.locator('[data-form-count="ds"]').fill("6");
    await form.locator('[data-form-count="at"]').fill("12");
    await form.locator("[data-fleet-form-submit]").click();
    await receipt(b2).catch(() => {});
    await b2.locator("[data-fleet]").first().waitFor({ timeout: 20_000 });
  });
  await step(b2, "b-raid", "B declares a raid on A's holdings at Earth", async () => {
    await openTab(b2, "fleet");
    const raidsTab = b2.locator('#fleet [role=tab]', { hasText: /raid/i }).first();
    if (await raidsTab.isVisible().catch(() => false)) await raidsTab.click();
    await b2.locator(`#fleet-raids [data-raid-target]`).first().waitFor({ timeout: 20_000 });
    await b2.locator(`#fleet-raids li[data-target]`, { hasText: A.corp }).locator("[data-raid-target]").click();
    const ok = b2.locator("#trade-confirm-ok");
    if (await ok.isVisible({ timeout: 3_000 }).catch(() => false)) await ok.click();
    await b2.locator(".raid-list__item", { hasText: A.corp }).first().waitFor({ timeout: 20_000 });
  });
  await step(a2, "a-warned", "A is warned of the raid coming", async () => {
    await a2.reload(); await a2.locator("#logout-btn").waitFor({ state: "visible", timeout: 20_000 });
    await openTab(a2, "overview");
  });
  await ctxA2.close(); await ctxB2.close();
  log("fast-forward: the raid arrives...");
  patch("arrive", {});
  await startApp();
  await sleep(40_000); // the raid tick runs every 30 s
  const ctxB3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const b3 = await ctxB3.newPage(); watchErrors(b3, "B");
  await step(b3, "b-report", "B reads its raid report", async () => {
    await signIn(b3, B.email); await openTab(b3, "fleet");
    const raidsTab = b3.locator('#fleet [role=tab]', { hasText: /raid/i }).first();
    if (await raidsTab.isVisible().catch(() => false)) await raidsTab.click();
    await b3.locator("#fleet-raids [data-raid-report]").first().click({ timeout: 20_000 });
  });
  await ctxB3.close();

  // 5. every screen at 375, for A after its weeks
  const ctxA3 = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const a3 = await ctxA3.newPage(); watchErrors(a3, "A-phone");
  await step(a3, "a-phone-raid-report", "A, on a phone, reads the defender's report", async () => {
    await signIn(a3, A.email); await openTab(a3, "fleet");
    const raidsTab = a3.locator('#fleet [role=tab]', { hasText: /raid/i }).first();
    if (await raidsTab.isVisible().catch(() => false)) await raidsTab.click();
    await a3.locator("#fleet-raids [data-raid-report]").first().click({ timeout: 20_000 });
  });
  log("sweeping every screen at 375...");
  await sweep(a3, "a375");
  await ctxA3.storageState({ path: path.join(work, "a-state.json") });
  await ctxA3.close();

  // 6. the return visit: the app restarts, and A's browser comes back with the session it saved
  log("return visit...");
  stopApp();
  await sleep(5_000);
  await startApp();
  const ctxA4 = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: path.join(work, "a-state.json") });
  const a4 = await ctxA4.newPage(); watchErrors(a4, "A-return");
  await step(a4, "a-return", "A returns: the page opens on its saved session (or asks to sign in)", async () => {
    await a4.goto(`${base()}/`);
    await a4.waitForLoadState("networkidle").catch(() => {});
    results.checks.returnVisit = { url: a4.url(), signedIn: await a4.locator("#logout-btn").isVisible().catch(() => false) };
  });
  await step(a4, "a-return-notifications", "A's notifications after the return", async () => {
    if (!(await a4.locator("#logout-btn").isVisible().catch(() => false))) await signIn(a4, A.email);
    const bell = a4.locator("#notifications-btn, [data-action='notifications'], button", { hasText: /Notifications/ }).first();
    await bell.click();
  });
  await ctxA4.close();

  // the checks a run can answer
  const telemetry = docker(["run", "--rm", "-v", `${NAME.vol}:/data`, IMAGE, "sh", "-c", "cat /data/telemetry/*.jsonl 2>/dev/null || true"], { allowFail: true });
  const rows = telemetry.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const byEvent = {};
  for (const r of rows) byEvent[r.event] = (byEvent[r.event] || 0) + 1;
  results.checks.telemetry = { rows: rows.length, byEvent, sample: rows[0] ? Object.keys(rows[0]) : [] };
  const allow = JSON.parse(fs.readFileSync(path.join(ROOT, "data/design-allowlist.json"), "utf8"));
  const entries = Array.isArray(allow) ? allow : (allow.entries || allow.allow || Object.values(allow).find(Array.isArray) || []);
  results.checks.designAllowlist = { entries: entries.length };
  results.checks.mails = fs.readdirSync(mails).length;
} catch (error) {
  results.fatal = String(error?.stack || error).slice(0, 2000);
  log(`FATAL ${results.fatal}`);
} finally {
  await browser?.close().catch(() => {});
  results.appLogTail = docker(["logs", "--tail", "40", NAME.app], { allowFail: true }).split("\n").slice(-40);
  for (const n of [NAME.app, NAME.smtp]) docker(["rm", "-f", n], { allowFail: true });
  docker(["volume", "rm", NAME.vol], { allowFail: true });
  docker(["network", "rm", NAME.net], { allowFail: true });
  results.endedAt = new Date().toISOString();
  save();
  fs.rmSync(work, { recursive: true, force: true });
}

// the report
const ok = results.steps.filter((s) => s.ok).length;
const lines = [
  `# ISP 1.0 release-candidate gate run (AB#971)`, ``,
  `Commit ${results.commit}, ${results.startedAt} to ${results.endedAt}. Production image, 0.5 CPU, 1 GiB, real TLS mail to a local catcher (scripts/rc-gate.mjs).`, ``,
  `## Steps: ${ok} of ${results.steps.length} passed`, ``,
  ...results.steps.map((s) => `- ${s.ok ? "ok" : "**FAILED**"} ${s.id}: ${s.what}${s.error ? ` (${s.error})` : ""}. \`shots/${s.shot}\``), ``,
  `## Fast-forwards (the saved world advanced with the server's own code, the app stopped)`, ``,
  ...results.fastForwards.map((f) => `- ${f.step}: ${JSON.stringify(f.result)}`), ``,
  `## Screens: ${results.screens.length} (${results.screens.filter((s) => s.width >= 600).length} at 1280, ${results.screens.filter((s) => s.width < 600).length} at 375)`, ``,
  `Scrolls sideways at 375: ${results.sideways.length ? results.sideways.map((s) => `${s.name} (${s.px}px)`).join(", ") : "none"}.`, ``,
  `Nearly empty: ${results.screens.filter((s) => s.nearlyEmpty).map((s) => `${s.label}/${s.name}`).join(", ") || "none"}.`, ``,
  `## Page errors: ${results.pageErrors.length}`, ``,
  ...results.pageErrors.slice(0, 60).map((e) => `- ${e.who} ${e.url.replace(/^https?:\/\/[^/]+/, "")}: ${e.message}`), ``,
  `## Checks`, ``,
  `- Telemetry rows stored: ${results.checks.telemetry?.rows ?? "not read"}; by event: ${JSON.stringify(results.checks.telemetry?.byEvent ?? {})}.`,
  `- Design allowlist entries: ${results.checks.designAllowlist?.entries ?? "not read"} (the gate asks for 0).`,
  `- Mails caught: ${results.checks.mails ?? 0}.`,
  `- Return visit: ${JSON.stringify(results.checks.returnVisit ?? {})}.`,
  `- First-day briefing offered again on a later sign-in (a new browser): ${(results.checks.briefingReoffered || []).join(", ") || "never"}.`,
  ...(results.fatal ? [``, `## Stopped early`, ``, "```", results.fatal, "```"] : [])
];
fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n") + "\n");
log(`report: ${path.join(OUT, "report.md")}`);
