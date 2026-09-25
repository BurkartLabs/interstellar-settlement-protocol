// @vitest-environment jsdom
import { readTokens, resolve } from "../../scripts/design-tokens.mjs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { URL as NodeURL } from "node:url"; // jsdom replaces the global URL, and readFileSync wants Node's
import {
  COUNT_MS, HIGHLIGHT_MS, changeDirection, valueAt, textWith, createChangeTracker, numberMarkup, scanNumbers
} from "../../public/scripts/numberChange.js";

// AB#745 (ISP-59): changing numbers are acknowledged where they are shown: counted to the new value and coloured
// for under a second, up and down told apart; at once, with a static colour, under prefers-reduced-motion; and never
// replayed for a change made while the tab was hidden.

describe("the rules (AB#745)", () => {
  it("tells up from down, and says nothing for no change or a missing value", () => {
    expect(changeDirection(5, 7)).toBe("up");
    expect(changeDirection(7, 5)).toBe("down");
    expect(changeDirection(5, 5)).toBeNull();
    expect(changeDirection(undefined, 5)).toBeNull();
    expect(changeDirection(5, Number.NaN)).toBeNull();
  });

  it("counts from the old value to the new one, eased, and never past it", () => {
    for (const [from, to] of [[5, 10], [233_000, 229_000], [0, 40]]) {
      expect(valueAt(from, to, 0)).toBe(from);
      expect(valueAt(from, to, COUNT_MS)).toBe(to);
      expect(valueAt(from, to, COUNT_MS * 3)).toBe(to);
      const mid = valueAt(from, to, COUNT_MS / 2);
      expect(Math.abs(mid - from)).toBeGreaterThan(Math.abs(to - from) / 2); // eased out: past halfway at half time
      expect(Math.abs(mid - from)).toBeLessThan(Math.abs(to - from));
    }
  });

  it("keeps the renderer's own prefix, suffix and grouping while it counts", () => {
    expect(textWith("$233,000", 231_512.6)).toBe("$231,513");
    expect(textWith("5", 7.2)).toBe("7");
    expect(textWith("12,400", 999)).toBe("999");
    expect(textWith("-", 3)).toBe("-");
  });

  it("acknowledges a change seen on screen, and records a change nobody saw without replaying it", () => {
    const t = createChangeTracker();
    expect(t.observe("employees", 5, { visible: true })).toBeNull(); // the first value is the baseline
    expect(t.observe("employees", 10, { visible: true })).toEqual({ direction: "up", from: 5, to: 10 });
    expect(t.observe("employees", 12, { visible: false })).toBeNull(); // changed while hidden
    expect(t.observe("employees", 12, { visible: true })).toBeNull(); // back on screen: nothing queued
    expect(t.observe("employees", 11, { visible: true })).toEqual({ direction: "down", from: 12, to: 11 });
  });

  it("marks a number with an escaped key and its value", () => {
    const html = numberMarkup('inventory:"x"<b>', 40, "40");
    expect(html).toContain('data-num-key="inventory:&quot;x&quot;&lt;b>"');
    expect(html).toContain('data-num-value="40"');
    expect(html).toContain(">40</span>");
  });

  it("keeps the highlight under one second including the stylesheet's fade in and out", () => {
    const css = readFileSync(new NodeURL("../../public/styles.css", import.meta.url), "utf8");
    // The fade is a design token (ISP-70): --motion-fade is an alias of --duration-base, followed to its value.
    const fade = parseFloat(resolve(readTokens(), "--motion-fade"));
    expect(Number.isFinite(fade)).toBe(true);
    expect(HIGHLIGHT_MS + fade).toBeLessThan(1000);
    expect(css).toMatch(/\.num-change--up\s*{[^}]*color:\s*var\(--change-up\)/);
    expect(css).toMatch(/\.num-change--down\s*{[^}]*color:\s*var\(--change-down\)/);
  });
});

describe("on the page (AB#745)", () => {
  let reduced = false;
  let hidden = false;
  const win = () => ({
    document,
    performance,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 16),
    matchMedia: () => ({ matches: reduced })
  });

  beforeEach(() => {
    vi.useFakeTimers();
    reduced = false;
    hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Render a marked number the way a view does (a fresh element each time), on screen unless told otherwise. */
  function render(key, value, text, { onScreen = true } = {}) {
    document.body.innerHTML = `<dd>${numberMarkup(key, value, text)}</dd>`;
    const el = document.querySelector("[data-num-key]");
    el.getClientRects = () => (onScreen ? [{ width: 10 }] : []);
    scanNumbers(document.body, { win: win(), doc: document });
    return el;
  }

  it("counts up, coloured as an increase, then settles on the rendered text with no colour, within a second", () => {
    render("employees:test1", 5, "5");
    const el = render("employees:test1", 10, "10");
    expect(el.classList.contains("num-change--up")).toBe(true);
    vi.advanceTimersByTime(16);
    expect(Number(el.textContent)).toBeGreaterThanOrEqual(5);
    expect(Number(el.textContent)).toBeLessThan(10);
    vi.advanceTimersByTime(COUNT_MS + 100);
    expect(el.textContent).toBe("10");
    vi.advanceTimersByTime(HIGHLIGHT_MS);
    expect(el.classList.contains("num-change--up")).toBe(false);
  });

  it("colours a decrease differently", () => {
    render("credits:test2", 233_000, "$233,000");
    const el = render("credits:test2", 229_000, "$229,000");
    expect(el.classList.contains("num-change--down")).toBe(true);
    expect(el.classList.contains("num-change--up")).toBe(false);
  });

  it("under reduced motion, shows the new value at once with the colour, and still clears it", () => {
    reduced = true;
    render("inventory:test3", 40, "40");
    const el = render("inventory:test3", 39, "39");
    expect(el.textContent).toBe("39");
    expect(el.classList.contains("num-change--down")).toBe(true);
    vi.advanceTimersByTime(16);
    expect(el.textContent).toBe("39"); // no count
    vi.advanceTimersByTime(HIGHLIGHT_MS);
    expect(el.classList.contains("num-change--down")).toBe(false);
  });

  it("does not replay changes made while the tab was hidden, however many arrived", () => {
    render("credits:test4", 100, "$100");
    hidden = true;
    for (const v of [110, 120, 130, 140]) render("credits:test4", v, `$${v}`); // socket updates in a hidden tab
    hidden = false;
    const el = render("credits:test4", 140, "$140"); // the next render after coming back
    expect(el.classList.contains("num-change--up")).toBe(false);
    expect(el.textContent).toBe("$140");
  });

  it("does not acknowledge a number that is not on screen (an inactive tab), nor replay it later", () => {
    render("slots:test5", 2, "2");
    render("slots:test5", 4, "4", { onScreen: false });
    const el = render("slots:test5", 4, "4");
    expect(el.classList.length).toBe(1); // num-live only
  });
});
