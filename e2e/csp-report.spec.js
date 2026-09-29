// AB#959: the CSP audit (npm run audit:csp) counts the violations Chromium posts to report-uri. A count of zero only
// means something if a real violation would have been counted, so this spec makes one and waits for it in the file.
//
// Run: `npx playwright test e2e/csp-report.spec.js` (it starts its own server, with its own report file, so its
// deliberate violation never lands in an audit's report).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "csp-report-e2e-fixture-secret-0123456789ab";

function startServer(dir, reportFile) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1", ISP_CSP_REPORT_FILE: reportFile },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => {
      out += chunk;
      const port = out.match(/listening on port (\d+)/)?.[1];
      if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}

test("Chromium posts a blocked inline script to report-uri, and the server writes it down", async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-csp-report-e2e-"));
  const reportFile = path.join(dir, "violations.jsonl");
  const { child, url } = await startServer(dir, reportFile);
  try {
    await page.goto(`${url}/login.html`);
    await expect(page.locator("#login-email")).toBeVisible();
    // A clean page load reports nothing.
    await page.waitForTimeout(500);
    expect(fs.existsSync(reportFile) ? fs.readFileSync(reportFile, "utf8") : "").toBe("");

    const ran = await page.evaluate(() => {
      window.__cspProbe = false;
      const s = document.createElement("script");
      s.textContent = "window.__cspProbe = true";
      document.body.appendChild(s);
      return window.__cspProbe;
    });
    expect(ran).toBe(false);
    await expect.poll(() => (fs.existsSync(reportFile) ? fs.readFileSync(reportFile, "utf8") : ""), { timeout: 10_000 }).toContain("script-src");
    const [first] = fs.readFileSync(reportFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(first.blocked).toBe("inline");
    expect(first.page).toContain("/login.html");
  } finally {
    child.kill();
  }
});
