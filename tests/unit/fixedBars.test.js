import { describe, it, expect } from "vitest";
import { fixedBarEdges } from "../../public/scripts/helpers.js";

// AB#2468: on a phone the navigation is two rows fixed along the top, so what scrolls a control into view must stop
// below them; a bar in the window's lower half still covers its bottom (the old phone shell, or a pinned bar to come).
describe("fixedBarEdges: what the fixed bars cover, at the top and at the bottom", () => {
  it("bars in the upper half cover the top, to the lowest of them", () => {
    expect(fixedBarEdges([{ top: 0, bottom: 53 }, { top: 53, bottom: 106 }, { top: 57, bottom: 101 }], 812)).toEqual({ top: 106, bottom: 812 });
  });
  it("a bar in the lower half covers the bottom, from the highest of them", () => {
    expect(fixedBarEdges([{ top: 759, bottom: 812 }, { top: 706, bottom: 759 }], 812)).toEqual({ top: 0, bottom: 706 });
  });
  it("no bars (a desktop), or bars with no height, cover nothing", () => {
    expect(fixedBarEdges([], 800)).toEqual({ top: 0, bottom: 800 });
    expect(fixedBarEdges([{ top: 0, bottom: 0 }, null, { top: NaN, bottom: 5 }], 800)).toEqual({ top: 0, bottom: 800 });
  });
});
