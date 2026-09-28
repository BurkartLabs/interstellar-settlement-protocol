// The Starmap canvas, as a spec finds its way around it: the labels and arcs the map draws, recorded by
// recordCanvas(), a system opened by its label, and where a belt is drawn. Taken from e2e/starmap-belt-tap.spec.js
// (AB#1344) for AB#2331's specs.
import { expect } from "@playwright/test";
import { tapStarByCatalog } from "./clusterStar.mjs"; // AB#808

/** Before the page loads: record every label the canvas writes and every arc it draws, in window.__labels/__arcs. */
export async function recordCanvas(page) {
  await page.addInitScript(() => {
    window.__labels = [];
    window.__arcs = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
      // Bug AB#4682: with the canvas's size, so a label drawn before the map was resized is not tapped where it was
      window.__labels.push({ t: String(text), x, y, w: this.measureText(String(text)).width, cw: this.canvas?.clientWidth, ch: this.canvas?.clientHeight });
      return fillText.call(this, text, x, y, ...rest);
    };
    const arc = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc = function (x, y, r, ...rest) {
      window.__arcs.push({ x, y, r });
      return arc.call(this, x, y, r, ...rest);
    };
  });
}

/** From a belt's or a system's view, back to the cluster. */
export async function backToCluster(page, canvas) {
  const back = await lastLabel(page, "◂ Back To Cluster");
  if (!back) return;
  await page.evaluate(() => { window.__labels = []; window.__arcs = []; });
  await canvas.click({ position: { x: back.x + back.w / 2, y: back.y - 3 } });
  await page.waitForTimeout(400);
}

export const lastLabel = (page, text) => page.evaluate((t) => window.__labels.filter((l) => l.t === t).pop(), text);
export const backShown = (page) => page.evaluate(() => window.__labels.some((l) => l.t.endsWith("Back To Cluster")));

/**
 * Taps a cluster star by its label: a star sits 10px plus its radius before its label or after it, or (ISP-82, AB#771:
 * a phone's 14px names move clear of each other) above or below it. A tap that opens another system, whose star sits
 * near this label, goes back and tries the next place: the details panel names the system that opened.
 */
/**
 * Bug AB#4682: what a tap opened, waiting for it (up to 3 s) rather than a fixed 400 ms: the system's name once the
 * system view is up and its panel names it, or null if no system opened. Under a batch run's load the view and its
 * panel title came after 400 ms, so a tap that worked read as a miss and openSystem gave up ("could not open").
 */
async function openedByTap(page, name) {
  const title = page.locator("#map-details .ui-panel__title");
  let seen = null;
  await expect.poll(async () => {
    if (!(await backShown(page))) return (seen = null);
    return (seen = ((await title.textContent()) || "").trim());
  }, { timeout: 3_000, intervals: [100, 200, 300] }).toBe(name).catch(() => {});
  return seen;
}

/**
 * Bug AB#4682: the label for `name` from a frame drawn at the canvas's size now. The map can grow between the frame a
 * spec last saw and the tap (on a phone it went from 320 to 560 px tall), and a star sits at a fraction of the canvas,
 * so an old frame's label pointed every tap at the wrong place. If the newest label is from another size, the map is
 * asked to redraw (a resize, as the page's own handler does) and the new frame's label is waited for.
 */
async function currentLabel(page, canvas, name) {
  const box = await canvas.boundingBox();
  const fits = (l) => l && (l.cw === undefined || (Math.abs(l.cw - box.width) < 2 && Math.abs(l.ch - box.height) < 2));
  const now = await lastLabel(page, name);
  if (!now || fits(now)) return now;
  await page.evaluate(() => { window.__labels = []; window.__arcs = []; window.dispatchEvent(new Event("resize")); });
  let fresh = null;
  await expect.poll(async () => fits((fresh = await lastLabel(page, name))), { timeout: 3_000 }).toBe(true).catch(() => {});
  return fits(fresh) ? fresh : null;
}

export async function openSystem(page, canvas, name) {
  // The map's back button is at its top edge, which a phone's fixed header can cover: tap with the map centred.
  await canvas.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const label = await currentLabel(page, canvas, name);
  if (!label) {
    // AB#808: a phone names only the current system, the selected one and its neighbours; the rest are dots.
    await canvas.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.evaluate(() => { window.__labels = []; window.__arcs = []; });
    await tapStarByCatalog(canvas, name);
    expect(await openedByTap(page, name), `${name} opens from its star`).toBe(name);
    return;
  }
  const spots = [[-17, -1], [-20, -1], [label.w + 17, -1], [label.w + 20, -1], [label.w / 2, -26], [label.w / 2, 20]];
  const box = await canvas.boundingBox();
  const onMap = ([dx, dy]) => label.x + dx >= 0 && label.x + dx <= box.width && label.y + dy >= 0 && label.y + dy <= box.height;
  for (const [dx, dy] of spots.filter(onMap)) {
    await page.evaluate(() => { window.__labels = []; window.__arcs = []; });
    await canvas.click({ position: { x: label.x + dx, y: label.y + dy } });
    const opened = await openedByTap(page, name); // Bug AB#4682: waited for, not assumed after 400 ms
    if (opened === name) return;
    if (opened === null) continue;
    const back = await lastLabel(page, "◂ Back To Cluster");
    await page.evaluate(() => { window.__labels = []; window.__arcs = []; });
    await canvas.click({ position: { x: back.x + back.w / 2, y: back.y - 3 } });
    await expect.poll(() => backShown(page), { timeout: 3_000 }).toBe(false); // back on the cluster before the next tap
  }
  throw new Error(`could not open ${name}`);
}

/**
 * Where a belt is drawn: drawAsteroidBelt fills its ring glow (radius + 8) and then strokes its ring (radius) about
 * the belt's centre, the radius being Math.max(10, body.radius + 5) in the system view.
 */
export async function beltCentre(page, radius) {
  return page.evaluate((r) => {
    const arcs = window.__arcs;
    for (let i = 0; i + 1 < arcs.length; i += 1) {
      const [glow, ring] = [arcs[i], arcs[i + 1]];
      if (glow.x === ring.x && glow.y === ring.y && Math.abs(ring.r - r) < 0.01 && Math.abs(glow.r - r - 8) < 0.01) {
        return { x: ring.x, y: ring.y };
      }
    }
    return null;
  }, radius);
}
