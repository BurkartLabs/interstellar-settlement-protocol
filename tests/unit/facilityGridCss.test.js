import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// Bug #1283: the Station's facility grid asked for 340px columns, and a 375px phone leaves it about 309px, so each card
// ran 31px past its panel. A column minimum wider than a phone's content box must give way to the space there is.
const CSS = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");
const PHONE_CONTENT_WIDTH = 309; // 375px, less the page gutters and the panel's padding, measured at 375x812

function rule(selector) {
  const at = CSS.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`${selector} not found in styles.css`);
  return CSS.slice(at, CSS.indexOf("}", at));
}

/** The fixed pixel minimums in a grid-template-columns value that nothing lets shrink below themselves. */
function unguardedMinimums(declaration) {
  return [...declaration.matchAll(/minmax\(\s*(min\([^)]*\)|\d+px)/g)]
    .map((m) => m[1])
    .filter((min) => !min.startsWith("min("))
    .map((min) => parseInt(min, 10));
}

describe("Station facility cards fit a phone (Bug #1283)", () => {
  it("the facility grid's column minimum gives way to the width there is", () => {
    const columns = rule("#station-facility-buildings").match(/grid-template-columns:\s*([^;]+);/)[1];
    expect(columns).toMatch(/minmax\(min\(340px, 100%\), 1fr\)/);
    expect(unguardedMinimums(columns).filter((px) => px > PHONE_CONTENT_WIDTH)).toEqual([]);
  });

  it("the check itself sees an unguarded minimum", () => {
    expect(unguardedMinimums("repeat(auto-fill, minmax(340px, 1fr))")).toEqual([340]);
    expect(unguardedMinimums("repeat(auto-fill, minmax(min(340px, 100%), 1fr))")).toEqual([]);
  });
});
