import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { ACCOUNT_KEY, opensGame } from "../../public/scripts/boot.js";

// Bug #4836: index.html's entry loads the game only for a visit that opens it; the logged-out landing loads none of it.
const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
const store = (value) => ({ getItem: (key) => (key === ACCOUNT_KEY ? value : null) });

describe("which visits open the game (Bug #4836)", () => {
  it("opens it for an account in the URL, a remembered one, or the dev dummy login", () => {
    expect(opensGame("https://isp.example/?account=abc", store(null))).toBe(true);
    expect(opensGame("https://isp.example/", store("abc"))).toBe(true);
    expect(opensGame("https://isp.example/?dummy=1", store(null))).toBe(true);
  });

  it("shows the landing to a visitor with neither, or whose storage is blocked", () => {
    expect(opensGame("https://isp.example/", store(null))).toBe(false);
    expect(opensGame("https://isp.example/?dummy=0", store(""))).toBe(false);
    expect(opensGame("https://isp.example/", { getItem: () => { throw new Error("blocked"); } })).toBe(false);
    expect(opensGame("https://isp.example/", undefined)).toBe(false);
  });
});

describe("boot.js keeps in step with what it stands in for", () => {
  it("reads the account from the key state.js writes", () => {
    expect(read("public/scripts/state.js")).toMatch(new RegExp(`accountId:\\s*"${ACCOUNT_KEY.replace(".", "\\.")}"`));
  });

  it("is index.html's one entry, and neither app.js nor Chart.js is a script tag any more", () => {
    const html = read("public/index.html");
    expect(html).toContain('<script type="module" src="scripts/boot.js"></script>');
    expect(html).not.toMatch(/<script[^>]+scripts\/app\.js/);
    expect(html).not.toMatch(/<script[^>]+chart\.umd/);
    // Bug #4838: boot.js does not load Chart.js either; the two views that chart do (chartLoader.js)
    expect(read("public/scripts/boot.js")).not.toMatch(/chart\.umd|CHART_SRC|loadChartJs|createElement\("script"\)/);
  });

  it("imports only legacyTokens.js, which imports nothing, so the landing loads no game module through it", () => {
    expect([...read("public/scripts/boot.js").matchAll(/^\s*import\s[^;]*?["']([^"']+)["']/gm)].map((m) => m[1])).toEqual(["./legacyTokens.js"]);
    expect(read("public/scripts/legacyTokens.js")).not.toMatch(/^\s*import\s/m);
  });

  it("app.js still boots when it is imported after the page has loaded", () => {
    expect(read("public/scripts/app.js")).toMatch(/document\.readyState === "loading"\) window\.addEventListener\("DOMContentLoaded", boot\);\s*else boot\(\);/);
  });
});
