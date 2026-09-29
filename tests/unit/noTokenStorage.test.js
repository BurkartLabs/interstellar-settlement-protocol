import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clientSources } from "../helpers/clientSource.js";

// AB#757 (D-0.5-2): no login token is written to localStorage or sessionStorage, where any script on the page can
// read it. The refresh token is an HttpOnly cookie (tests/integration/auth-cookie.test.js) and the access token lives
// in memory. This reads every module each page loads, found from the pages' own <script type="module"> tags, so the
// login and register pages are covered as well as the game, and a new page is covered without editing this file.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pages = fs.readdirSync(path.join(ROOT, "public")).filter((f) => f.endsWith(".html"));
const entries = pages.flatMap((page) =>
  [...fs.readFileSync(path.join(ROOT, "public", page), "utf8").matchAll(/<script type="module" src="([^"]+)"/g)].map((m) =>
    path.posix.join("public", m[1])
  )
);
const sources = new Map();
for (const entry of entries) for (const [file, text] of clientSources(entry)) sources.set(file, text.replace(/\r\n/g, "\n"));

describe("login tokens are never put in web storage (AB#757)", () => {
  it("reads the modules the game, login and register pages load", () => {
    // Bug #4836: the game's page enters through boot.js, which reaches app.js by a dynamic import that clientSources follows
    expect(entries).toEqual(expect.arrayContaining(["public/scripts/boot.js", "public/scripts/login-page.js", "public/scripts/register-page.js"]));
    expect([...sources.keys()]).toEqual(expect.arrayContaining(["public/scripts/app.js", "public/scripts/apiClient.js"]));
  });

  it("no module writes anything token-shaped to storage, and none uses sessionStorage", () => {
    const hits = [];
    for (const [file, text] of sources) {
      text.split("\n").forEach((line, i) => {
        if (/setItem\([^)]*token/i.test(line) || /sessionStorage/.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("the old token keys are named only in the list that removes them from an older build's storage", () => {
    const named = [];
    for (const [file, text] of sources) {
      text.split("\n").forEach((line, i) => {
        if (/isp\.(access|refresh)Token/.test(line)) named.push(`${file}:${i + 1}`);
      });
    }
    expect(named).toHaveLength(1);
    const [file] = named[0].split(":");
    expect(sources.get(file)).toMatch(/const LEGACY_TOKEN_KEYS = \["isp\.accessToken", "isp\.refreshToken"\];/);
    expect(sources.get(file)).toMatch(/for \(const key of LEGACY_TOKEN_KEYS\) localStorage\.removeItem\(key\);/);
  });
});
