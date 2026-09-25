import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

// AB#1113: the stylesheet and app.js used var(--color-accent), var(--color-warn) and more that nothing defines. An
// undefined custom property fails silently: the declaration is dropped and the element keeps whatever it inherits, so
// refinery warnings were not amber and the active forum thread had no accent. This reads everything under public/ as
// data: every var(--name) must be defined somewhere under public/, or carry its own fallback. A new undefined name
// fails here instead of shipping grey.
const PUBLIC = fileURLToPath(new URL("../../public", import.meta.url));

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(css|js|html)$/.test(name) ? [p] : [];
  });
}

function scan() {
  const defined = new Set();
  const uses = [];
  for (const file of files(PUBLIC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
    for (const m of text.matchAll(/setProperty\(\s*["'](--[a-zA-Z0-9-]+)["']/g)) defined.add(m[1]);
    text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,)?/g)) {
        uses.push({ name: m[1], fallback: Boolean(m[2]), at: `${relative(PUBLIC, file).replace(/\\/g, "/")}:${i + 1}` });
      }
    });
  }
  return { defined, uses };
}

describe("CSS custom properties (AB#1113)", () => {
  const { defined, uses } = scan();

  it("finds the uses it is meant to check", () => {
    expect(uses.length).toBeGreaterThan(100);
    expect(uses.some((u) => u.name === "--warn")).toBe(true);
  });

  it("every var() without a fallback names a property that is defined", () => {
    const silent = uses.filter((u) => !u.fallback && !defined.has(u.name)).map((u) => `${u.name} at ${u.at}`);
    expect(silent).toEqual([]);
  });

  it("the --color-* names all resolve, with or without a fallback", () => {
    const missing = [...new Set(uses.filter((u) => u.name.startsWith("--color-") && !defined.has(u.name)).map((u) => u.name))];
    expect(missing).toEqual([]);
  });
});
