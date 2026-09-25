import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { htmlAttr, refineryBuildButtonHtml } from "../../public/scripts/html.js";

// Bug #1254: with every building slot used, the Build Refinery button's data-disabled-reason="${...} had no closing
// quote. The attribute swallowed the label and the start of the warning, so the card showed
// '...Current usage: 2/2.>Build Refinery</button><p class=' and the error line quoted it.

/** The attributes and text of the first <button> in an HTML string, read the way a browser tokenises the tag. */
function firstButton(html) {
  const open = html.match(/^<button((?:\s+[a-z-]+="[^"]*")*)\s*>/);
  if (!open) return null;
  const attrs = Object.fromEntries([...open[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const rest = html.slice(open[0].length);
  const close = rest.indexOf("</button>");
  return { attrs, text: rest.slice(0, close), after: rest.slice(close + "</button>".length) };
}

describe("Build Refinery with no free building slot (Bug #1254)", () => {
  it("keeps its label, and carries the slot reason in a closed attribute", () => {
    const html = refineryBuildButtonHtml({ hasRefinery: false, used: 2, slots: 2 });
    const button = firstButton(html);
    expect(button).not.toBeNull();
    expect(button.text).toBe("Build Refinery");
    expect(button.attrs["data-disabled-reason"]).toBe("Refinery requires 1 open building slot. Current usage: 2/2.");
    expect(button.after).toBe('<p class="muted" style="color:var(--color-warn)">No open building slots. Current usage: 2/2.</p>');
  });

  it("puts no markup inside an attribute, so nothing of the tag reaches the screen", () => {
    const html = refineryBuildButtonHtml({ hasRefinery: true, used: 4, slots: 4 });
    const attrs = [...html.matchAll(/="([^"]*)"/g)].map((m) => m[1]);
    expect(attrs.some((v) => v.includes("<") || v.includes(">"))).toBe(false);
    expect(firstButton(html).text).toBe("Build 2nd Refinery");
    expect(html.match(/<\/button>/g)).toHaveLength(1);
  });

  it("with a free slot, has no reason and no warning", () => {
    const html = refineryBuildButtonHtml({ hasRefinery: false, used: 1, slots: 2 });
    expect(html).toBe('<button class="btn btn-outline refinery-build-btn">Build Refinery</button>');
  });
});

describe("htmlAttr", () => {
  it("quotes and escapes, and leaves out an absent value", () => {
    expect(htmlAttr("data-x", 'a "quoted" <b>&')).toBe(' data-x="a &quot;quoted&quot; &lt;b&gt;&amp;"');
    expect(htmlAttr("data-x", null)).toBe("");
    expect(htmlAttr("data-x", undefined)).toBe("");
    expect(htmlAttr("data-x", false)).toBe("");
    expect(htmlAttr("data-n", 0)).toBe(' data-n=""'); // escapeHtml treats 0 as empty; no caller passes a number
  });
});

// The same mistake anywhere: an attribute opened with ="${ whose interpolation is not followed by the closing quote.
const SCRIPTS = new URL("../../public/scripts/", import.meta.url);

/** Each ="${...} in a source, with the character after the interpolation's closing brace. Braces nest. */
export function unclosedAttributes(source) {
  const found = [];
  let at = source.indexOf('="${');
  while (at >= 0) {
    let depth = 1;
    let i = at + 4;
    for (; i < source.length && depth > 0; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
    }
    if (source[i] !== '"') found.push({ line: source.slice(0, at).split("\n").length, next: source[i] });
    at = source.indexOf('="${', i);
  }
  return found;
}

describe("Every interpolated attribute in public/scripts closes its quote (Bug #1254)", () => {
  it("finds none unclosed", () => {
    const bad = [];
    // AB#739: recursive, so the tab modules in public/scripts/views/ are scanned too.
    const files = readdirSync(SCRIPTS, { recursive: true }).map((f) => f.replaceAll("\\", "/")).filter((f) => f.endsWith(".js"));
    expect(files).toContain("views/station.js");
    for (const file of files) {
      for (const hit of unclosedAttributes(readFileSync(new URL(file, SCRIPTS), "utf8"))) bad.push(`${file}:${hit.line} (then ${JSON.stringify(hit.next)})`);
    }
    expect(bad).toEqual([]);
  });

  it("the scan sees the Bug #1254 line as it was", () => {
    const before = '` data-disabled-reason="${escapeHtml(`Refinery requires ${a}/${b}.`)}` : ""}>Build Refinery</button>';
    expect(unclosedAttributes(before)).toEqual([{ line: 1, next: "`" }]);
    expect(unclosedAttributes('` data-disabled-reason="${escapeHtml(`x ${a}`)}"` : ""}>')).toEqual([]);
  });
});
