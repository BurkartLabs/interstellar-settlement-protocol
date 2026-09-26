import { describe, it, expect, vi } from "vitest";

// starmap.js preloads planet images when it is imported; node has no Image.
vi.stubGlobal("Image", class { set src(_) {} });
const { clusterLabelAt } = await import("../../public/scripts/starmap.js");

// ISP-82 (AB#771): on a phone the cluster's names are 14px, and Epsilon Eridani's ran across Alpha Centauri's. A name
// goes where it always went unless that crosses a label already placed or another star: then the other side, then
// below, then above. Measured on a 309x321 canvas (a phone's) and a 898x473 one (a desktop's).
const base = { size: 14, gap: 17, canvasWidth: 309, canvasHeight: 321 };

describe("the cluster's star names stay clear of each other (ISP-82)", () => {
  it("goes right of the star when nothing is in the way, as before", () => {
    const label = clusterLabelAt({ ...base, widths: [60], x: 100, y: 100 });
    expect([label.x, label.y]).toEqual([117, 101]);
  });

  it("goes left when the right runs off the canvas, as before", () => {
    const label = clusterLabelAt({ ...base, widths: [100], x: 255, y: 95 });
    expect(label.x).toBe(255 - 17 - 100);
  });

  it("moves off a label already placed: the other side, then below", () => {
    const alpha = clusterLabelAt({ ...base, widths: [97], x: 108, y: 83 }).box;
    // Epsilon Eridani: the right runs off the canvas, the left crosses Alpha Centauri's name, so it goes below.
    const eps = clusterLabelAt({ ...base, widths: [103], x: 255, y: 95, placed: [alpha] });
    expect(eps.y).toBeGreaterThan(95);
    expect(eps.box.left).toBeGreaterThanOrEqual(4);
    expect(eps.box.right).toBeLessThanOrEqual(309 - 4);
    expect(eps.box.top).toBeGreaterThan(alpha.bottom);
  });

  it("does not put a name across another star", () => {
    const label = clusterLabelAt({ ...base, widths: [60], x: 100, y: 100, stars: [{ x: 150, y: 100, r: 11 }] });
    expect(label.x).toBe(100 - 17 - 60);
  });

  it("with nowhere clear, falls back to where it always went", () => {
    const everywhere = [{ left: 0, right: 309, top: 0, bottom: 321 }];
    const label = clusterLabelAt({ ...base, widths: [60], x: 100, y: 100, placed: everywhere });
    expect([label.x, label.y]).toEqual([117, 101]);
  });

  it("keeps a second line (YOU ARE HERE) inside its box", () => {
    const one = clusterLabelAt({ ...base, widths: [30], x: 50, y: 160 }).box;
    const two = clusterLabelAt({ ...base, widths: [30, 90], x: 50, y: 160 }).box;
    expect(two.bottom - one.bottom).toBe(16);
    expect(two.right - two.left).toBe(90);
  });
});
