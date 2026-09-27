import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// AB#737: one module per system. No module under server/ grows past 800 lines, and the game modules import only from
// modules earlier in the layer order, so there are no import cycles. AB#1815 split server/index.js — the one file this
// rule used to except — into route modules under server/routes/, so the rule has no carve-out left.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORDER = ["items", "catalog", "stations", "units", "combat", "buildingIds", "progression", "mining", "refining", "beltRules", "belts", "asteroids", "shape", "corporation", "npcAsks", "world", "verificationPolicy", "store", "messaging", "conversations", "conglomerates", "membership", "conglomerateRoles", "conglomerateLevels", "treasury", "hangar"];

function serverFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? serverFiles(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));
}
const relPath = (f) => path.relative(ROOT, f).replace(/\\/g, "/");
// Read with CRLF folded to LF: a Windows checkout has CRLF endings, and "$" does not match before "\r".
const read = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
/** Every relative import in a file, resolved to a repo-relative path. */
function importsOf(file) {
  return [...read(file).matchAll(/^import\s+(?:[^;]*?\s+from\s+)?"(\.[^"]+)";/gm)].map(([, spec]) => relPath(path.resolve(path.dirname(file), spec)));
}

describe("one module per system (AB#737)", () => {
  it("no module under server/ exceeds 800 lines", () => {
    const over = serverFiles(path.join(ROOT, "server"))
      .map((f) => [relPath(f), fs.readFileSync(f, "utf8").split("\n").length])
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

// AB#1815: server/routes/ is a layer above everything else — route handlers call the game and the server helpers, and
// nothing below ever imports a route. index.js is the only file that mounts them.
describe("route modules sit on top, and nothing below imports them (AB#1815)", () => {
  const all = serverFiles(path.join(ROOT, "server"));
  const isRoute = (f) => f.startsWith("server/routes/");
  const HELPERS = "server/routes/helpers.js";
  const routeModules = all.map(relPath).filter((f) => isRoute(f) && f !== HELPERS);

  it("each route module registers its routes through one exported function, and exports nothing else", () => {
    expect(routeModules.length).toBeGreaterThan(0);
    for (const f of routeModules) {
      const src = read(path.join(ROOT, f));
      expect(src, f).toMatch(/^export function register[A-Z]\w*Routes\(app\) \{$/m);
      expect([...src.matchAll(/^export /gm)].length, `${f} exports only its register function`).toBe(1);
    }
  });

  it("only server/index.js imports a route module, and nothing imports server/index.js", () => {
    for (const f of all) {
      const from = relPath(f);
      for (const dep of importsOf(f)) {
        expect(dep, `${from} imports server/index.js`).not.toBe("server/index.js");
        if (isRoute(dep) && !isRoute(from)) expect(from, `${from} imports ${dep}`).toBe("server/index.js");
      }
    }
  });

  it("a route module imports no other route module but the shared helpers, and the helpers import no route module", () => {
    for (const f of routeModules) {
      for (const dep of importsOf(path.join(ROOT, f)).filter(isRoute)) expect(dep, `${f} imports ${dep}`).toBe(HELPERS);
    }
    expect(importsOf(path.join(ROOT, HELPERS)).filter(isRoute)).toEqual([]);
  });

  it("the game modules import nothing from the routes", () => {
    for (const f of all.map(relPath).filter((f) => f.startsWith("server/game/"))) {
      expect(importsOf(path.join(ROOT, f)).filter(isRoute), f).toEqual([]);
    }
  });

  it("server/index.js registers no route itself — app setup, middleware and mounting only — and mounts every route module", () => {
    const index = read(path.join(ROOT, "server/index.js"));
    expect(index.match(/\bapp\.(get|post|put|patch|delete|all)\(/g)).toBeNull();
    for (const f of routeModules) {
      const fn = read(path.join(ROOT, f)).match(/^export function (register\w+)\(app\)/m)[1];
      expect(index, `server/index.js mounts ${f}`).toMatch(new RegExp(`^${fn}\\(app\\);$`, "m"));
    }
  });
});
