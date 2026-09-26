import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// AB#1827: refinery-requirements-muted.spec.js captured its "before" by overwriting a file under public/ for one page
// load. Specs run against a shared checkout and a shared server, so any other spec, or a person playing, was served
// the pre-fix code while it ran. A spec that needs different client code serves it with page.route instead.
// Seed helpers (e2e/seed-*.mjs) write their own temporary data dirs and are not specs, so they are not checked here.
const E2E = new URL("../../e2e/", import.meta.url);
const WRITES = /\b(writeFileSync|writeFile|copyFileSync|copyFile|renameSync|rename|appendFileSync|appendFile|rmSync|unlinkSync)\s*\(/g;
// The one file operation a spec may make: removing its own temporary data dir.
const ALLOWED = /fs\.(rmSync)\(dir,/;

// AB#2251: the check above exempted screenshots, and six specs saved theirs into tracked docs/ folders, so every full
// run rewrote committed PNGs while this file stayed green. A screenshot, a trace or a folder a spec makes goes to an
// output folder git ignores, or to Playwright's testInfo.outputPath(). A screenshot a pull request needs is copied
// into docs/ on purpose by its author, never by every run.
export const OUTPUT_DIRS = ["e2e/screenshots", "test-results"];
const SINKS = /(\.screenshot|\btracing\.stop|\bmkdirSync|\bmkdir|\brecordVideo\s*:)\s*\(?/g;
const ROOT_JOIN = /path\.(?:join|resolve)\(\s*(?:REPO_ROOT|ROOT|process\.cwd\(\)|__dirname)\s*((?:,\s*(?:"[^"]*"|'[^']*'|`[^`$]*`)\s*)*)/g;

/** The text of a call's arguments from `start` (just after its open bracket) to the matching close, or to the end. */
function argsFrom(text, start) {
  let depth = 1;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "(" || text[i] === "{" || text[i] === "[") depth += 1;
    if (text[i] === ")" || text[i] === "}" || text[i] === "]") depth -= 1;
    if (depth === 0) return text.slice(start, i);
  }
  return text.slice(start);
}

/** `const NAME = <expression>` for every constant in a spec, so a sink's path can be followed through them. */
function constantsOf(text) {
  const out = new Map();
  for (const m of text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)) out.set(m[1], m[2]);
  return out;
}

/** An expression with the spec's own upper-case constants written out, a few levels deep. */
function expand(expr, constants) {
  let text = expr;
  for (let round = 0; round < 4; round += 1) {
    text = text.replace(/\b[A-Z_][A-Z0-9_]*\b/g, (name) => (constants.has(name) && name !== "REPO_ROOT" && name !== "ROOT" ? `(${constants.get(name)})` : name));
  }
  return text;
}

/** Where a sink writes, judged from its expanded path: "ok", or the reason it is not. */
function judge(expanded) {
  if (/\boutputPath\s*\(/.test(expanded)) return "ok";
  const joins = [...expanded.matchAll(ROOT_JOIN)];
  if (joins.length === 0) return /["'`](\.\/)?(docs|public|server|src)\b/.test(expanded) ? "a path inside the checkout" : "ok";
  for (const j of joins) {
    const parts = [...j[1].matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map((p) => p[1] ?? p[2] ?? p[3]).join("/");
    if (!OUTPUT_DIRS.some((d) => parts === d || parts.startsWith(`${d}/`))) return `${parts || "the repository root"}, which git tracks`;
  }
  return "ok";
}

/** Every screenshot, trace, video or folder a spec writes somewhere other than an ignored output folder. */
export function artifactWrites(text, file = "spec") {
  const constants = constantsOf(text);
  const lines = text.split("\n");
  const found = [];
  for (const m of text.matchAll(SINKS)) {
    const lineNo = text.slice(0, m.index).split("\n").length;
    const lineText = lines[lineNo - 1].trim();
    if (lineText.startsWith("//") || lineText.startsWith("*")) continue;
    const args = argsFrom(text, m.index + m[0].length);
    const target = m[1].startsWith(".screenshot") || m[1].includes("tracing") ? (args.match(/\bpath\s*:\s*([\s\S]*)/)?.[1] ?? "") : args;
    if (!target.trim()) continue; // a screenshot with no path is kept in memory, and writes nothing
    const verdict = judge(expand(target, constants));
    if (verdict !== "ok") found.push(`${file}:${lineNo}: ${lineText} -> ${verdict}`);
  }
  return found;
}

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

  it.each(specs)("%s saves screenshots, traces and folders only where git ignores them (AB#2251)", (file) => {
    expect(artifactWrites(readFileSync(new URL(file, E2E), "utf8"), file)).toEqual([]);
  });
});

describe("the artifact check can fail (AB#2251)", () => {
  const head = 'const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");\n';

  it("each output folder it allows is one git ignores", () => {
    const ignored = readFileSync(new URL("../../.gitignore", import.meta.url), "utf8").split(/\r?\n/).map((l) => l.trim().replace(/\/$/, ""));
    for (const dir of OUTPUT_DIRS) expect(ignored, dir).toContain(dir);
  });

  it("reports a screenshot into docs/ through a constant, as the six specs did", () => {
    const spec = `${head}const SHOT_DIR = path.join(REPO_ROOT, "docs", "ab-1857");\nfs.mkdirSync(SHOT_DIR, { recursive: true });\nawait page.screenshot({ path: path.join(SHOT_DIR, \`empty-\${v}.png\`) });\n`;
    const found = artifactWrites(spec);
    expect(found).toHaveLength(2);
    expect(found.join("\n")).toContain("docs/ab-1857, which git tracks");
  });

  it("reports one built from process.cwd(), through a helper, and one split over lines", () => {
    const spec = `const SHOT_DIR = path.join(process.cwd(), "docs", "ab-1202");\nconst shot = (page, name) => page.screenshot({ path: path.join(SHOT_DIR, \`\${name}.png\`) });\nawait panel.screenshot({\n  fullPage: true,\n  path: path.join(process.cwd(), "public", "x.png"),\n});\n`;
    expect(artifactWrites(spec)).toHaveLength(2);
  });

  it("reports a trace or a literal path into docs/, and one at the repository root", () => {
    expect(artifactWrites('await context.tracing.stop({ path: "docs/trace.zip" });\n')).toHaveLength(1);
    expect(artifactWrites(`${head}await page.screenshot({ path: path.join(REPO_ROOT, "shot.png") });\n`)).toHaveLength(1);
  });

  it("reports a video recorded into docs/, and allows one under test-results", () => {
    const into = (dir) => `${head}const VIDEO_DIR = path.join(REPO_ROOT, ${dir});\nconst context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: VIDEO_DIR, size: VIEWPORT } });\n`;
    expect(artifactWrites(into('"docs", "isp-59"'))).toHaveLength(1);
    expect(artifactWrites(into('"test-results", "isp-59-video"'))).toEqual([]);
  });

  it("allows the ignored folders, testInfo.outputPath() and a screenshot kept in memory", () => {
    const spec = `${head}const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");\nfs.mkdirSync(SCREEN_DIR, { recursive: true });\nawait page.screenshot({ path: path.join(SCREEN_DIR, "a.png") });\nawait page.screenshot({ path: path.join(REPO_ROOT, "test-results", "isp-62", "b.png") });\nawait page.screenshot({ path: testInfo.outputPath("c.png") });\nconst png = await page.screenshot();\n`;
    expect(artifactWrites(spec)).toEqual([]);
  });
});
