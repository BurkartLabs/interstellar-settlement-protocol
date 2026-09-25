import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// AB#1827: refinery-requirements-muted.spec.js captured its "before" by overwriting a file under public/ for one page
// load. Specs run against a shared checkout and a shared server, so any other spec, or a person playing, was served
// the pre-fix code while it ran. A spec that needs different client code serves it with page.route instead.
// Seed helpers (e2e/seed-*.mjs) write their own temporary data dirs and are not specs, so they are not checked here.
const E2E = new URL("../../e2e/", import.meta.url);
const WRITES = /\b(writeFileSync|writeFile|copyFileSync|copyFile|renameSync|rename|appendFileSync|appendFile|rmSync|unlinkSync)\s*\(/g;
// The one file operation a spec may make: removing its own temporary data dir (screenshots go through Playwright).
const ALLOWED = /fs\.(rmSync)\(dir,/;

describe("e2e specs never write to the checkout they test (AB#1827)", () => {
  const specs = readdirSync(E2E).filter((f) => f.endsWith(".spec.js"));

  it("finds the specs", () => {
    expect(specs.length).toBeGreaterThan(5);
  });

  it.each(specs)("%s writes no files outside its temporary data dir", (file) => {
    const lines = readFileSync(new URL(file, E2E), "utf8").split(/\r?\n/);
    const writes = lines
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => !line.startsWith("//") && line.match(WRITES) && !ALLOWED.test(line));
    expect(writes.map(({ n, line }) => `${file}:${n}: ${line}`)).toEqual([]);
  });
});
