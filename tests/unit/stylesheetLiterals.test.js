import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";

// ISP-71 (AB#760): outside the design-token block, git grep in public/styles.css finds no hex colour, no rgb( and no
// px font size: the stylesheet's values are the tokens (ISP-70, Decision AB#1801). The grep is run as written; what it
// finds inside the token block, where the values are defined, and inside comments is set aside, and the comments are
// held to holding issue references only (AB#1760, Bug #983 look like hex to a grep), never a colour.
const REPO = fileURLToPath(new NodeURL("../..", import.meta.url));
const FILE = "public/styles.css";
const PATTERN = String.raw`#[0-9a-fA-F]{3,8}\b|\brgba?\(|font-size\s*:\s*[0-9.]+px`;

function gitGrep() {
  try {
    return execFileSync("git", ["grep", "-n", "-E", PATTERN, "--", FILE], { cwd: REPO, encoding: "utf8" });
  } catch (error) {
    if (error.status === 1) return ""; // git grep's "no match"
    throw error;
  }
}

/** Every match the grep's lines hold, with where it sits in the file. */
function hits() {
  const css = readFileSync(new NodeURL(`../../${FILE}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const lineStart = [0];
  for (let i = 0; i < css.length; i++) if (css[i] === "\n") lineStart.push(i + 1);
  const blockFrom = css.indexOf("/* ─── Design tokens");
  const blockTo = css.indexOf("/* ─── End of design tokens ─── */");
  const comments = [...css.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => [m.index, m.index + m[0].length]);
  const lines = gitGrep().split("\n").filter(Boolean).map((l) => Number(/^[^:]+:(\d+):/.exec(l)[1]));
  const out = [];
  for (const n of new Set(lines)) {
    const text = css.slice(lineStart[n - 1], lineStart[n] ?? css.length);
    for (const m of text.matchAll(new RegExp(PATTERN, "g"))) {
      const at = lineStart[n - 1] + m.index;
      const where = at >= blockFrom && at <= blockTo ? "block" : comments.some(([a, b]) => at >= a && at < b) ? "comment" : "code";
      out.push({ line: n, match: m[0], where, before: css.slice(Math.max(0, at - 10), at) });
    }
  }
  return { out, blockFrom, blockTo };
}

describe("styles.css outside the token block (ISP-71)", () => {
  const { out, blockFrom, blockTo } = hits();

  it("the grep runs, and finds the token block's own values (so it is looking at the right file)", () => {
    expect(blockFrom).toBeGreaterThanOrEqual(0);
    expect(blockTo).toBeGreaterThan(blockFrom);
    expect(out.filter((h) => h.where === "block").length).toBeGreaterThan(20);
  });

  it("has no hex colour, no rgb( and no px font size", () => {
    expect(out.filter((h) => h.where === "code").map((h) => `${FILE}:${h.line} ${h.match}`)).toEqual([]);
  });

  it("its comments hold issue references, never a colour", () => {
    const notIssues = out.filter((h) => h.where === "comment" && !(/^#\d+$/.test(h.match) && /(AB|Bug|Critique|PR|Issue|Decision)\s*$/.test(h.before)));
    expect(notIssues.map((h) => `${FILE}:${h.line} ${h.before}${h.match}`)).toEqual([]);
  });
});
