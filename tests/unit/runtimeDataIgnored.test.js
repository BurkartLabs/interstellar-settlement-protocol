import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Bug #4806: without ISP_DATA_DIR the server writes its world into data/, next to the committed catalogues. Every file
// it writes there must be kept out of git (a `git add .` would publish players' chat, mail and the references salt) and
// out of the image (ops/infra/isp/deploy.ps1 builds from a developer's tree, and the Dockerfile copies data/). This
// finds each name the server joins onto its data directory and checks both ignore files cover it.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function serverFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? serverFiles(p) : e.name.endsWith(".js") ? [p] : [];
  });
}

/** Every "name" in path.join(dataDir, "name") (or a `dir = dataDir` parameter's path.join(dir, "name")) under server/. */
function runtimeNames() {
  const names = new Set();
  for (const file of serverFiles(path.join(ROOT, "server"))) {
    const src = fs.readFileSync(file, "utf8");
    if (!/\bdataDir\b/.test(src)) continue;
    for (const m of src.matchAll(/path\.join\(\s*(dataDir|dir)\s*,\s*"([^"]+)"/g)) {
      if (m[1] === "dir" && !/\bdir\s*=\s*dataDir\b/.test(src)) continue;
      names.add(m[2]);
    }
    if (/\.tmp\b/.test(src) && /dataDir/.test(src)) names.add("x.json.tmp");
  }
  return [...names].sort();
}

/** The paths to check for a name: the file itself, and something inside it when it is a folder (no extension). */
const candidates = (name) => (path.extname(name) ? [`data/${name}`] : [`data/${name}`, `data/${name}/x.jsonl`]);

/** A .dockerignore pattern as Docker reads it (Go's filepath.Match, plus **), matched against a path or any parent. */
function dockerIgnored(patterns, p) {
  const regexes = patterns.map((pat) => new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*") + "$"));
  const parts = p.split("/");
  return parts.some((_, i) => regexes.some((r) => r.test(parts.slice(0, i + 1).join("/"))));
}

describe("runtime files in data/ are ignored by git and docker (Bug #4806)", () => {
  const names = runtimeNames();

  it("finds the files the server writes (the scan is not empty)", () => {
    for (const known of ["state.json", "accounts-snapshot.json", "references-salt", "chat", "statements", "tariffs.json", "settlement-ledger.jsonl"]) {
      expect(names).toContain(known);
    }
  });

  it("git ignores every one", () => {
    const paths = names.flatMap(candidates);
    let out = "";
    try {
      out = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], { cwd: ROOT, input: paths.join("\n"), encoding: "utf8" });
    } catch (err) {
      out = err.stdout || ""; // exit 1 when none is ignored
    }
    const ignored = new Set(out.split(/\r?\n/).filter(Boolean));
    expect(paths.filter((p) => !ignored.has(p))).toEqual([]);
  });

  it(".dockerignore leaves every one out of the image", () => {
    const lines = fs.readFileSync(path.join(ROOT, ".dockerignore"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    // The matcher above does not model re-inclusion; keep the file free of it so the check stays honest.
    expect(lines.filter((l) => l.startsWith("!"))).toEqual([]);
    expect(names.flatMap(candidates).filter((p) => !dockerIgnored(lines, p))).toEqual([]);
  });

  it("the catalogues the image needs are not ignored", () => {
    const lines = fs.readFileSync(path.join(ROOT, ".dockerignore"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const tracked = execFileSync("git", ["ls-files", "data"], { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
    expect(tracked.length).toBeGreaterThan(5);
    expect(tracked.filter((p) => dockerIgnored(lines, p))).toEqual([]);
  });
});
