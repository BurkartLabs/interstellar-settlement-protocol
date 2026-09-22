import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// AB#737: one module per system. No module under server/ grows past 800 lines (server/index.js excepted, for now), and
// the game modules import only from modules earlier in the layer order, so there are no import cycles.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORDER = ["catalog", "progression", "mining", "refining", "asteroids", "shape", "corporation", "world", "store", "messaging"];

function serverFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? serverFiles(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));
}

describe("one module per system (AB#737)", () => {
  it("no module under server/ exceeds 800 lines, except server/index.js", () => {
    const over = serverFiles(path.join(ROOT, "server"))
      .filter((f) => path.relative(ROOT, f).replace(/\\/g, "/") !== "server/index.js")
      .map((f) => [path.relative(ROOT, f).replace(/\\/g, "/"), fs.readFileSync(f, "utf8").split("\n").length])
      .filter(([, n]) => n > 800);
    expect(over).toEqual([]);
  });

  it("server/gameState.js only re-exports", () => {
    // Split on CRLF too: a Windows checkout has CRLF endings, and "$" does not match before "\r".
    const code = fs.readFileSync(path.join(ROOT, "server/gameState.js"), "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("//"));
    for (const line of code) expect(line).toMatch(/^export \{[^}]+\} from "\.\/game\/[a-z]+\.js";$/);
  });

  it("every game module is in the layer order, and imports only from modules before it", () => {
    const files = fs.readdirSync(path.join(ROOT, "server/game")).map((f) => f.replace(/\.js$/, ""));
    expect(files.sort()).toEqual([...ORDER].sort());
    for (const m of ORDER) {
      const src = fs.readFileSync(path.join(ROOT, "server/game", `${m}.js`), "utf8");
      for (const [, dep] of src.matchAll(/^import [^;]* from "\.\/([a-z]+)\.js";/gm)) {
        expect(ORDER.indexOf(dep), `${m} imports ${dep}`).toBeLessThan(ORDER.indexOf(m));
      }
    }
  });
});
