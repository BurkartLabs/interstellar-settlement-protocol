// Bug AB#2313: a server a spec started on PORT 0 was handed 5061, which Chromium refuses outright
// (net::ERR_UNSAFE_PORT), and salvage-assignment.spec.js failed at page.goto. playwright.config.js now launches every
// spec's browser with --explicitly-allowed-ports for Chromium's restricted ports (scripts/chromium-ports.mjs). This
// checks it in the browser the specs actually run:
//   - a page served on a restricted port loads in the configured browser;
//   - every port on the list is refused by a browser launched without the flag (so the list is Chromium's, not a
//     guess) and not refused by the configured one (so the flag covers each of them).
// It starts its own servers and needs no BASE_URL. This is the one spec that launches a browser outside the config;
// tests/unit/playwrightPorts.test.js allows it and no other.
import { test, expect, chromium } from "@playwright/test";
import http from "node:http";
import { CHROMIUM_RESTRICTED_PORTS } from "../scripts/chromium-ports.mjs";

/** Listen on the first restricted port that is free here; null when none is. */
async function serveOnRestrictedPort() {
  for (const port of CHROMIUM_RESTRICTED_PORTS) {
    const server = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<title>restricted</title><p id=ok>served</p>"); });
    const ok = await new Promise((resolve) => { server.once("error", () => resolve(false)); server.listen(port, "127.0.0.1", () => resolve(true)); });
    if (ok) return { server, port };
  }
  return null;
}

/** What Chromium says about loading this port: "unsafe" when it refuses the port itself, else "reached". */
async function verdict(context, port) {
  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { timeout: 15_000 });
    return "reached";
  } catch (e) {
    return /ERR_UNSAFE_PORT/.test(String(e)) ? "unsafe" : "reached"; // refused by nothing listening is a reached port
  } finally {
    await page.close();
  }
}

test("a page on a port Chromium restricts loads in the specs' browser", async ({ page }) => {
  const served = await serveOnRestrictedPort();
  test.skip(!served, "every restricted port is in use on this machine");
  try {
    await page.goto(`http://127.0.0.1:${served.port}/`);
    await expect(page.locator("#ok")).toHaveText("served");
  } finally {
    served.server.close();
  }
});

test("every port on the list is refused without the flag, and allowed with it", async ({ context }) => {
  test.setTimeout(120_000);
  // no --explicitly-allowed-ports: Chromium's own behaviour. Inside a test, launch() takes the config's launchOptions
  // as its defaults, so the args are replaced outright, or this browser would carry the flag too.
  const bare = await chromium.launch({ args: [] });
  try {
    const bareContext = await bare.newContext();
    const withoutFlag = await Promise.all(CHROMIUM_RESTRICTED_PORTS.map((p) => verdict(bareContext, p)));
    const withFlag = await Promise.all(CHROMIUM_RESTRICTED_PORTS.map((p) => verdict(context, p)));
    const row = (vs) => Object.fromEntries(CHROMIUM_RESTRICTED_PORTS.map((p, i) => [p, vs[i]]));
    expect(row(withoutFlag), "a port Chromium does not restrict has no place on the list").toEqual(row(CHROMIUM_RESTRICTED_PORTS.map(() => "unsafe")));
    expect(row(withFlag), "the specs' browser must be allowed every listed port").toEqual(row(CHROMIUM_RESTRICTED_PORTS.map(() => "reached")));
  } finally {
    await bare.close();
  }
});
