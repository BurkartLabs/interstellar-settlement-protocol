import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { walkthroughScrollDelta, WALKTHROUGH_SCROLL_MARGIN as M } from "../../public/scripts/walkthrough.js";

// Bug #1083: the walkthrough scrolled each highlighted control to the centre of the window, and on a phone the
// briefing card covers the bottom of the screen past its middle, so the control landed behind the card. Measured on
// main at 375x812: card 323-796, header 0-171, the Station tab scrolled to 390-421, all of it under the card.
const rect = (top, bottom, left = 0, right = 375) => ({ top, bottom, left, right });
const after = (target, delta) => rect(target.top - delta, target.bottom - delta, target.left, target.right);

describe("where the walkthrough scrolls the control it points at (Bug #1083)", () => {
  it("on a phone the control ends up between the header and the card, not behind the card", () => {
    const card = rect(447, 796, 16, 344); // capped at 45vh by the phone rule
    const target = rect(390, 421, 176, 245);
    const moved = after(target, walkthroughScrollDelta({ viewportHeight: 812, headerBottom: 171, card, target }));
    expect(moved.top).toBeGreaterThanOrEqual(171 + M);
    expect(moved.bottom).toBeLessThanOrEqual(card.top - M);
  });

  it("the old measurement: a control under the card is scrolled up out of it", () => {
    const card = rect(323, 796, 16, 344);
    const target = rect(390, 421, 176, 245);
    const delta = walkthroughScrollDelta({ viewportHeight: 812, headerBottom: 171, card, target });
    expect(delta).toBeGreaterThan(0); // scrolling the page down moves the control up the screen
    expect(after(target, delta).bottom).toBeLessThanOrEqual(323 - M);
  });

  it("a control below the fold is brought up into the band", () => {
    const card = rect(447, 796, 16, 344);
    const target = rect(1500, 1532, 40, 120);
    const moved = after(target, walkthroughScrollDelta({ viewportHeight: 812, headerBottom: 171, card, target }));
    expect(moved.top).toBeGreaterThanOrEqual(171 + M);
    expect(moved.bottom).toBeLessThanOrEqual(447 - M);
  });

  it("on a desktop the card is not in the control's column, so the band runs to the bottom of the window", () => {
    const card = rect(444, 784, 829, 1249);
    const target = rect(869, 901, 371, 430); // an office's Enter button, just below the fold at 1280x800
    const moved = after(target, walkthroughScrollDelta({ viewportHeight: 800, headerBottom: 72, card, target }));
    expect(moved.top).toBeGreaterThanOrEqual(72 + M);
    expect(moved.bottom).toBeLessThanOrEqual(800 - M);
  });

  it("on a desktop a control in the card's column is kept above the card", () => {
    const card = rect(444, 784, 829, 1249);
    const target = rect(600, 632, 900, 980);
    const moved = after(target, walkthroughScrollDelta({ viewportHeight: 800, headerBottom: 72, card, target }));
    expect(moved.bottom).toBeLessThanOrEqual(444 - M);
  });

  it("a control already clear is not scrolled at all", () => {
    const card = rect(447, 796, 16, 344);
    expect(walkthroughScrollDelta({ viewportHeight: 812, headerBottom: 171, card, target: rect(250, 281, 40, 120) })).toBe(0);
    expect(walkthroughScrollDelta({ viewportHeight: 800, headerBottom: 72, card: rect(444, 784, 829, 1249), target: rect(105, 137, 492, 561) })).toBe(0);
  });

  it("a control taller than the band shows its top", () => {
    const card = rect(447, 796, 16, 344);
    const target = rect(900, 1500, 16, 344);
    const moved = after(target, walkthroughScrollDelta({ viewportHeight: 812, headerBottom: 171, card, target }));
    expect(moved.top).toBe(171 + M);
  });

  it("no card (between steps) leaves the whole window below the header", () => {
    const target = rect(1000, 1032, 40, 120);
    const moved = after(target, walkthroughScrollDelta({ viewportHeight: 812, headerBottom: 171, card: null, target }));
    expect(moved.top).toBeGreaterThanOrEqual(171 + M);
    expect(moved.bottom).toBeLessThanOrEqual(812 - M);
  });
});

describe("the briefing card leaves room on a phone (Bug #1083)", () => {
  it("is capped at 45vh and scrolls inside, under the phone breakpoint", () => {
    const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");
    const rule = css.match(/@media \(max-width: 767px\) \{\s*#walkthrough-modal \.modal-card \{([^}]*)\}/);
    expect(rule, "phone rule for the walkthrough card").toBeTruthy();
    expect(rule[1]).toMatch(/max-height:\s*45vh;/);
    expect(rule[1]).toMatch(/overflow-y:\s*auto;/);
  });
});
