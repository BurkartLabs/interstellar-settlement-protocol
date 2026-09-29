// AB#2043: once registrations from an address are spent, register.html says how long the server will keep refusing
// (an hour), not "Try again in a minute". Starts its own server with the registration limit at one, so the second
// registration from this browser is the refused one (the suites-flavor.spec.js self-contained-server pattern).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyAndLogIn } from "./verification.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "register-limit-e2e-secret-0123456789abcd";

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    // Not NODE_ENV=test: the production limiter, with its one-hour window, and a limit of one registration.
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "", JWT_SECRET: SECRET, ISP_DEV: "1", ISP_RATE_LIMIT_REGISTER_MAX: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => {
      out += chunk;
      const port = out.match(/listening on port (\d+)/)?.[1];
      if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}`, output: () => out }); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}

/**
 * Bug AB#2363: once, in a full run, the 1280x800 case's first goto failed with net::ERR_ABORTED, and it has not failed
 * since (24 repeats under load, a whole 321-test run). Nothing is retried, which would hide it. A failure instead says
 * what the spec's own server printed and whether it was still running, so the next one can be read.
 */
async function openRegister(page, server) {
  try {
    await page.goto(`${server.url}/register.html`);
  } catch (error) {
    const { exitCode, signalCode } = server.child; // a killed child has no exit code, only a signal
    const state = exitCode === null && signalCode === null ? "still running" : `stopped (${exitCode ?? signalCode})`;
    throw new Error(`${error.message}\nThe spec's server (${server.url}) was ${state}. It printed:\n${server.output().slice(-4000)}`);
  }
}

async function fillRegister(page, server, stamp) {
  await openRegister(page, server);
  await page.fill("#register-email", `limit-${stamp}@example.test`);
  await page.fill("#register-password", PASSWORD);
  await page.fill("#register-ceo", "Playtest CEO");
  await page.fill("#register-corp", `Limit Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
}

for (const viewport of VIEWPORTS) {
  test(`a refused registration says to wait an hour at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-register-limit-e2e-"));
    const server = await startServer(dir);
    const { child, url } = server;
    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const first = `${Date.now()}-a`;
      await fillRegister(page, server, first);
      await verifyAndLogIn(page, url, `limit-${first}@example.test`, PASSWORD); // AB#2288: verify, then log in
      await page.waitForURL(/\/\?account=/);

      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());
      await fillRegister(page, server, `${Date.now()}-b`);
      const status = page.locator("#register-status");
      await expect(status).toHaveText("Too many attempts. Try again in 60 minutes.");
      await expect(status).not.toContainText("in a minute");
      await page.screenshot({ path: path.join(SCREEN_DIR, `register-rate-limit-${viewport.label}.png`) });
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
