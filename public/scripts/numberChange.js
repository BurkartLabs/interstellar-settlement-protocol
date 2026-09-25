// public/scripts/numberChange.js
// AB#745 (ISP-59): when credits, employees, building slots, fleet cap or inventory change, the number counts to its new
// value where it is shown and is briefly coloured, up and down told apart. Direction: flat (Board Decision AB#1801):
// no glow, colour only, tabular numerals.
//
// A renderer marks a number with numberMarkup() (data-num-key, data-num-value); nothing else is wired into it. One
// MutationObserver, installed once by app.js, sees every render path (full re-renders and the socket handlers that
// redraw one panel) and compares each marked number with the value last seen on screen.
//
// Only a number that is on screen when it changes is acknowledged. One changed in a hidden browser tab, an inactive
// game tab or a collapsed panel is recorded silently, so coming back replays nothing (acceptance 4). With
// prefers-reduced-motion the value is written at once and the colour appears without a transition (the stylesheet's
// reduced-motion block), for the same time.
import { prefersReducedMotion } from "./motion.js";

/** How long the count from the old value to the new one runs. */
export const COUNT_MS = 450;
/** How long the up or down colour stays on; the stylesheet fades it in and out over --motion-fade (under 1s in all). */
export const HIGHLIGHT_MS = 650;

/** "up", "down", or null when either value is not a number or nothing changed. */
export function changeDirection(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === after) return null;
  return after > before ? "up" : "down";
}

/** The value `elapsed` ms into a count from `from` to `to` over `duration`, eased out and never past `to`. */
export function valueAt(from, to, elapsed, duration = COUNT_MS) {
  const t = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 1;
  const eased = 1 - Math.pow(1 - t, 3);
  return from + (to - from) * eased;
}

/**
 * The rendered text with its first number replaced by `n`, rounded, so the count keeps the renderer's own prefix and
 * suffix ("$233,000", "5", "12,400"). Every number these views show is grouped from 1,000 up, so the count is too,
 * with fixed en-US grouping rather than the locale's (T-061). The values counted are never negative.
 */
export function textWith(renderedText, n) {
  const text = String(renderedText ?? "");
  const match = /\d[\d,]*/.exec(text);
  if (!match) return text;
  const digits = Math.round(Math.abs(n)).toLocaleString("en-US");
  return text.slice(0, match.index) + digits + text.slice(match.index + match[0].length);
}

/**
 * What each marked number last showed on screen. observe() answers whether a change should be acknowledged, and
 * records the new value either way, so a change nobody saw is never replayed later.
 */
export function createChangeTracker() {
  const seen = new Map();
  return {
    observe(key, value, { visible }) {
      const before = seen.get(key);
      seen.set(key, value);
      if (!visible || before === undefined) return null;
      const direction = changeDirection(before, value);
      return direction ? { direction, from: before, to: value } : null;
    },
    forget() { seen.clear(); }
  };
}

const escapeAttr = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escapeText = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A marked number: `text` is what the renderer shows, `value` the number behind it, `key` a stable name for it. */
export function numberMarkup(key, value, text = String(value)) {
  return `<span class="num-live" data-num-key="${escapeAttr(key)}" data-num-value="${escapeAttr(Number(value))}">${escapeText(text)}</span>`;
}

// ─── The page side ──────────────────────────────────────────────────────────

const tracker = createChangeTracker();
const HIGHLIGHT_CLASSES = ["num-change--up", "num-change--down"];

function isOnScreen(el, doc) {
  if (doc.hidden) return false;
  return el.isConnected && el.getClientRects().length > 0;
}

function acknowledge(el, change, win) {
  const finalText = el.textContent;
  el.classList.remove(...HIGHLIGHT_CLASSES);
  el.classList.add(`num-change--${change.direction}`);
  const clear = () => el.classList.remove(`num-change--${change.direction}`);
  win.setTimeout(clear, HIGHLIGHT_MS);

  if (prefersReducedMotion(win)) return; // the value is already final; the colour is the acknowledgement

  // The render has already written the new value; show the old one before the browser paints (a MutationObserver
  // callback runs before the next frame), or the new value flashes for a frame before the count starts from below it.
  el.textContent = textWith(finalText, change.from);
  const start = win.performance?.now?.() ?? Date.now();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (el.isConnected && el.dataset.numValue === String(change.to)) el.textContent = finalText;
  };
  const step = (now) => {
    if (done || !el.isConnected || el.dataset.numValue !== String(change.to)) return;
    const elapsed = now - start;
    if (elapsed >= COUNT_MS) return finish();
    el.textContent = textWith(finalText, valueAt(change.from, change.to, elapsed));
    win.requestAnimationFrame(step);
  };
  // requestAnimationFrame does not run in a hidden tab (T-028), so a timer always writes the final value.
  win.setTimeout(finish, COUNT_MS + 50);
  win.requestAnimationFrame(step);
}

/** Look at every marked number under `root` and acknowledge the ones that changed on screen. */
export function scanNumbers(root, { win = globalThis, doc = win.document } = {}) {
  const els = [];
  if (root?.nodeType === 1 && root.matches?.("[data-num-key]")) els.push(root);
  if (root?.querySelectorAll) els.push(...root.querySelectorAll("[data-num-key]"));
  for (const el of els) {
    const value = Number(el.dataset.numValue);
    if (!Number.isFinite(value)) continue;
    const change = tracker.observe(el.dataset.numKey, value, { visible: isOnScreen(el, doc) });
    if (change) acknowledge(el, change, win);
  }
}

/** Install once: every render that adds or re-marks a number is scanned. Returns the observer. */
export function installNumberAcknowledgement({ win = globalThis, doc = win.document } = {}) {
  if (!win.MutationObserver || !doc?.body) return null;
  scanNumbers(doc.body, { win, doc }); // what is on screen at start is the baseline, not a change
  const observer = new win.MutationObserver((records) => {
    const roots = new Set();
    for (const r of records) {
      if (r.type === "attributes") roots.add(r.target);
      for (const node of r.addedNodes || []) if (node.nodeType === 1) roots.add(node);
      if (r.type === "childList" && r.target?.nodeType === 1 && r.target.matches?.("[data-num-key]")) roots.add(r.target);
    }
    for (const root of roots) scanNumbers(root, { win, doc });
  });
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-num-value"] });
  return observer;
}
