import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// AB#2131: the starfield drew on every page and no player ever saw it. body is an in-flow block, so an opaque body
// background paints above the fixed negative-z layers, and .app-bg (opaque since the flat direction, AB#760) sat above
// the canvas. This reads styles.css as data; what the screen shows is e2e/focus-and-motion.spec.js, which compares
// screenshots of the page's margin.
const CSS = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of every top-level rule whose selector list is exactly `selector`, merged in source order. */
function declarations(selector) {
  const out = {};
  for (const m of CSS.matchAll(/(?<=^|\})\s*([^{}@]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() !== selector) continue;
    for (const d of m[2].split(";")) {
      const at = d.indexOf(":");
      if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).trim();
    }
  }
  return out;
}

describe("the starfield reaches the screen", () => {
  it("body is clear, so it does not paint over the fixed background layers", () => {
    expect(declarations("body").background).toBe("transparent");
  });

  it("the starfield canvas sits above the .app-bg layer", () => {
    // Bug #4886: the two are z-index tokens now (--z-starfield, --z-backdrop); read through the token block
    const layer = (v) => Number(/^-?\d+$/.test(v ?? "") ? v : new RegExp(`${v?.match(/var\((--z-[\w-]+)\)/)?.[1]}:\\s*(-?\\d+);`).exec(CSS)?.[1]);
    const canvas = layer(declarations("#starfield-canvas")["z-index"]);
    const appBg = layer(declarations(".app-bg")["z-index"]);
    expect(canvas).toBeGreaterThan(appBg);
    expect(canvas).toBeLessThan(0);
  });
});
