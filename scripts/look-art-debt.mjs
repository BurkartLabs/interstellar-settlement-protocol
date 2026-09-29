// AB#949 (ISP-253): the screens whose Unicode-glyph icons were removed, at 1280x800, for a human look: the forum's thread
// list and a thread (Reply, Quote, Like, the like and reply counts), the Assignments tab with a remote contract (its
// Remote badge and docking warning) and the completed log. Seeds a corporation docked at Mars Orbital Dock with Elara
// Voss's contract active (she is at Earth Station Prime, so it is remote) and one contract completed, in a scratch data
// directory; starts its own server on a port the OS picks; posts a thread, a reply and a like over HTTP; shoots; stops
// the server and removes the directory.
//
// Usage: node scripts/look-art-debt.mjs <outDir>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { openTab, openStationOffices } from "../e2e/nav.mjs";
import { ALLOW_RESTRICTED_PORTS_ARG } from "./chromium-ports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] || "docs/ab-949");
const SECRET = "art-debt-look-fixture-secret-0123456789abcdef";
const PASSWORD = "playtest-password-not-real";
const email = `art-debt-${Date.now()}@example.test`;
fs.mkdirSync(outDir, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-art-debt-"));

// The seed runs in its own process with the scratch directory as ISP_DATA_DIR, through the server's own account code.
const SEED = `
  const store = await import("./server/gameState.js");
  const { issueVerificationToken, verifyEmailToken } = await import("./server/emailVerification.js");
  const { refreshContractOfferings } = await import("./server/game/corporation.js");
  const { account } = await store.createAccount({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(PASSWORD)}, ceoName: "Art Debt QA", corpName: "Art Debt QA Corp" });
  verifyEmailToken(issueVerificationToken(account.id));
  store.mutateAccountState(account.id, (state) => {
    const [offer] = refreshContractOfferings(state.corp).missions;
    state.corp.activeMissions = [{ ...offer, acceptedAt: Date.now() }];
    state.corp.completedMissions = [{ id: "ms-done", title: "Survey Data Retrieval", type: "Survey", agentId: offer.agentId, reward: offer.reward, completedAt: Date.now() - 3_600_000 }];
    state.corp.currentStationId = "mars-orbital-dock";
  });
  store.markWalkthroughCompleted(account.id);
  const docked = await store.createAccount({ email: "earth-" + ${JSON.stringify(email)}, password: ${JSON.stringify(PASSWORD)}, ceoName: "Earth QA", corpName: "Earth QA Corp" });
  verifyEmailToken(issueVerificationToken(docked.account.id));
  store.mutateAccountState(docked.account.id, (state) => { state.corp.currentStationId = "earth-station-prime"; });
  store.markWalkthroughCompleted(docked.account.id);
  await store.saveAccountsNow();
`;
const seeded = spawnSync(process.execPath, ["--input-type=module", "-e", SEED], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ISP_DATA_DIR: dir, JWT_SECRET: SECRET, NODE_ENV: "test" } });
if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

const server = spawn(process.execPath, ["server/index.js"], { cwd: ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "" }, stdio: ["ignore", "pipe", "pipe"] });
const base = await new Promise((resolve, reject) => {
  let out = "";
  const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
  const read = (chunk) => {
    out += chunk;
    const port = out.match(/listening on port (\d+)/)?.[1];
    if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); }
  };
  server.stdout.on("data", read);
  server.stderr.on("data", read);
  server.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
});

const browser = await chromium.launch({ args: [ALLOW_RESTRICTED_PORTS_ARG] });
try {
  const api = async (method, url, token, body) => {
    const res = await fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
  const { accessToken } = await api("POST", "/api/auth/login", null, { email, password: PASSWORD });
  const created = await api("POST", "/api/forums/threads", accessToken, { category: "General", title: "Silicate bids after the quota change", body: "Has anyone else seen the Silicates bid settle lower in the evening?" });
  const threadId = created.thread?.id || created.id;
  await api("POST", `/api/forums/threads/${threadId}/replies`, accessToken, { content: "Yes, about a credit by 20:00 UTC on a busy day." });
  await api("POST", `/api/forums/threads/${threadId}/like`, accessToken, {});

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);

  const shoot = async (name) => {
    await page.waitForTimeout(400);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${name}: sideways scroll ${wide}px`);
    await page.screenshot({ path: path.join(outDir, `${name}-1280x800.png`) });
  };
  const scrollTo = (sel) => page.evaluate((s) => {
    const top = document.querySelector(s).getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top - document.querySelector(".app-header").getBoundingClientRect().height - 12);
  }, sel);

  await openTab(page, "forums");
  await page.locator(`[data-thread-id="${threadId}"]`).waitFor();
  console.log("thread card:", (await page.locator(`[data-thread-id="${threadId}"]`).innerText()).replace(/\s+/g, " "));
  await scrollTo(`[data-thread-id="${threadId}"]`);
  await shoot("forums-threads");
  await page.click(`[data-thread-id="${threadId}"]`);
  await page.locator('[data-action="quote"]').first().waitFor();
  console.log("thread actions:", (await page.locator(".forums__post-actions").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")));
  await shoot("forums-thread");

  await openTab(page, "missions");
  await page.locator("#active-mission-list [data-location]").first().waitFor();
  console.log("location badge:", await page.locator("#active-mission-list [data-location]").first().innerText());
  await scrollTo("#active-mission-list");
  await shoot("assignments-active");
  await scrollTo("#completed-missions-section");
  console.log("log entry:", (await page.locator("#completed-mission-log li").first().innerText()).replace(/\s+/g, " "));
  await shoot("assignments-log");

  // The station offices' headers: the Executive Suites, one of the three with art, and one of the offices that has
  // none (docs/design/ART_DEBT.md, "needs art"), from a corporation docked at Earth Station Prime.
  await page.click("#logout-btn");
  await page.waitForURL(/login|\/$/);
  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", `earth-${email}`);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  for (const [name, id] of [["station-executive-suites", "orbital-executive-suites"], ["station-development-bank", "deep-space-development-bank"]]) {
    await openTab(page, "station");
    if (await page.locator("#station-back-btn").isVisible()) await page.click("#station-back-btn"); // out of the last office
    await openStationOffices(page);
    await page.click(`[data-building-action="building:${id}"]`);
    await page.locator("#station-building-content .station__building-header").first().waitFor();
    console.log(`${name}: art class ${await page.locator("#station-building-content").evaluate((el) => [...el.classList].filter((c) => c.startsWith("station__art--")).join(" ") || "none")}`);
    await scrollTo("#station-building-content");
    await shoot(name);
  }
  console.log(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
} finally {
  await browser.close();
  server.kill();
  await new Promise((r) => (server.exitCode !== null ? r() : server.once("exit", r)));
  fs.rmSync(dir, { recursive: true, force: true });
}
