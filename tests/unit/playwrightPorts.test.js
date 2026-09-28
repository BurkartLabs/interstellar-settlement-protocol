import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { ALLOW_RESTRICTED_PORTS_ARG, CHROMIUM_RESTRICTED_PORTS } from "../../scripts/chromium-ports.mjs";

// Bug AB#2313: a spec's server on PORT 0 was handed 5061, which Chromium refuses (net::ERR_UNSAFE_PORT). The fix
// allows Chromium's restricted ports for every spec's browser, from playwright.config.js. It holds only while every
// spec's browser comes from the config, so this fails if the config stops passing the flag, or a spec launches a
// browser of its own around it. e2e/unsafe-port.spec.js checks the list against the real browser.
const E2E = new URL("../../e2e/", import.meta.url);
const read = (url) => readFileSync(url, "utf8");

describe("Chromium's restricted ports are allowed for every spec (Bug AB#2313)", () => {
  it("the config launches every spec's browser with --explicitly-allowed-ports for the whole list", async () => {
    const config = (await import("../../playwright.config.js")).default;
    expect(config.use.launchOptions.args).toContain(ALLOW_RESTRICTED_PORTS_ARG);
    expect(ALLOW_RESTRICTED_PORTS_ARG).toBe(`--explicitly-allowed-ports=${CHROMIUM_RESTRICTED_PORTS.join(",")}`);
    expect(ALLOW_RESTRICTED_PORTS_ARG).toContain("5061"); // the one that failed
  });

  it("lists only ports an operating system can hand out, each once, in order", () => {
    expect(CHROMIUM_RESTRICTED_PORTS.every((p) => Number.isInteger(p) && p >= 1024 && p <= 65535)).toBe(true);
    expect([...CHROMIUM_RESTRICTED_PORTS].sort((a, b) => a - b)).toEqual([...CHROMIUM_RESTRICTED_PORTS]);
    expect(new Set(CHROMIUM_RESTRICTED_PORTS).size).toBe(CHROMIUM_RESTRICTED_PORTS.length);
  });

  it("no spec launches a browser of its own, outside the config, except the one that checks the list", () => {
    const own = readdirSync(E2E)
      .filter((f) => f.endsWith(".spec.js"))
      .filter((f) => /\b(chromium|firefox|webkit)\.launch(PersistentContext)?\(/.test(read(new URL(f, E2E))));
    expect(own).toEqual(["unsafe-port.spec.js"]);
  });
});
