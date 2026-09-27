import { lanePairs, navigationFor } from "./navigation.js";
import { badgedStationCounts, placeStationBadges, systemStationMarkers } from "./stationMarkers.js"; // ISP-119 (AB#811), AB#2349
import { bodyResourceHtml } from "./bodyInfo.js"; // AB#740: what the catalogue holds, not a hash of the name
import { unrecoveredItemsHtml } from "./researchLinks.js"; // AB#885: a gated share on a scouted belt
import { systemName } from "./displayNames.js"; // AB#1336
import { drawProceduralBody, isProcedural } from "./bodyRender.js"; // AB#742
import { PLANET_IMAGE_PATHS } from "./planetImages.js";
import { officeLeaseCost } from "./ceoEffects.js"; // Bug #2340: the one office rate (Bug #1032)
import { isMemberStation, memberOfficeCost } from "./memberRates.js"; // ISP-212 (AB#907)
import { isConglomerateStation, isNeutralStation } from "./stationMarkers.js";
import { concentrationBand, concentrationLegendHtml, concentrationRows, concentrationText, overlayItems, systemConcentration, bodyConcentration } from "./resourceOverlay.js"; // ISP-143 (AB#837)
import { tariffPanelHtml } from "./tariffPanel.js"; // ISP-231 (AB#926)
import { DOMINANCE_OVERLAYS, QUIET_TOKEN, dominanceDetailsHtml, dominanceKey, dominanceLegendHtml, isDominanceOverlay, tokenRgba } from "./dominanceOverlay.js"; // ISP-218 (AB#913)
import { CONCESSION_OVERLAY, concessionDetailsHtml, concessionKey, concessionLegendHtml } from "./concessionOverlay.js"; // ISP-229 (AB#924)
import { chartFont } from "./charts.js"; // ISP-82 (AB#771): the map's labels are 14px on a phone, as the charts' are
import { utcClock } from "./timeFormat.js"; // ISP-249 (AB#945)

// ISP-112 (AB#804): each system's place on the cluster view is its `mapPosition` in data/systems.json, as fractions of
// the canvas; the controller reads it from the catalog it is given (getSystemsCatalog).

// Starmap system view: the innermost orbit's distance from the star, and the room kept between the outermost body and
// the canvas edge; labels keep this margin from the right edge (Bug #1315).
const ORBIT_INNER = 56;
const ORBIT_EDGE_MARGIN = 20;
const LABEL_EDGE_MARGIN = 4;
// ISP-116 (AB#808): below this cluster canvas width (a phone) only the current system, the selected one and their
// neighbours are named; and the grey a system the corporation cannot yet jump to is drawn in.
const COMPACT_CLUSTER_WIDTH = 600;
const LOCKED_STAR_COLOR = "rgba(140, 150, 165, 0.75)";
// How far an 11px label reaches above and below its baseline (AB#1337: kept off the star's halo).
const LABEL_ASCENT = 9;
const LABEL_DESCENT = 3;

const FALLBACK_PLANET_STYLE = {
  base: "#9bb4c8",
  shadow: "#2a3d4f",
  glow: "rgba(120, 200, 255, 0.35)"
};

const PLANET_STYLE = {
  mercury: { base: "#a39b8f", shadow: "#645e58", glow: "rgba(200, 180, 150, 0.35)" },
  venus: { base: "#d8b56a", shadow: "#8e6f3d", glow: "rgba(240, 190, 100, 0.4)" },
  earth: { base: "#3f84d8", shadow: "#24508d", glow: "rgba(70, 150, 255, 0.45)" },
  mars: { base: "#d97852", shadow: "#8f3f2b", glow: "rgba(240, 125, 86, 0.45)" },
  jupiter: { base: "#d1a97e", shadow: "#7d6248", glow: "rgba(230, 185, 135, 0.35)" },
  saturn: { base: "#d7c58a", shadow: "#82754d", glow: "rgba(230, 210, 140, 0.35)" },
  uranus: { base: "#7ec9d6", shadow: "#3d7a84", glow: "rgba(130, 220, 230, 0.35)" },
  neptune: { base: "#5478d6", shadow: "#32488a", glow: "rgba(96, 130, 230, 0.4)" }
};

/**
 * The Starmap's overlays, in picker order (index.html's #map-overlay lists the same, after None). Each colours a system
 * by one field data/systems.json holds, over its full scale. AB#1459: there is no resource overlay, because no system
 * carries resource data yet; the one that was here blended GDP and pirates under a resource label.
 */
export const STARMAP_OVERLAYS = {
  gdp: { label: "GDP Index", field: "gdpIndex", scale: 100 },
  activity: { label: "Activity Level", field: "activityLevel", scale: 100 },
  pirates: { label: "Pirate Density", field: "pirateDensity", scale: 40 }
};

/** A system's colour under an overlay; "none", or any overlay not offered, draws the plain map. */
export function overlayColor(system, overlay) {
  const spec = Object.hasOwn(STARMAP_OVERLAYS, overlay) ? STARMAP_OVERLAYS[overlay] : null;
  if (!spec) {
    return "rgba(0, 247, 255, 0.88)";
  }

  const value = Number(system[spec.field]) / spec.scale;
  const clamped = Math.max(0.1, Math.min(1, value));
  return `rgba(${Math.floor((1 - clamped) * 180 + 40)}, ${Math.floor(clamped * 220 + 30)}, 255, 0.92)`;
}

function hashSeed(input) {
  let h = 0;
  const text = String(input || "unknown");
  for (let i = 0; i < text.length; i += 1) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

const escBelt = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const RARITY_LABELS = { common: "Common", uncommon: "Uncommon", rare: "Rare", exotic: "Exotic" };
const SERIES = 5; // --series-1 to --series-5 in styles.css

/**
 * AB#2331: a belt scouted in its current generation: its rarity, its composition as one bar with a labelled legend
 * (largest share first), and what is left of the reserve every corporation on it shares (docs/design/belts.md).
 * `view` is the slot from GET .../belt-compositions; without it (an older server), the composition alone.
 */
export function scoutedBeltHtml(view, composition) {
  const entries = Object.entries(composition || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // Up to five parts, each its own colour; a belt of more (a rare template has twelve) shows its four largest and the
  // rest as one "Other" part in the last, muted colour, named beneath the legend. Five colours can be told apart.
  const shown = entries.length <= SERIES ? entries : entries.slice(0, SERIES - 1);
  const rest = entries.slice(shown.length);
  const parts = rest.length ? [...shown, ["Other", Math.round(rest.reduce((s, [, p]) => s + Number(p), 0) * 10) / 10]] : shown;
  const tone = (i) => `belt-bar__part--${i + 1}`;
  const rarity = view?.rarity ? ` <span class="ui-badge ui-badge--accent">${escBelt(RARITY_LABELS[view.rarity] || view.rarity)}</span>` : "";
  const bar = `<div class="belt-bar" role="img" aria-label="${escBelt(entries.map(([n, p]) => `${n} ${p}%`).join(", "))}">${
    parts.map(([, pct], i) => `<span class="belt-bar__part ${tone(i)}" style="width:${Number(pct)}%"></span>`).join("")}</div>`;
  const legend = `<ul class="belt-bar__legend">${parts.map(([name, pct], i) =>
    `<li><span class="belt-bar__swatch ${tone(i)}" aria-hidden="true"></span>${escBelt(name)} <strong>${escBelt(pct)}%</strong></li>`).join("")}</ul>${
    rest.length ? `
            <p class="ui-panel__meta belt-bar__other">Other: ${rest.map(([n, p]) => `${escBelt(n)} ${escBelt(p)}%`).join(", ")}</p>` : ""}`;
  let reserve = "";
  if (view && Number(view.reserve) > 0) {
    const left = Math.max(0, Number(view.remaining) || 0);
    const pct = Math.min(100, (left / view.reserve) * 100);
    reserve = `<h4 class="starmap__subhead">Reserve</h4>
            <div class="progress-wrap belt-reserve" role="progressbar" aria-label="Reserve left" aria-valuemin="0" aria-valuemax="${view.reserve}" aria-valuenow="${left}"><div class="progress-bar" style="width:${pct.toFixed(1)}%"></div></div>
            <p class="ui-panel__meta" data-belt-reserve>${left.toLocaleString("en-US")} of ${Number(view.reserve).toLocaleString("en-US")} units left (${Math.round(pct)}%). Every corporation mining here draws on it; when it runs out, the belt is gone.</p>`;
  }
  // ISP-208 (AB#903): a belt a conglomerate partner scouted, named, where the expedition is chosen.
  const shared = view?.sharedBy?.length ? `<p class="belt-shared" data-belt-shared><span class="ui-badge ui-badge--success">Shared intel</span> Scouted by ${escBelt(view.sharedBy.join(", "))}, ${view.sharedBy.length === 1 ? "a partner" : "partners"} in your conglomerate. You can launch here without scouting it yourself.</p>` : "";
  return `<h4 class="starmap__subhead">Material Composition${rarity}</h4>
            ${shared}
            ${bar}
            ${legend}
            ${reserve}`;
}

/** AB#2331: when an empty slot next draws, on the hour. ISP-249 (AB#945): in UTC only, as every time the game shows. */
export function nextDrawText(nextDrawAt) {
  if (!nextDrawAt) return "the next hour";
  return utcClock(nextDrawAt);
}

/** AB#2331: a slot whose belt was mined out: no belt, and when the next hourly chance of a new one is. */
export function emptyBeltHtml(view, chancePerHour) {
  const pct = Math.round((Number(chancePerHour) || 0.2) * 100);
  return `<div class="ui-state" data-belt-state="empty">
            <p class="ui-state__title">No belt here</p>
            <p class="ui-state__why">This belt was mined out. Each hour on the hour there is a ${pct}% chance a new one forms here, unscouted by anyone; the next chance is at ${escBelt(nextDrawText(view?.nextDrawAt))}.</p>
          </div>`;
}

/** Bug #2339: a refused scout or launch, said in the belt panel beside the button that met it. */
export function beltNoticeHtml(message) {
  return message ? `<div class="ui-state ui-state--error starmap__notice" role="alert"><p class="ui-state__why">${escBelt(message)}</p></div>` : "";
}

/** A scouted belt whose composition has not reached the page yet (Bug #1264): say so rather than show nothing. */
export function scoutedBeltLoadingHtml() {
  return `<p class="ui-panel__meta" data-belt-composition="loading">Scouted. Loading composition…</p>`;
}

function styleForBody(body) {
  return PLANET_STYLE[body.id] || FALLBACK_PLANET_STYLE;
}

/** The belt panel for an unscouted belt. Bug #1285: the Scout button is offered only to a corporation the server
 * will let scout (Asteroid Prospecting Arrays, in the belt's system: AB#1256); anyone else is told what to do instead
 * of meeting a button whose refusal only shows on the Overview tab. */
export function unscoutedBeltHtml({ hasProspecting, inSameSystem, systemName }) {
  const unknown = `<p class="ui-panel__meta">Material composition unknown. Scout this belt to reveal resource data.</p>`;
  if (!hasProspecting) {
    return `${unknown}
            <p class="starmap__status starmap__status--locked">Research <em>Asteroid Prospecting Arrays</em> in Corporate R&amp;D to scout this belt.</p>`;
  }
  if (!inSameSystem) {
    const name = String(systemName || "this system").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `${unknown}
            <p class="ui-panel__meta">Travel to ${name} to scout this belt.</p>`;
  }
  return `${unknown}
            <div><button id="scout-belt-btn" class="ui-button ui-button--secondary" type="button">Scout Asteroid Belt</button></div>`;
}

// ─── Planet image assets ─────────────────────────────────────────────────────
const PLANET_IMAGES = {};
export { PLANET_IMAGE_PATHS }; // AB#741, in planetImages.js since ISP-78 (AB#767)

function loadPlanetImage(bodyId) {
  if (PLANET_IMAGES[bodyId]) return PLANET_IMAGES[bodyId];
  const path = PLANET_IMAGE_PATHS[bodyId];
  if (!path) return null;
  const img = new Image();
  img.src = path;
  img.onload = () => {
    if (typeof _starmapRender === "function") _starmapRender();
  };
  PLANET_IMAGES[bodyId] = img;
  return img;
}

let _starmapRender = null;

/**
 * How a body is drawn (AB#742): a Field as a belt of asteroids, a Sol body from its image (AB#741), any other body
 * procedurally from its style in data/systems.json. "placeholder" is the plain gradient circle, which no body in the
 * catalogue should reach; tests/unit/bodyRender.test.js walks every body to hold that.
 */
export function bodyRenderKind(body) {
  if (body?.type === "Field") return "belt";
  if (PLANET_IMAGE_PATHS[body?.id]) return "image";
  if (isProcedural(body)) return "procedural";
  return "placeholder";
}

// Preload all planet images
Object.keys(PLANET_IMAGE_PATHS).forEach(loadPlanetImage);

function drawPlanet(ctx, body, x, y, radius) {
  const style = styleForBody(body);

  // Try image-based rendering first
  const img = PLANET_IMAGES[body.id];
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();

    // Draw image with aspect-ratio preservation (cover-fit into circle)
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const diam = radius * 2;
    const scale = Math.max(diam / iw, diam / ih);
    const drawW = iw * scale;
    const drawH = ih * scale;
    ctx.drawImage(img, x - drawW / 2, y - drawH / 2, drawW, drawH);
    ctx.restore();

    // Atmospheric glow ring
    const atmosGrad = ctx.createRadialGradient(x, y, radius, x, y, radius + 8);
    atmosGrad.addColorStop(0, style.glow);
    atmosGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = atmosGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
    ctx.fill();

    // Saturn rings
    if (body.id === "saturn") {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.28);
      // Outer ring
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 1.85, radius * 0.72, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(220, 200, 140, 0.5)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // Inner ring
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 1.55, radius * 0.58, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(200, 180, 120, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    return;
  }

  // AB#742: a body with no photograph is drawn from its style, not as the placeholder circle below.
  if (isProcedural(body)) {
    drawProceduralBody(ctx, body, x, y, radius);
    return;
  }

  const gradient = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.35, 1, x, y, radius * 1.1);
  gradient.addColorStop(0, style.base);
  gradient.addColorStop(1, style.shadow);

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Specular highlight
  ctx.beginPath();
  ctx.arc(x - radius * 0.32, y - radius * 0.28, radius * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  ctx.fill();

  // Atmospheric glow
  const atmosGrad2 = ctx.createRadialGradient(x, y, radius, x, y, radius + 8);
  atmosGrad2.addColorStop(0, style.glow);
  atmosGrad2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = atmosGrad2;
  ctx.beginPath();
  ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
  ctx.fill();

  if (body.id === "saturn") {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.28);
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.85, radius * 0.72, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(220, 200, 140, 0.5)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.55, radius * 0.58, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(200, 180, 120, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

/** "#rrggbb" as "r, g, b", for the belt tints (AB#742). */
function rgbOf(hex) {
  const n = Number.parseInt(String(hex).replace("#", ""), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function drawAsteroidBelt(ctx, cx, cy, radius, style = null) {
  // AB#742: a belt with a style in data/systems.json takes its colours from it; Sol's belt keeps the default grey-blue.
  const rock = style ? rgbOf(style.base) : "140, 165, 190";
  const bright = style ? rgbOf(style.accent) : "200, 220, 240";
  const haze = style ? rgbOf(style.base) : "155, 185, 210";
  // Faint ring glow
  const ringGlow = ctx.createRadialGradient(cx, cy, radius - 8, cx, cy, radius + 8);
  ringGlow.addColorStop(0, `rgba(${haze}, 0.05)`);
  ringGlow.addColorStop(0.5, `rgba(${haze}, 0.08)`);
  ringGlow.addColorStop(1, `rgba(${haze}, 0)`);
  ctx.fillStyle = ringGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
  ctx.fill();

  // Dashed ring line
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${haze}, 0.18)`;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Individual rocks
  for (let i = 0; i < 120; i += 1) {
    const t = (i / 120) * Math.PI * 2;
    const jitter = ((i * 37) % 13) - 6;
    const r = radius + jitter;
    const x = cx + Math.cos(t) * r;
    const y = cy + Math.sin(t) * r;
    const s = ((i % 3) + 1) * 0.8;
    const alpha = 0.35 + ((i * 19) % 100) / 250;
    ctx.fillStyle = i % 7 === 0 ? `rgba(${bright}, ${alpha})` : `rgba(${rock}, ${alpha * 0.8})`;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function asteroidKey(systemId, bodyId, index) {
  return `${systemId}:${bodyId}:ast-${index}`;
}

function asteroidPoint(systemId, bodyId, index, cx, cy, radius) {
  const seed = hashSeed(asteroidKey(systemId, bodyId, index));
  const angle = ((seed % 3600) / 3600) * Math.PI * 2;
  const radialOffset = ((seed >> 4) % 13) - 6;
  const ringRadius = Math.max(8, radius + radialOffset);
  const x = cx + Math.cos(angle) * ringRadius;
  const y = cy + Math.sin(angle) * ringRadius;
  const size = ((seed >> 8) % 3) + 1;
  return { x, y, size, angle, ringRadius };
}

/** The Starmap canvas's backing store for a CSS box and devicePixelRatio (clamped to 1..2): one CSS pixel is dpr
 * backing pixels in both directions, so what is drawn at (x, y) is where a click at (x, y) lands. */
/**
 * ISP-82 (AB#771): where a star's name (and, for the corporation's own system, "YOU ARE HERE" under it) goes on the
 * cluster view. Beside the star where it always went (right, or left when the right runs off the canvas), unless that
 * box would cross a label already placed or another star; then the other side, then below, then above. On a phone the
 * names are 14px, and Epsilon Eridani's ran across Alpha Centauri's; at a desktop's sizes nothing crosses, so nothing
 * moves. `widths` are the lines' widths; `size` the font's px; `placed` the boxes of labels already drawn; `stars`
 * every star as { x, y, r }. Returns { x, y } for the first line's fillText, and the box it takes.
 */
export function clusterLabelAt({ widths, size, x, y, gap, placed = [], stars = [], canvasWidth, canvasHeight }) {
  const width = Math.max(...widths);
  const lineHeight = size + 2;
  const ascent = size * 0.8;
  const descent = size * 0.25 + (widths.length - 1) * lineHeight;
  const box = (c) => ({ left: c.x, right: c.x + width, top: c.y - ascent, bottom: c.y + descent });
  const right = { x: x + gap, y: y + 1 };
  const left = { x: x - gap - width, y: y + 1 };
  // Above or below, centred on the star but kept inside the canvas, as bodyLabelAt keeps a body's name.
  const centred = Math.min(Math.max(x - width / 2, LABEL_EDGE_MARGIN), canvasWidth - LABEL_EDGE_MARGIN - width);
  const below = { x: centred, y: y + gap + ascent };
  const above = { x: centred, y: y - gap - descent };
  const rightFits = right.x + width <= canvasWidth - LABEL_EDGE_MARGIN;
  // ISP-116 (AB#808): with twenty systems four places are not always enough; the corners beside the star come next.
  const lift = ascent + descent;
  const corners = [
    { x: right.x, y: right.y - lift }, { x: right.x, y: right.y + lift },
    { x: left.x, y: left.y - lift }, { x: left.x, y: left.y + lift }
  ];
  const candidates = [...(rightFits ? [right, left, below, above] : [left, right, below, above]), ...corners];
  // Two labels need a little air between them, not only no overlap: 3px all round.
  const crosses = (a, b) => a.left - 3 < b.right && b.left - 3 < a.right && a.top - 3 < b.bottom && b.top - 3 < a.bottom;
  const covers = (b, s) => Math.hypot(
    Math.min(Math.max(s.x, b.left), b.right) - s.x,
    Math.min(Math.max(s.y, b.top), b.bottom) - s.y
  ) < s.r;
  const clear = (c) => {
    const b = box(c);
    return b.left >= LABEL_EDGE_MARGIN && b.right <= canvasWidth - LABEL_EDGE_MARGIN && b.top >= LABEL_EDGE_MARGIN &&
      b.bottom <= canvasHeight - LABEL_EDGE_MARGIN && !placed.some((p) => crosses(b, p)) && !stars.some((s) => covers(b, s));
  };
  const found = candidates.find(clear);
  // ISP-116 (AB#808): with no clear place, a name still stays on the canvas: the first place inside it, or the first
  // place moved inside it (a long line on a phone ran off the left edge, and the name with it).
  const inside = (c) => {
    const b = box(c);
    return b.left >= LABEL_EDGE_MARGIN && b.right <= canvasWidth - LABEL_EDGE_MARGIN && b.top >= LABEL_EDGE_MARGIN && b.bottom <= canvasHeight - LABEL_EDGE_MARGIN;
  };
  const clamp = (c) => ({
    x: Math.min(Math.max(c.x, LABEL_EDGE_MARGIN), canvasWidth - LABEL_EDGE_MARGIN - width),
    y: Math.min(Math.max(c.y, LABEL_EDGE_MARGIN + ascent), canvasHeight - LABEL_EDGE_MARGIN - descent)
  });
  const chosen = found || candidates.find(inside) || clamp(candidates[0]);
  return { x: chosen.x, y: chosen.y, box: box(chosen), clear: Boolean(found) };
}

/**
 * ISP-116 (AB#808): which systems the cluster view names, and where, so the names never overlap. The current system,
 * then the selected one, then the selected one's neighbours, then the rest take their places in that order, so the
 * names that matter most get their first choice. On a narrow canvas (a phone) only the first three kinds are named and
 * the rest are dots named when tapped: no arrangement of twenty 14px names fits 307x320 (docs/design/starmap-20.md).
 * The current and selected systems are always named (kept on the canvas); any other name that finds no clear place
 * is left off rather than drawn across another.
 * `entries`: [{ id, x, y, r, widths, size, gap, current, selected, neighbour }]. Returns Map id -> { x, y, box }.
 */
export function planClusterLabels({ entries, compact, canvasWidth, canvasHeight }) {
  const rank = (e) => (e.current ? 0 : e.selected ? 1 : e.neighbour ? 2 : 3);
  const order = entries.map((e, i) => [e, i]).sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j).map(([e]) => e);
  const stars = entries.map((e) => ({ x: e.x, y: e.y, r: e.r, id: e.id }));
  const placed = [];
  const plan = new Map();
  for (const e of order) {
    const priority = rank(e) < 3;
    if (compact && !priority) continue;
    const label = clusterLabelAt({
      widths: e.widths, size: e.size, x: e.x, y: e.y, gap: e.gap, placed,
      stars: stars.filter((s) => s.id !== e.id), canvasWidth, canvasHeight
    });
    if (!label.clear && rank(e) >= 2) continue;
    placed.push(label.box);
    plan.set(e.id, { x: label.x, y: label.y, box: label.box });
  }
  return plan;
}

export function canvasBackingSize(cssWidth, cssHeight, devicePixelRatio) {
  const dpr = Math.max(1, Math.min(2, devicePixelRatio || 1));
  return {
    width: Math.max(1, Math.round(cssWidth * dpr)),
    height: Math.max(1, Math.round(cssHeight * dpr)),
    dpr
  };
}

/** Where the system view's "Back To Cluster" button sits (its centre) when nothing is in its way. */
const SYSTEM_BACK_BUTTON = { x: 102, y: 36 };
const BACK_BUTTON_HEIGHT = 28;
const BACK_BUTTON_INSET = 6;
/** How far past its drawn edge a back button still takes a tap: 6px makes the 28px button a 40px-tall target. */
const BACK_TARGET_PAD = 6;

/**
 * AB#1344: a back button's click target is the button as drawn, plus BACK_TARGET_PAD. It was a circle of radius 0.55 x
 * the button's width (67px for "Back To Cluster") about its centre, tested before any body, so on a phone every belt
 * drawn beside the button (AB#1287 cleared the drawn button, not that circle) went back to the cluster when tapped.
 */
export function backButtonTarget(type, x, y, width) {
  return { type, x, y, w: width + BACK_TARGET_PAD * 2, h: BACK_BUTTON_HEIGHT + BACK_TARGET_PAD * 2 };
}

/** Whether a tap at (x, y) lands on a click target: a rectangle when it has a width, a circle otherwise. */
export function targetHit(target, x, y) {
  if (target.w !== undefined) return Math.abs(target.x - x) <= target.w / 2 && Math.abs(target.y - y) <= target.h / 2;
  return Math.hypot(target.x - x, target.y - y) <= target.radius;
}

/**
 * AB#1287: the system view's orbits and its back button, laid out so no orbit (with the body's glow margin) reaches the
 * button. On a desktop canvas the button's usual place is already clear and nothing moves. On a phone (a 307x320
 * canvas) the outer orbits ran under it and Saturn was drawn over "Back To Cluster"; there the button moves into the
 * top-left corner and the orbits drop below it, shrinking only as far as the canvas height requires.
 */
export function systemViewLayout(width, height, buttonWidth) {
  const extra = ORBIT_INNER + ORBIT_EDGE_MARGIN;
  // Bug #1315: on a narrow canvas the outer orbits ran past the sides (0.42 of 292px plus 56 is 179px from a 146px
  // centre). The orbits now also fit the width, leaving room for the body; a desktop canvas is wide enough that this
  // never binds, so its layout is unchanged.
  // AB#1326: nor did anything fit the height, so on a desktop canvas the outer bodies crossed the top and bottom edges
  // (0.42 x 393 + 56 = 221px from a 196px centre). They fit it the same way; on a phone the width binds first.
  const orbitLimit = Math.min(Math.min(width, height) * 0.42, Math.max(0, width / 2 - extra), Math.max(0, height / 2 - extra));
  const cx = width / 2;
  const clearance = (cy, button) => {
    const dx = Math.max(button.x - buttonWidth / 2 - cx, 0, cx - button.x - buttonWidth / 2);
    const dy = Math.max(button.y - BACK_BUTTON_HEIGHT / 2 - cy, 0, cy - button.y - BACK_BUTTON_HEIGHT / 2);
    return Math.hypot(dx, dy);
  };
  if (clearance(height / 2, SYSTEM_BACK_BUTTON) >= orbitLimit + extra) {
    return { cx, cy: height / 2, orbitLimit, button: { ...SYSTEM_BACK_BUTTON } };
  }
  const button = { x: BACK_BUTTON_INSET + buttonWidth / 2, y: BACK_BUTTON_INSET + BACK_BUTTON_HEIGHT / 2 };
  const dx = Math.max(0, cx - (button.x + buttonWidth / 2));
  const buttonBottom = button.y + BACK_BUTTON_HEIGHT / 2;
  for (let reach = orbitLimit + extra; reach > extra; reach -= 0.5) {
    const cy = Math.max(height / 2, dx >= reach ? 0 : buttonBottom + Math.sqrt(reach * reach - dx * dx));
    if (cy + reach <= height) return { cx, cy, orbitLimit: reach - extra, button };
  }
  return { cx, cy: height / 2, orbitLimit: 0, button };
}

export function createStarmapController({
  canvas,
  fallbackEl,
  detailsEl,
  overlaySelect,
  resourceSelect, // ISP-143 (AB#837): the resource concentration overlay's item
  resourceLegend,
  dominanceLegend, // ISP-218 (AB#913): the dominance overlays' legend
  onOverlayChange, // ISP-218 (AB#913): told when the overlay changes, so the page can fetch what it needs
  onSystemShown, // ISP-229 (AB#924): told when a system's panel opens, so the page can read its control and the viewer's status
  onConcessionAction, // ISP-229 (AB#924): petition, set the lease discount, relinquish: the page confirms and posts
  resetButton,
  onTravelToSystem,
  onFileTariff, // ISP-231 (AB#926): (systemId, pct) => Promise<string | null>, the refusal to show, or null when filed
  onDockAtStation,
  onScoutBelt,
  onLaunchExpedition,
  getAsteroidMiningState,
  researchCatalog = [], // Bug #1270: to name the research a locked jump needs
  getCorpLevel = () => 0,
  getMemberStation = () => null, // ISP-212 (AB#907): the corporation's own conglomerate's station, for the member office rate
  // ISP-112 (AB#804): data/systems.json's list, and the travel gate and routes over it (public/scripts/navigation.js).
  getSystemsCatalog = () => [],
  getNavigation = () => navigationFor(getSystemsCatalog())
}) {
  const ctx = canvas?.getContext?.("2d");
  const state = {
    systems: [],
    stations: [],
    currentStationId: null,
    currentSystemId: "sol",
    overlay: "none",
    resource: "none", // ISP-143 (AB#837): the item the concentration overlay shows, or "none"
    dominance: null, // ISP-218 (AB#913): GET /api/starmap/dominance
    ownNames: { corporation: "", conglomerate: "" }, // ISP-218 (AB#913): the viewer's own, marked on the map
    concessions: null, // ISP-229 (AB#924): GET /api/starmap/concessions
    systemConcession: {}, // ISP-229 (AB#924): per system, { control, status } as the page read them
    view: "cluster",
    selectedSystemId: null,
    selectedBodyId: null,
    unlockedTech: new Set(),
    selectedAsteroidId: null,
    clickTargets: [],
    asteroidMining: null,  // { probeCount, maxProbes, maxDeployments, activeExpeditions, scoutedBelts, beltCompositions, belts, respawnChancePerHour }
    beltNotice: null       // Bug #2339: { beltKey, message }, the last refusal on a belt, shown in its panel
  };

  /** A system's place on the cluster view, from the catalog (AB#804); undefined for one it does not list. */
  const mapPositionOf = (systemId) => getSystemsCatalog().find((s) => s.id === systemId)?.mapPosition;

  // The same gate as the server's travel route (public/scripts/navigation.js, Bug #976).
  function canTravelToSystem(targetSystemId) {
    return getNavigation().canReachSystem(state.unlockedTech, state.currentSystemId, targetSystemId);
  }

  // Bug #1270: what the lock says, the same text the travel route refuses with.
  function travelLockText(targetSystemId) {
    return getNavigation().travelResearchLock(researchCatalog, state.unlockedTech, getCorpLevel(), state.currentSystemId, targetSystemId) || "";
  }

  function setCanvasSize() {
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const availableHeight = Math.max(320, Math.floor(window.innerHeight - rect.top - 34));
    const targetHeight = Math.min(560, availableHeight);

    canvas.style.height = `${targetHeight}px`;
    // Bug #1286: the backing store follows the box the map is drawn and clicked in (clientWidth x clientHeight, the
    // units every draw function and clickTargets use). A 500px floor here squeezed the drawing into the left half of
    // a phone's 292px canvas while taps were still tested at full scale, so tapping a star missed it.
    const size = canvasBackingSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
    canvas.width = size.width;
    canvas.height = size.height;
    if (ctx) {
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    }
  }

  function clearScene() {
    if (!ctx || !canvas) {
      return;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    ctx.clearRect(0, 0, width, height);

    // Deep space gradient background
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "#020810");
    bgGrad.addColorStop(0.5, "#06101e");
    bgGrad.addColorStop(1, "#030a14");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Nebula clouds — larger, softer, multi-colored
    const nebulae = [
      { x: 0.12, y: 0.2,  r: 0.50, color: "rgba(20, 80, 180, 0.06)" },
      { x: 0.85, y: 0.75, r: 0.45, color: "rgba(180, 60, 120, 0.05)" },
      { x: 0.50, y: 0.10, r: 0.35, color: "rgba(0, 200, 220, 0.04)" },
      { x: 0.70, y: 0.35, r: 0.30, color: "rgba(120, 50, 200, 0.04)" },
      { x: 0.25, y: 0.80, r: 0.40, color: "rgba(255, 140, 40, 0.03)" },
    ];
    for (const n of nebulae) {
      const ng = ctx.createRadialGradient(n.x * width, n.y * height, 0, n.x * width, n.y * height, n.r * width);
      ng.addColorStop(0, n.color);
      ng.addColorStop(0.6, n.color.replace(/[\d.]+\)$/, "0)"));
      ng.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ng;
      ctx.fillRect(0, 0, width, height);
    }

    // Background stars — varied size and brightness with subtle color tinting
    for (let i = 0; i < 400; i += 1) {
      const x = (i * 79 + (i * i * 13)) % width;
      const y = (i * 113 + (i * i * 7)) % height;
      const brightness = 0.08 + ((i * 31) % 100) / 200;
      const size = ((i * 17) % 5 === 0) ? 1.8 : ((i * 23) % 7 === 0) ? 1.4 : 0.9;

      // Subtle color variation
      const tint = (i * 41) % 3;
      const r = tint === 0 ? 220 : tint === 1 ? 200 : 255;
      const g = tint === 0 ? 240 : tint === 1 ? 210 : 230;
      const b = 255;

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${brightness})`;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
      ctx.fill();

      // Brighter stars get a tiny glow
      if (brightness > 0.35) {
        const sg = ctx.createRadialGradient(x, y, 0, x, y, size * 3);
        sg.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${brightness * 0.3})`);
        sg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(x, y, size * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Bug #1315: where a label beside a point starts, in the current font: to the right of it, or to the left when it
   * would run past the canvas's right edge. */
  /** AB#1337: where a body's name goes in the system view, as { x, y } for fillText in the current font. Beside the
   * body on the right as before; otherwise on the left, above or below it: the first of those that stays inside the
   * canvas and off the star's halo, or, when a body is so close to the star that none is, the one farthest from it.
   * labelX flipped the name left whatever was there, so a planet right of the star ran its name across it, and a body
   * left of the star ran its right-hand name into it. */
  function bodyLabelAt(text, x, y, bodyR, star) {
    const width = ctx.measureText(text).width;
    const minX = LABEL_EDGE_MARGIN;
    const maxX = canvas.clientWidth - LABEL_EDGE_MARGIN;
    const within = (left) => Math.min(Math.max(left, minX), maxX - width);
    const centred = within(x - width / 2);
    const awayFromStar = within(x < star.x ? x + 8 - width : x - 8); // over the body, reaching away from the star
    const above = y - bodyR - 5;
    const below = y + bodyR + LABEL_ASCENT + 3;
    const candidates = [
      { x: x + 8, y: y - 4 },
      { x: x - 8 - width, y: y - 4 },
      { x: centred, y: above },
      { x: centred, y: below },
      { x: awayFromStar, y: above },
      { x: awayFromStar, y: below }
    ];
    const fits = (c) => c.x >= minX && c.x + width <= maxX &&
      c.y - LABEL_ASCENT >= LABEL_EDGE_MARGIN && c.y + LABEL_DESCENT <= canvas.clientHeight - LABEL_EDGE_MARGIN;
    // How far the label's box comes to the star's centre: 0 when it covers it.
    const reach = (c) => Math.hypot(
      Math.min(Math.max(star.x, c.x), c.x + width) - star.x,
      Math.min(Math.max(star.y, c.y - LABEL_ASCENT), c.y + LABEL_DESCENT) - star.y
    );
    const inside = candidates.filter(fits);
    if (inside.length === 0) return candidates[0];
    return inside.find((c) => reach(c) >= star.r) || inside.reduce((best, c) => (reach(c) > reach(best) ? c : best));
  }

  function drawClusterView() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    state.clickTargets = [];

    const currentSystemId = state.currentSystemId || "sol";

    // Draw lane connections with gradient lines: the jump graph (Bug #2328), for the systems this world shows.
    const shown = new Set(state.systems.map((system) => system.id));
    for (const [idA, idB] of lanePairs(getSystemsCatalog().filter((system) => shown.has(system.id)))) {
      const a = mapPositionOf(idA);
      const b = mapPositionOf(idB);
      if (!a || !b) continue;

      const ax = a.x * width;
      const ay = a.y * height;
      const bx = b.x * width;
      const by = b.y * height;
      const laneGrad = ctx.createLinearGradient(ax, ay, bx, by);
      laneGrad.addColorStop(0, "rgba(60, 140, 200, 0.12)");
      laneGrad.addColorStop(0.5, "rgba(60, 140, 200, 0.22)");
      laneGrad.addColorStop(1, "rgba(60, 140, 200, 0.12)");
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = laneGrad;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Dashed overlay for depth
      ctx.save();
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = "rgba(0, 200, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Draw star systems. Every star is known before any name is placed, so no name is put across one (ISP-82).
    const at = (system) => {
      const p = mapPositionOf(system.id) || { x: 0.5, y: 0.5 };
      return { x: p.x * width, y: p.y * height };
    };
    // ISP-116 (AB#808): every name placed before any is drawn (planClusterLabels), so none overlaps; on a phone only
    // the current system, the selected one and their neighbours are named. A locked system is drawn grey, and when
    // selected its name carries the research the jump needs.
    const compact = width < COMPACT_CLUSTER_WIDTH;
    const adjacentOf = (id) => new Set(getSystemsCatalog().find((s) => s.id === id)?.adjacent || []);
    const neighbours = adjacentOf(state.selectedSystemId || currentSystemId); // the selected system's (docs/design/starmap-20.md)
    const sizes = (isSelected) => ({ name: chartFont(isSelected ? 12 : 11), here: chartFont(9), lock: chartFont(10) });
    const linesOf = (system) => {
      const isSelected = state.selectedSystemId === system.id;
      const lines = [{ text: system.name, font: `${isSelected ? "bold " : ""}${sizes(isSelected).name}px "Inter", sans-serif`, color: isSelected ? "rgba(255, 255, 255, 0.95)" : "rgba(200, 220, 240, 0.8)" }];
      if (system.id === currentSystemId) lines.push({ text: "YOU ARE HERE", font: `${sizes(isSelected).here}px "Inter", sans-serif`, color: "rgba(0, 247, 255, 0.6)" });
      // ISP-143 (AB#837): the system's best share of the chosen item, in words under its name (colour is not the only cue).
      // Not on a phone: a third line crowds the few names it draws into the station badges, and the panel under the map
      // lists the richest systems, and every body of the one opened, with their shares.
      if (state.resource !== "none" && !compact) {
        const { best } = systemConcentration(system, state.resource, beltSlots());
        lines.push({ text: `${state.resource} ${concentrationText(best)}`, font: `${sizes(isSelected).here}px "Inter", sans-serif`, color: "rgba(236, 242, 247, 0.9)" });
      }
      // On a phone the gate stays in the panel under the map: the line is wider than a phone's canvas.
      if (isSelected && !compact && !canTravelToSystem(system.id)) {
        const research = getNavigation().travelResearchName(researchCatalog, system.id);
        if (research) lines.push({ text: `Requires ${research}`, font: `${sizes(isSelected).lock}px "Inter", sans-serif`, color: "rgba(255, 190, 120, 0.9)" });
      }
      return lines;
    };
    const entries = state.systems.map((system) => {
      const isSelected = state.selectedSystemId === system.id;
      const baseRadius = isSelected ? 10 : 7;
      const lines = linesOf(system);
      const widths = lines.map((line) => { ctx.font = line.font; return ctx.measureText(line.text).width; });
      return {
        id: system.id, ...at(system), r: baseRadius + 4, widths, lines, size: sizes(isSelected).name, gap: baseRadius + 10,
        current: system.id === currentSystemId, selected: isSelected, neighbour: neighbours.has(system.id)
      };
    });
    const labelPlan = planClusterLabels({ entries, compact, canvasWidth: width, canvasHeight: height });
    // ISP-119 (AB#811): a count of a system's neutral stations, from the catalog field, beside its star, in a corner
    // the names (planned first, as AB#808 plans them) leave free. AB#2349: only where it is more than the baseline of
    // one every system has (today Sol's three); the legend says every system has one.
    const stationCounts = badgedStationCounts(state.stations);
    const badgeFontPx = chartFont(9);
    ctx.font = `bold ${badgeFontPx}px "Inter", sans-serif`;
    const counted = state.systems.filter((system) => stationCounts.has(system.id)).map((system) => {
      const text = String(stationCounts.get(system.id));
      return { id: system.id, ...at(system), starRadius: state.selectedSystemId === system.id ? 10 : 7, text, textWidth: ctx.measureText(text).width };
    });
    const badgeBoxes = placeStationBadges({
      systems: counted, labelBoxes: [...labelPlan.values()].map((p) => p.box), stars: entries,
      canvasWidth: width, canvasHeight: height, fontPx: badgeFontPx
    });
    const badges = counted.map((s) => ({ id: s.id, text: s.text, box: badgeBoxes.get(s.id) }));
    const entryOf = new Map(entries.map((e) => [e.id, e]));
    // ISP-218 (AB#913): under a dominance overlay each system takes its leader's colour, from the design system's tokens.
    const domKey = currentDominanceKey() || currentConcessionKey(); // ISP-229 (AB#924): the Concessions overlay colours the same way
    const tokenColors = new Map();
    const tokenColor = (token) => {
      if (!tokenColors.has(token)) {
        const hex = typeof document !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue(token) : "";
        tokenColors.set(token, tokenRgba(hex));
      }
      return tokenColors.get(token);
    };
    state.systems.forEach((system) => {
      const { x, y } = at(system);
      const isSelected = state.selectedSystemId === system.id;
      const isCurrent = system.id === currentSystemId;
      const baseRadius = isSelected ? 10 : 7;
      const locked = !canTravelToSystem(system.id);
      // ISP-143 (AB#837): with a resource chosen, every star takes its band's colour, locked or not: where to go is the question.
      const color = state.resource !== "none"
        ? concentrationBand(systemConcentration(system, state.resource, beltSlots()).best).color
        : domKey ? tokenColor(domKey.bySystem[system.id]?.token || QUIET_TOKEN)
        : locked ? LOCKED_STAR_COLOR : overlayColor(system, state.overlay);

      // Outer glow halo
      const haloRadius = baseRadius + 20;
      const haloGrad = ctx.createRadialGradient(x, y, baseRadius, x, y, haloRadius);
      haloGrad.addColorStop(0, color.replace(/[\d.]+\)$/, "0.18)"));
      haloGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
      ctx.fill();

      // Mid glow
      const midGrad = ctx.createRadialGradient(x, y, 0, x, y, baseRadius + 6);
      midGrad.addColorStop(0, color.replace(/[\d.]+\)$/, "0.65)"));
      midGrad.addColorStop(0.6, color.replace(/[\d.]+\)$/, "0.2)"));
      midGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = midGrad;
      ctx.beginPath();
      ctx.arc(x, y, baseRadius + 6, 0, Math.PI * 2);
      ctx.fill();

      // Core star dot
      const coreGrad = ctx.createRadialGradient(x, y, 0, x, y, baseRadius);
      coreGrad.addColorStop(0, "#ffffff");
      coreGrad.addColorStop(0.3, color.replace(/[\d.]+\)$/, "0.95)"));
      coreGrad.addColorStop(1, color.replace(/[\d.]+\)$/, "0.6)"));
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(x, y, baseRadius, 0, Math.PI * 2);
      ctx.fill();

      // Current system ring indicator
      if (isCurrent) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, baseRadius + 12, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0, 247, 255, 0.55)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // ISP-218 (AB#913): a solid ring in the viewer's colour round each system it leads, as the legend says.
      if (domKey?.bySystem[system.id]?.own) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, baseRadius + 16, 0, Math.PI * 2);
        ctx.strokeStyle = color.replace(/[\d.]+\)$/, "0.9)");
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // ISP-229 (AB#924): a dashed amber ring round a system with a petition under review, as the legend says.
      if (state.overlay === CONCESSION_OVERLAY && domKey?.bySystem[system.id]?.pending) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, baseRadius + 20, 0, Math.PI * 2);
        ctx.strokeStyle = tokenColor("--series-3").replace(/[\d.]+\)$/, "0.95)");
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // A locked system: a solid grey ring round the grey star, apart from the current system's dashed cyan one.
      if (locked) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, baseRadius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = LOCKED_STAR_COLOR;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      // Its name, and the lines under it ("YOU ARE HERE"; a locked selection's research), where the plan put them.
      const label = labelPlan.get(system.id);
      if (label) {
        const entry = entryOf.get(system.id);
        entry.lines.forEach((line, i) => {
          ctx.fillStyle = line.color;
          ctx.font = line.font;
          ctx.fillText(line.text, label.x, label.y + i * (entry.size + 2));
        });
      }

      state.clickTargets.push({
        type: "system",
        systemId: system.id,
        x,
        y,
        radius: baseRadius + 14
      });
    });

    for (const badge of badges) drawStationBadge(badge, badgeFontPx);

    renderDetails();
  }

  /** ISP-119 (AB#811): a system's neutral-station count on the cluster view: the station diamond and the number. */
  function drawStationBadge({ text, box }, fontPx) {
    const midY = (box.top + box.bottom) / 2;
    ctx.save();
    ctx.fillStyle = "rgba(6, 16, 28, 0.88)";
    ctx.strokeStyle = "rgba(255, 210, 80, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(box.left, box.top, box.right - box.left, box.bottom - box.top, 4);
    ctx.fill();
    ctx.stroke();
    ctx.translate(box.left + 9, midY);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "rgba(255, 210, 80, 0.95)";
    ctx.fillRect(-2.8, -2.8, 5.6, 5.6);
    ctx.restore();
    ctx.fillStyle = "rgba(255, 226, 150, 0.95)";
    ctx.font = `bold ${fontPx}px "Inter", sans-serif`;
    ctx.fillText(text, box.left + 15, midY + fontPx * 0.36);
  }

  function drawBackButton(label = "Back", x = 88, y = 36) {
    const paddingX = 14;
    const height = 28;
    const textWidth = ctx.measureText(label).width;
    const width = Math.max(88, Math.ceil(textWidth + paddingX * 2));

    // Background with subtle gradient
    const btnGrad = ctx.createLinearGradient(x - width / 2, y - height / 2, x - width / 2, y + height / 2);
    btnGrad.addColorStop(0, "rgba(10, 30, 55, 0.95)");
    btnGrad.addColorStop(1, "rgba(6, 18, 35, 0.95)");
    ctx.fillStyle = btnGrad;
    ctx.strokeStyle = "rgba(0, 200, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - height / 2, width, height, 6);
    ctx.fill();
    ctx.stroke();

    // Arrow + text
    ctx.fillStyle = "rgba(0, 220, 255, 0.85)";
    ctx.font = `${chartFont(10)}px "Inter", sans-serif`;
    ctx.fillText("◂ " + label, x - textWidth / 2 - 4, y + 3.5);

    return width;
  }

  // Bug #1286: the right-hand of two back buttons sits at preferredX, or further left when that would run past the
  // canvas's right edge (a phone's canvas is 292px wide; "Back To Cluster" at 250 ended at about 300).
  function rightBackButtonX(label, preferredX, canvasWidth) {
    return Math.min(preferredX, canvasWidth - 6 - backButtonWidth(label) / 2);
  }

  /** The width drawBackButton will draw `label` at. */
  function backButtonWidth(label) {
    ctx.font = `${chartFont(10)}px "Inter", sans-serif`;
    return Math.max(88, Math.ceil(ctx.measureText(label).width + 28));
  }

  /** A station's diamond: cyan where you are docked, gold for a neutral station, violet for a conglomerate's (ISP-210). */
  function drawStationMarker(x, y, isCurrent, owned = false) {
    const size = isCurrent ? 5 : 4;
    const rgb = isCurrent ? "0, 247, 255" : owned ? "196, 150, 255" : "255, 210, 80";
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);

    // Glow
    const glowColor = `rgba(${rgb}, ${isCurrent ? 0.3 : 0.25})`;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 3);
    glow.addColorStop(0, glowColor);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-size * 3, -size * 3, size * 6, size * 6);

    // Diamond shape
    ctx.fillStyle = `rgba(${rgb}, ${isCurrent ? 0.95 : 0.9})`;
    ctx.fillRect(-size, -size, size * 2, size * 2);

    // Outline
    ctx.strokeStyle = `rgba(${rgb}, ${isCurrent ? 0.5 : 0.4})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(-size - 2, -size - 2, size * 2 + 4, size * 2 + 4);
    ctx.restore();
  }

  function drawSystemView(system) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const { cx, cy, orbitLimit, button } = systemViewLayout(width, height, backButtonWidth("Back To Cluster"));

    state.clickTargets = [];

    const backWidth = drawBackButton("Back To Cluster", button.x, button.y);
    state.clickTargets.push(backButtonTarget("back", button.x, button.y, backWidth));

    // Central star with layered glow
    // Outer halo
    const starHaloR = 60;
    const starHalo = ctx.createRadialGradient(cx, cy, 0, cx, cy, starHaloR);
    starHalo.addColorStop(0, "rgba(255, 200, 80, 0.12)");
    starHalo.addColorStop(0.4, "rgba(255, 160, 40, 0.05)");
    starHalo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = starHalo;
    ctx.beginPath();
    ctx.arc(cx, cy, starHaloR, 0, Math.PI * 2);
    ctx.fill();

    // Mid glow
    const starMidR = 28;
    const starMid = ctx.createRadialGradient(cx, cy, 0, cx, cy, starMidR);
    starMid.addColorStop(0, "rgba(255, 240, 200, 0.8)");
    starMid.addColorStop(0.5, "rgba(255, 180, 60, 0.4)");
    starMid.addColorStop(1, "rgba(255, 140, 30, 0)");
    ctx.fillStyle = starMid;
    ctx.beginPath();
    ctx.arc(cx, cy, starMidR, 0, Math.PI * 2);
    ctx.fill();

    // Core
    const starCoreR = 14;
    const starCore = ctx.createRadialGradient(cx - 3, cy - 3, 0, cx, cy, starCoreR);
    starCore.addColorStop(0, "#fffef0");
    starCore.addColorStop(0.6, "rgba(255, 210, 90, 0.95)");
    starCore.addColorStop(1, "rgba(255, 170, 50, 0.8)");
    ctx.fillStyle = starCore;
    ctx.beginPath();
    ctx.arc(cx, cy, starCoreR, 0, Math.PI * 2);
    ctx.fill();

    const bodies = (system?.bodies || []).filter((body) => body.type === "Planet" || body.type === "Field");
    const maxOrbitX = Math.max(1, ...bodies.map((body) => Number(body.x || 0)));

    const drawnAt = new Map(); // body id -> where it was drawn, for the station markers (ISP-119)
    bodies.forEach((body, index) => {
      const orbit = ((Number(body.x || 0) / maxOrbitX) * orbitLimit) + ORBIT_INNER;
      const angle = (index / Math.max(1, bodies.length)) * Math.PI * 2;
      const x = cx + Math.cos(angle) * orbit;
      const y = cy + Math.sin(angle) * orbit;

      ctx.beginPath();
      ctx.arc(cx, cy, orbit, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(80, 160, 220, 0.10)";
      ctx.lineWidth = 1;
      ctx.save();
      ctx.setLineDash([2, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      if (body.type === "Field") {
        const beltRadius = Math.max(10, body.radius + 5);
        drawAsteroidBelt(ctx, x, y, beltRadius, body.style);

        // Create individual clickable asteroid targets within the belt.
        for (let i = 0; i < 36; i += 1) {
          const pt = asteroidPoint(system.id, body.id, i, x, y, beltRadius);
          state.clickTargets.push({
            type: "asteroid",
            systemId: system.id,
            bodyId: body.id,
            asteroidId: asteroidKey(system.id, body.id, i),
            x: pt.x,
            y: pt.y,
            radius: Math.max(5, pt.size + 2)
          });
        }
      } else {
        drawPlanet(ctx, body, x, y, Math.max(4, body.radius));
      }

      ctx.fillStyle = "rgba(200, 225, 245, 0.88)";
      ctx.font = `${chartFont(11)}px "Inter", sans-serif`;
      const bodyR = body.type === "Field" ? Math.max(10, body.radius + 5) : Math.max(4, body.radius);
      // ISP-143 (AB#837): with a resource chosen, a ring in the body's band and its share in its label.
      let bodyText = body.name;
      // ISP-208 (AB#903): a belt shared by a conglomerate partner says so on the map; its panel names who scouted it.
      if (body.type === "Field" && beltSlots()[`${system.id}:${body.id}`]?.sharedBy?.length) bodyText = `${body.name} · shared`;
      if (state.resource !== "none") {
        const value = bodyConcentration(system, body, state.resource, beltSlots());
        const band = concentrationBand(value);
        if (band) {
          ctx.save();
          ctx.strokeStyle = band.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, bodyR + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = "rgba(200, 225, 245, 0.88)";
        }
        // On a phone's canvas only a share there is: "· none" and "· not scouted" crowded Sol's inner names into each
        // other, and the panel under the map lists every body's, those included.
        const narrow = canvas.clientWidth < COMPACT_CLUSTER_WIDTH;
        if (!narrow || value > 0) bodyText = `${body.name} · ${concentrationText(value)}`;
      }
      const label = bodyLabelAt(bodyText, x, y, bodyR, { x: cx, y: cy, r: starHaloR });
      // AB#837: a name beside its body starts clear of the band's ring (it began 8px from the centre, over a big planet).
      if (state.resource !== "none" && label.x === x + 8) label.x = Math.min(x + bodyR + 8, canvas.clientWidth - 4 - ctx.measureText(bodyText).width);
      ctx.fillText(bodyText, label.x, label.y);

      drawnAt.set(body.id, { x, y, r: bodyR });

      state.clickTargets.push({
        type: "body",
        systemId: system.id,
        bodyId: body.id,
        x,
        y,
        radius: Math.max(10, body.radius + 8)
      });
    });

    // ISP-119 (AB#811): a marker per neutral station, from the catalog field, above the body it orbits (below it at
    // the canvas top; a moon's station on its planet); ISP-210 (AB#905): a conglomerate's station too, in its own colour. Its click target goes before the bodies', after the back
    // button, so a tap on a marker opens the station, not the planet under it.
    const markerTargets = [];
    const perBody = new Map();
    for (const { station, bodyId, owned } of systemStationMarkers(system, state.stations)) {
      if (!perBody.has(bodyId)) perBody.set(bodyId, []);
      perBody.get(bodyId).push({ station, owned });
    }
    for (const [bodyId, stations] of perBody) {
      const place = drawnAt.get(bodyId);
      if (!place) continue;
      const above = place.y - place.r - 10 >= 8;
      stations.forEach(({ station, owned }, i) => {
        const mx = place.x + (i - (stations.length - 1) / 2) * 13;
        const my = above ? place.y - place.r - 10 : place.y + place.r + 10;
        drawStationMarker(mx, my, station.id === state.currentStationId, owned);
        markerTargets.push({ type: "station", stationId: station.id, x: mx, y: my, radius: 8 });
      });
    }
    state.clickTargets.splice(1, 0, ...markerTargets);

    renderDetails();
  }

  function drawBodyView(system, body) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const cx = width / 2;
    const cy = height / 2;

    state.clickTargets = [];
    const backSysWidth = drawBackButton("Back To System", 108, 36);
    const backClusterX = rightBackButtonX("Back To Cluster", 250, width);
    const backClusterWidth = drawBackButton("Back To Cluster", backClusterX, 36);

    state.clickTargets.push(backButtonTarget("back-to-system", 108, 36, backSysWidth));
    state.clickTargets.push(backButtonTarget("back-to-cluster", backClusterX, 36, backClusterWidth));

    if (body.type === "Field") {
      const beltRadius = Math.min(width, height) * 0.2;
      drawAsteroidBelt(ctx, cx, cy, beltRadius, body.style);

      for (let i = 0; i < 64; i += 1) {
        const pt = asteroidPoint(system.id, body.id, i, cx, cy, beltRadius);
        state.clickTargets.push({
          type: "asteroid",
          systemId: system.id,
          bodyId: body.id,
          asteroidId: asteroidKey(system.id, body.id, i),
          x: pt.x,
          y: pt.y,
          radius: Math.max(5, pt.size + 2)
        });
      }
    } else {
      const radius = Math.min(width, height) * 0.15;
      drawPlanet(ctx, body, cx, cy, radius);

      // Draw station markers on the planet surface
      const planetStations = state.stations.filter(
        (s) => s.systemId === system.id && s.body === body.name
      );
      planetStations.forEach((station, idx) => {
        const angle = (-Math.PI / 4) + (idx * Math.PI / 6);
        const markerX = cx + Math.cos(angle) * (radius * 0.7);
        const markerY = cy + Math.sin(angle) * (radius * 0.7);
        const isCurrent = station.id === state.currentStationId;
        drawStationMarker(markerX, markerY, isCurrent, isConglomerateStation(station));
        state.clickTargets.push({
          type: "station",
          stationId: station.id,
          x: markerX,
          y: markerY,
          radius: 10
        });
      });

      const moons = (system.bodies || []).filter((item) => item.type === "Moon" && item.parentId === body.id);
      moons.forEach((moon, idx) => {
        const orbit = radius + 36 + idx * 26;
        const angle = (idx / Math.max(1, moons.length)) * Math.PI * 2;
        const x = cx + Math.cos(angle) * orbit;
        const y = cy + Math.sin(angle) * orbit;

        ctx.beginPath();
        ctx.arc(cx, cy, orbit, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(120, 180, 220, 0.16)";
        ctx.stroke();

        const bmr = Math.max(8, moon.radius * 3);
        const bmImg = PLANET_IMAGES[moon.id];
        if (bmImg && bmImg.complete && bmImg.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, bmr, 0, Math.PI * 2);
          ctx.clip();
          const bmiw = bmImg.naturalWidth;
          const bmih = bmImg.naturalHeight;
          const bmd = bmr * 2;
          const bms = Math.max(bmd / bmiw, bmd / bmih);
          const bmdw = bmiw * bms;
          const bmdh = bmih * bms;
          ctx.drawImage(bmImg, x - bmdw / 2, y - bmdh / 2, bmdw, bmdh);
          ctx.restore();
        } else if (isProcedural(moon)) {
          drawProceduralBody(ctx, moon, x, y, bmr); // AB#742
        } else {
          ctx.beginPath();
          ctx.arc(x, y, bmr, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(158, 194, 224, 0.94)";
          ctx.fill();
        }

        ctx.fillStyle = "rgba(216, 235, 245, 0.9)";
        ctx.font = `${chartFont(11)}px Inter`;
        ctx.fillText(moon.name, x + bmr + 5, y - 4);

        state.clickTargets.push({
          type: "body",
          systemId: system.id,
          bodyId: moon.id,
          x,
          y,
          radius: Math.max(8, bmr + 6)
        });
      });
    }

    renderDetails();
  }

  function drawAsteroidView(system, body, asteroidId) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const cx = width / 2;
    const cy = height / 2;

    state.clickTargets = [];
    const backBodyWidth = drawBackButton("Back To Belt", 98, 36);
    const backSystemX = rightBackButtonX("Back To System", 228, width);
    const backSystemWidth = drawBackButton("Back To System", backSystemX, 36);

    state.clickTargets.push(backButtonTarget("back-to-body", 98, 36, backBodyWidth));
    state.clickTargets.push(backButtonTarget("back-to-system", backSystemX, 36, backSystemWidth));

    const seed = hashSeed(asteroidId || `${system.id}:${body.id}:ast-0`);
    const radius = Math.min(width, height) * 0.11;

    const rockGradient = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.35, 1, cx, cy, radius * 1.2);
    rockGradient.addColorStop(0, "rgba(186, 198, 211, 0.96)");
    rockGradient.addColorStop(1, "rgba(92, 108, 126, 0.96)");

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = rockGradient;
    ctx.fill();

    for (let i = 0; i < 6; i += 1) {
      const t = ((seed >> (i + 2)) % 360) * (Math.PI / 180);
      const r = radius * (0.32 + ((seed >> (i + 5)) % 28) / 100);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(t) * r, cy + Math.sin(t) * r, 3 + (i % 3), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(56, 72, 88, 0.72)";
      ctx.fill();
    }

    renderDetails();
  }

  // ─── ISP-143 (AB#837): the resource concentration overlay ────────────────────
  /** This player's belt slots (GET .../belt-compositions, AB#2331): a belt counts only when scouted. */
  function beltSlots() {
    return state.asteroidMining?.belts || {};
  }

  function setResource(item) {
    const items = overlayItems(state.systems, beltSlots());
    state.resource = item && items.includes(item) ? item : "none";
    if (resourceSelect && resourceSelect.value !== state.resource) resourceSelect.value = state.resource;
    if (resourceLegend) {
      resourceLegend.hidden = state.resource === "none";
      resourceLegend.innerHTML = concentrationLegendHtml(state.resource === "none" ? "" : state.resource);
    }
  }

  /** The picker lists every item the player can see a source of; a chosen item stays chosen while it is listed. */
  function syncResourcePicker() {
    if (!resourceSelect) return;
    const items = overlayItems(state.systems, beltSlots());
    const options = ["none", ...items];
    const have = [...(resourceSelect.options || [])].map((o) => o.value);
    if (have.join("|") !== options.join("|")) {
      resourceSelect.innerHTML = options.map((value) =>
        `<option value="${escapeHtmlAttr(value)}">${value === "none" ? "None" : escapeHtmlAttr(value)}</option>`).join("");
    }
    setResource(state.resource);
  }

  /** The cluster panel with a resource chosen: the richest systems, so a phone that names few stars still says where. */
  function richestHtml() {
    if (state.resource === "none") return "";
    const ranked = state.systems
      .map((system) => ({ system, ...systemConcentration(system, state.resource, beltSlots()) }))
      .filter((r) => r.best > 0)
      .sort((a, b) => b.best - a.best || a.system.name.localeCompare(b.system.name))
      .slice(0, 6);
    if (!ranked.length) return `<p class="ui-panel__meta">No body you can see yields ${escapeHtmlAttr(state.resource)}.</p>`;
    return `<h4 class="starmap__subhead">Richest in ${escapeHtmlAttr(state.resource)}</h4><ul class="ui-list" data-overlay-richest>${
      ranked.map((r) => `<li>${escapeHtmlAttr(r.system.name)}: ${concentrationText(r.best)} (${escapeHtmlAttr(r.body.name)})</li>`).join("")}</ul>`;
  }

  /** A system's panel with a resource chosen: every body, moons included, best first, belts named when not scouted. */
  function systemConcentrationHtml(system) {
    if (state.resource === "none") return "";
    const rows = concentrationRows(system, state.resource, beltSlots());
    return `<h4 class="starmap__subhead">${escapeHtmlAttr(state.resource)} here</h4><ul class="ui-list" data-overlay-bodies>${
      rows.map((r) => `<li>${escapeHtmlAttr(r.name)} (${escapeHtmlAttr(r.type)}): ${escapeHtmlAttr(r.text)}</li>`).join("")}</ul>`;
  }

  function getSelectedSystem() {
    return state.systems.find((item) => item.id === state.selectedSystemId) || null;
  }

  function getSelectedBody() {
    const system = getSelectedSystem();
    if (!system) {
      return null;
    }
    return (system.bodies || []).find((item) => item.id === state.selectedBodyId) || null;
  }

  /** ISP-82 (AB#771): the details panel is a design-system panel: its heading, then a stack of what it says. */
  function detailsHtml(title, body) {
    return `<header class="ui-panel__header"><h3 class="ui-panel__title">${escapeHtmlAttr(title)}</h3></header>
      <div class="ui-panel__body ui-stack">${body}</div>`;
  }

  /** ISP-218 (AB#913): the colours and legend for the dominance overlay shown now, or null. */
  function currentDominanceKey() {
    if (!isDominanceOverlay(state.overlay)) return null;
    const own = DOMINANCE_OVERLAYS[state.overlay].view === "byCorporation" ? state.ownNames.corporation : state.ownNames.conglomerate;
    return dominanceKey(state.dominance, state.overlay, own);
  }

  /** ISP-229 (AB#924): the colours and legend for the Concessions overlay, or null when it is not shown. */
  function currentConcessionKey() {
    if (state.overlay !== CONCESSION_OVERLAY) return null;
    return concessionKey(state.concessions, [state.ownNames.corporation, state.ownNames.conglomerate].filter(Boolean));
  }

  /** ISP-229 (AB#924): a system's concession section, from what the page has read (the register, control, status). */
  function concessionSystemHtml(system) {
    if (!state.concessions) return "";
    const own = [state.ownNames.corporation, state.ownNames.conglomerate].filter(Boolean);
    const read = state.systemConcession[system.id] || {};
    return concessionDetailsHtml(state.concessions.systems?.[system.id], read.control || null, read.status || null, own);
  }

  function renderDominanceLegend() {
    if (!dominanceLegend) return;
    if (state.overlay === CONCESSION_OVERLAY) { // ISP-229 (AB#924): the same legend slot
      const key = currentConcessionKey();
      dominanceLegend.hidden = false;
      dominanceLegend.innerHTML = concessionLegendHtml(key);
      return;
    }
    const key = currentDominanceKey();
    dominanceLegend.hidden = !key;
    dominanceLegend.innerHTML = key ? dominanceLegendHtml(key, state.overlay, { computedAt: state.dominance?.computedAt }) : "";
  }

  function dominanceSystemHtml(system) {
    if (!isDominanceOverlay(state.overlay)) return "";
    const own = DOMINANCE_OVERLAYS[state.overlay].view === "byCorporation" ? state.ownNames.corporation : state.ownNames.conglomerate;
    return dominanceDetailsHtml(state.dominance?.systems?.[system.id], state.overlay, own);
  }

  function renderDetails() {
    const system = getSelectedSystem();
    const body = getSelectedBody();

    if (!detailsEl) {
      return;
    }

    if (state.view === "cluster") {
      // ISP-116 (AB#808): a selected system the corporation cannot jump to says why here too, under the map; on a
      // phone this is the only place it says so (its line is wider than a phone's canvas).
      const lock = system && !canTravelToSystem(system.id)
        ? `<p class="starmap__status starmap__status--locked">${escapeHtmlAttr(system.name)}: ${escapeHtmlAttr(travelLockText(system.id))}</p>`
        : "";
      const domHint = isDominanceOverlay(state.overlay) ? `<p class="ui-panel__meta">Select a system to see who leads it, and by how much.</p>` : "";
      detailsEl.innerHTML = detailsHtml("Star Cluster", `<p class="ui-panel__meta">Select a system to enter solar view mode.</p>${lock}${domHint}${richestHtml()}`);
      return;
    }

    if (state.view === "system" && system) {
      const bodyLines = (system.bodies || [])
        .filter((entry) => entry.type === "Planet" || entry.type === "Field")
        .map((entry) => `<li>${escapeHtmlAttr(entry.name)} (${escapeHtmlAttr(entry.type)})</li>`)
        .join("");
      const currentSystemId = state.currentSystemId || "sol";
      const isCurrentSystem = system.id === currentSystemId;
      const reachable = canTravelToSystem(system.id);
      let jumpHtml = "";
      if (isCurrentSystem) {
        jumpHtml = `<p class="starmap__status starmap__status--here">Currently in this system. Select a body to view stations.</p>`;
      } else if (!reachable) {
        jumpHtml = `<p class="starmap__status starmap__status--locked">${escapeHtmlAttr(travelLockText(system.id))}</p>`;
      } else if (onTravelToSystem) {
        jumpHtml = `<div><button class="ui-button ui-button--secondary starmap__jump" type="button" data-system-id="${escapeHtmlAttr(system.id)}">Jump to ${escapeHtmlAttr(system.name)}</button></div>
          <p class="ui-panel__meta">Stations can only be docked from inside the destination system.</p>`;
      }
      detailsEl.innerHTML = detailsHtml(system.name, `
        <p class="ui-panel__meta">GDP ${system.gdpIndex} | Activity ${system.activityLevel} | Pirates ${system.pirateDensity}</p>
        <p>${escapeHtmlAttr(system.ownerRule || "Ownership available via territorial dominance and treaties.")}</p>
        <ul class="ui-list">${bodyLines}</ul>
        ${systemConcentrationHtml(system)}
        ${dominanceSystemHtml(system)}
        ${concessionSystemHtml(system)}
        ${tariffPanelHtml(system.id, state.tariffs, system.name)}
        ${jumpHtml}
      `);
      // ISP-229 (AB#924): the page reads this system's control and the viewer's status; its buttons are the page's.
      onSystemShown?.(system.id);
      detailsEl.querySelector('[data-role="concession-petition"]')?.addEventListener("click", (e) => onConcessionAction?.("petition", system.id, { ...e.currentTarget.dataset }));
      detailsEl.querySelector('[data-role="concession-relinquish"]')?.addEventListener("click", () => onConcessionAction?.("relinquish", system.id, {}));
      detailsEl.querySelector('[data-role="concession-discount"]')?.addEventListener("submit", (e) => { e.preventDefault(); onConcessionAction?.("discount", system.id, { discountPct: Number(e.currentTarget.discountPct.value) }); });
      // ISP-231 (AB#926): a holder docked in the system files a rate here
      detailsEl.querySelector('[data-form="file-tariff"]')?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const status = detailsEl.querySelector('[data-role="tariff-status"]');
        const button = form.querySelector('button[type="submit"]');
        if (!onFileTariff) return;
        button.disabled = true;
        const refusal = await onFileTariff(form.getAttribute("data-system-id"), Number(form.elements.pct.value));
        button.disabled = false;
        if (status && refusal) status.textContent = refusal;
      });
      // Bind the jump button rendered in the system view.
      detailsEl.querySelectorAll(".starmap__jump").forEach((btn) => {
        btn.addEventListener("click", () => {
          const systemId = btn.getAttribute("data-system-id");
          if (systemId && onTravelToSystem) {
            onTravelToSystem(systemId);
          }
        });
      });
      return;
    }

    if (state.view === "body" && system && body) {

      // Find stations orbiting this body
      const bodyStations = state.stations.filter(
        (s) => s.systemId === system.id && s.body === body.name
      );
      const stationListHtml = bodyStations.length
        ? `<h4 class="starmap__subhead">Stations</h4><ul class="starmap__stations">${bodyStations.map((s) => {
            const isCurrent = s.id === state.currentStationId;
            const reachable = canTravelToSystem(s.systemId);
            const inSameSystem = (state.currentSystemId || "sol") === s.systemId;
            const dockLabel = isCurrent
              ? `<span class="ui-badge ui-badge--accent">Docked</span>`
              : !reachable
                ? `<span class="starmap__status starmap__status--locked">Needs ${escapeHtmlAttr(getNavigation().travelResearchName(researchCatalog, s.systemId) || "navigation research")}</span>`
              : inSameSystem && onDockAtStation
                ? `<button class="ui-button ui-button--secondary starmap__dock" type="button" data-station-id="${escapeHtmlAttr(s.id)}">Dock</button>`
              : !inSameSystem
                ? `<span class="ui-panel__meta">Jump to ${escapeHtmlAttr(s.systemId)} system first</span>`
                : "";
            return `<li class="starmap__station-row"><span><strong>${escapeHtmlAttr(s.name)}</strong> <span class="ui-panel__meta">${escapeHtmlAttr(s.designation)}</span></span>${dockLabel}</li>`;
          }).join("")}</ul>`
        : "";

      // ── Asteroid Belt (Field) mining panel ──
      if (body.type === "Field") {
        const beltKey = `${system.id}:${body.id}`;
        const am = state.asteroidMining || {};
        const scoutedBelts = am.scoutedBelts || [];
        const beltComps = am.beltCompositions || {};
        // AB#2331: the slot as the server shows this account; before it has arrived, the account's scouting list.
        const slot = (am.belts || {})[beltKey] || null;
        const isEmptySlot = slot ? !slot.present : false;
        const isBeltScouted = slot ? slot.scouted : scoutedBelts.includes(beltKey);
        if (state.beltNotice && state.beltNotice.beltKey !== beltKey) state.beltNotice = null; // Bug #2339: this belt's only
        const noticeHtml = beltNoticeHtml(state.beltNotice?.message);
        const hasProspecting = state.unlockedTech.has("tt-asteroid-prospecting");
        const hasAssemblyTech = state.unlockedTech.has("tt-assembly-fabrication");
        const inSameSystem = (state.currentSystemId || "sol") === system.id;
        const activeExps = (am.activeExpeditions || []).filter(e => e.beltKey === beltKey);

        // Bug #1264: scouted, but the composition has not arrived from the server yet (it is fetched after a load).
        let compositionHtml = isBeltScouted && !beltComps[beltKey] ? scoutedBeltLoadingHtml() : "";
        if (isEmptySlot) {
          compositionHtml = emptyBeltHtml(slot, am.respawnChancePerHour);
        } else if (isBeltScouted && (slot?.composition || beltComps[beltKey])) {
          compositionHtml = scoutedBeltHtml(slot, slot?.composition || beltComps[beltKey]) // AB#2331
            + unrecoveredItemsHtml(Object.keys(slot?.composition || beltComps[beltKey] || {}), researchCatalog, state.unlockedTech); // AB#885
        } else if (!isBeltScouted) {
          compositionHtml = unscoutedBeltHtml({ hasProspecting, inSameSystem, systemName: system.name });
        }

        let miningHtml = "";
        if (!hasAssemblyTech && !hasProspecting) {
          miningHtml = `<div class="ui-state">
            <p class="ui-state__title">Mining Operations Locked</p>
            <p class="ui-state__why">Research <em>Assembly &amp; Fabrication Systems</em> and <em>Asteroid Prospecting Arrays</em> in Corporate R&amp;D to unlock asteroid belt mining.</p>
          </div>`;
        } else if (hasAssemblyTech && !hasProspecting) {
          miningHtml = `<div class="ui-state">
            <p class="ui-state__title">Mining Probes Locked</p>
            <p class="ui-state__why">Research <em>Asteroid Prospecting Arrays</em> to unlock Mining Probe fabrication and expedition operations.</p>
          </div>`;
        } else if (hasProspecting) {
          const probeCount = am.probeCount || 0;
          const maxDeployments = am.maxDeployments || 1;
          const activeCount = (am.activeExpeditions || []).length;
          // Bug #4656: a belt a conglomerate partner scouted can be launched to from any system the research reaches,
          // for a share of the yield (the server decides again: server/routes/asteroids.js)
          const remoteLaunch = !inSameSystem && Boolean(slot?.sharedBy?.length) && canTravelToSystem(system.id);
          const canLaunch = !isEmptySlot && isBeltScouted && probeCount > 0 && activeCount < maxDeployments && (inSameSystem || remoteLaunch);
          const remotePct = am.remoteDispatchYieldPct ?? 50;

          let activeExpHtml = "";
          if (activeExps.length > 0) {
            activeExpHtml = `<h4 class="starmap__subhead">Active Expeditions</h4>` + activeExps.map(exp => {
              const elapsed = Date.now() - exp.deployedAt;
              const total = exp.completesAt - exp.deployedAt;
              const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
              const remainMs = Math.max(0, exp.completesAt - Date.now());
              const mins = Math.floor(remainMs / 60000);
              const secs = Math.floor((remainMs % 60000) / 1000);
              const yieldEntries = Object.entries(exp.yields || {});
              const yieldText = yieldEntries.length ? yieldEntries.map(([r, q]) => `${q} ${r}`).join(", ") : "Scanning...";
              return `<div class="ui-card starmap__expedition">
                <p class="ui-card__meta starmap__expedition-time">${escapeHtmlAttr(exp.duration)} expedition — ${mins}m ${secs}s remaining</p>
                <div class="progress-wrap" role="progressbar" aria-label="${escapeHtmlAttr(`${exp.duration} expedition`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div class="progress-bar" style="width:${pct.toFixed(1)}%"></div></div>
                <p class="ui-card__meta">Yields so far: ${escapeHtmlAttr(yieldText)}</p>
              </div>`;
            }).join("");
          }

          miningHtml = `
            <section class="ui-stack starmap__mining">
              <h4 class="starmap__subhead">Asteroid Belt Mining</h4>
              <p class="ui-panel__meta">Probes: <strong>${probeCount}</strong> available | Deployment Slots: <strong>${activeCount}/${maxDeployments}</strong></p>
              ${activeExpHtml}
              ${canLaunch ? `
                <div class="ui-field">
                  <label class="ui-field__label" for="expedition-duration">Mission Duration</label>
                  <select id="expedition-duration" class="ui-select">
                    <option value="short">Short Sweep (30 min)</option>
                    <option value="standard" selected>Standard Survey (1 hr)</option>
                    <option value="extended">Deep Core Drill (2 hr)</option>
                  </select>
                </div>
                ${remoteLaunch ? `<p class="ui-panel__meta belt-remote" data-belt-remote>Remote launch on your partner's scouting: you are not in ${escapeHtmlAttr(system.name)}, so the probe works at range and brings home <strong>${remotePct}%</strong> of what it mines. The ore lands at this system's station.</p>` : ""}
                <div><button id="launch-expedition-btn" class="ui-button ui-button--secondary" type="button">${remoteLaunch ? "Launch Remote Expedition" : "Launch Expedition"} (¤3,000)</button></div>
              ` : isEmptySlot
                ? "" // AB#2331: the empty state above says why, and when
                : !isBeltScouted
                ? `<p class="ui-panel__meta">Scout this asteroid belt before launching expeditions.</p>`
                : !inSameSystem
                ? `<p class="ui-panel__meta">${slot?.sharedBy?.length ? "Your research does not reach this system yet, so a probe cannot be launched to it from here." : "You must be in this system to launch expeditions. A belt a conglomerate partner has scouted can be launched to from anywhere your research reaches."}</p>`
                : probeCount <= 0
                  ? `<p class="ui-panel__meta">No probes available. Fabricate probes at your Assembly Facility.</p>`
                  : `<p class="ui-panel__meta">All deployment slots occupied. Wait for a probe to return.</p>`
              }
            </section>
          `;
        }

        detailsEl.innerHTML = detailsHtml(`${body.name} — ${system.name}`, `
          <p class="ui-panel__meta">Type: Asteroid Belt${slot?.present ? ` · Generation ${Number(slot.generation) || 1}` : ""}</p>
          ${compositionHtml}
          ${noticeHtml}
          ${miningHtml}
          ${stationListHtml}
        `);

        // Bind scout belt button
        const scoutBeltBtn = detailsEl.querySelector("#scout-belt-btn");
        if (scoutBeltBtn) {
          scoutBeltBtn.addEventListener("click", () => {
            if (onScoutBelt) onScoutBelt(system.id, body.id, beltKey);
            render();
          });
        }

        // Bind launch expedition button
        const launchBtn = detailsEl.querySelector("#launch-expedition-btn");
        if (launchBtn) {
          launchBtn.addEventListener("click", () => {
            const durationSelect = detailsEl.querySelector("#expedition-duration");
            const duration = durationSelect?.value || "standard";
            if (onLaunchExpedition) onLaunchExpedition(beltKey, duration);
          });
        }
      } else {
        // Non-field body (planet/moon)
        detailsEl.innerHTML = detailsHtml(`${body.name} - ${system.name}`, `
          <p class="ui-panel__meta">Type: ${escapeHtmlAttr(body.type)}</p>
          ${bodyResourceHtml(body, state.stations, { tree: researchCatalog, unlockedTech: state.unlockedTech })}
          ${stationListHtml}
        `);
      }

      // Bind dock buttons in starmap details
      detailsEl.querySelectorAll(".starmap__dock").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const stationId = btn.getAttribute("data-station-id");
          if (stationId && onDockAtStation) {
            btn.disabled = true;
            const result = await onDockAtStation(stationId);
            // Bug #4651: a refusal is said beside the station it refused, not only on the Overview's feedback list
            if (result?.error) {
              btn.disabled = false;
              const row = btn.closest(".starmap__station-row");
              let why = row?.querySelector(".starmap__dock-refused");
              if (row && !why) {
                why = document.createElement("p");
                why.className = "starmap__dock-refused";
                why.setAttribute("role", "alert");
                row.append(why);
              }
              if (why) why.textContent = result.error;
            }
          }
        });
      });
      // Bind travel-to-system buttons in starmap details
      detailsEl.querySelectorAll(".starmap__jump").forEach((btn) => {
        btn.addEventListener("click", () => {
          const systemId = btn.getAttribute("data-system-id");
          if (systemId && onTravelToSystem) {
            onTravelToSystem(systemId);
          }
        });
      });
    }

    if (state.view === "asteroid" && system && body) {
      const asteroidId = state.selectedAsteroidId || `${system.id}:${body.id}:ast-0`;
      // Redirect asteroid detail view to the belt mining panel
      const beltKey = `${system.id}:${body.id}`;
      const am = state.asteroidMining || {};
      // AB#740: the belt's surveyed composition from the server, or nothing; no longer a class drawn from a hash.
      const slot = (am.belts || {})[beltKey]; // AB#2331: this generation's, when the server has said
      const surveyed = slot ? (slot.scouted && slot.composition) : (am.scoutedBelts || []).includes(beltKey) && (am.beltCompositions || {})[beltKey];
      const profile = surveyed
        ? Object.entries(surveyed).sort((x, y) => y[1] - x[1]).map(([name, pct]) => `${name} ${pct}%`).join(", ")
        : "Not surveyed (scout the belt)";
      const hasProspecting = state.unlockedTech.has("tt-asteroid-prospecting");
      detailsEl.innerHTML = detailsHtml(`Asteroid Sample — ${body.name}`, `
        <p class="ui-panel__meta">Catalog ID: ${escapeHtmlAttr(asteroidId.split(":").slice(-1)[0])} | Belt composition: ${escapeHtmlAttr(profile)}</p>
        ${hasProspecting
          ? `<p class="ui-panel__meta">Use the belt-level view to launch mining expeditions to this asteroid field.</p>`
          : `<p class="ui-panel__meta">Research Asteroid Prospecting Arrays to unlock mining operations in this belt.</p>`
        }
      `);
    }
  }

  function renderFallback() {
    if (!fallbackEl) {
      return;
    }

    // ISP-116 (AB#808): every system, and whether the corporation can jump there or which research it needs first.
    const rows = state.systems
      .map((system) => {
        const research = canTravelToSystem(system.id) ? null : getNavigation().travelResearchName(researchCatalog, system.id);
        const reach = system.id === (state.currentSystemId || "sol") ? "You are here." : research ? `Requires ${escapeHtmlAttr(research)}.` : "Reachable.";
        return `<li data-system-id="${escapeHtmlAttr(system.id)}"><strong>${escapeHtmlAttr(system.name)}</strong> - ${(system.bodies || []).length} catalogued bodies. ${reach}</li>`;
      })
      .join("");

    fallbackEl.innerHTML = `
      <p class="ui-state__title">Text-mode Starmap Summary</p>
      <p class="ui-state__why">Graphical mode unavailable. Use list navigation to inspect systems and body counts.</p>
      <ul class="ui-list">${rows}</ul>
    `;
  }

  // AB#742: every Starmap frame is timed as a performance measure, "isp:starmap-render" (the AB#730 pattern), so a
  // frame's cost can be read from DevTools or a script; e2e/procedural-bodies.spec.js holds it under 16 ms throttled.
  function render() {
    const start = performance.now();
    // ISP-210 (AB#905): the legend explains the violet marker only when there is one to explain
    const ownedLegend = typeof document !== "undefined" ? document.getElementById("starmap-legend-owned") : null;
    if (ownedLegend) ownedLegend.hidden = !(state.stations || []).some(isConglomerateStation);
    try {
      renderFrame();
    } finally {
      performance.measure("isp:starmap-render", { start });
    }
  }

  function renderFrame() {
    if (!ctx || !canvas || canvas.hidden || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) {
      renderFallback();
      return;
    }

    // Bug #1286: a canvas sized while its tab was hidden has a 1x1 backing store; size it to its box before drawing.
    const expected = canvasBackingSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
    if (canvas.width !== expected.width || canvas.height !== expected.height) {
      setCanvasSize();
    }

    clearScene();

    const system = getSelectedSystem();
    const body = getSelectedBody();

    if (state.view === "cluster") {
      drawClusterView();
      return;
    }

    if (state.view === "system" && system) {
      drawSystemView(system);
      return;
    }

    if (state.view === "body" && system && body) {
      drawBodyView(system, body);
      return;
    }

    if (state.view === "asteroid" && system && body) {
      drawAsteroidView(system, body, state.selectedAsteroidId);
      return;
    }

    state.view = "cluster";
    drawClusterView();
  }

  function handleClick(event) {
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const hit = state.clickTargets.find((target) => targetHit(target, x, y));
    if (!hit) {
      return;
    }

    if (hit.type === "system") {
      state.selectedSystemId = hit.systemId;
      state.selectedBodyId = null;
      state.view = "system";
      render();
      return;
    }

    if (hit.type === "body") {
      state.selectedSystemId = hit.systemId;
      state.selectedBodyId = hit.bodyId;
      state.selectedAsteroidId = null;
      state.view = "body";
      render();
      return;
    }

    if (hit.type === "asteroid") {
      state.selectedSystemId = hit.systemId;
      state.selectedBodyId = hit.bodyId;
      state.selectedAsteroidId = hit.asteroidId;
      state.view = "asteroid";
      render();
      return;
    }

    if (hit.type === "back") {
      state.view = "cluster";
      state.selectedBodyId = null;
      state.selectedAsteroidId = null;
      render();
      return;
    }

    if (hit.type === "back-to-system") {
      state.view = "system";
      state.selectedBodyId = null;
      state.selectedAsteroidId = null;
      render();
      return;
    }

    if (hit.type === "back-to-body") {
      state.view = "body";
      state.selectedAsteroidId = null;
      render();
      return;
    }

    if (hit.type === "back-to-cluster") {
      state.view = "cluster";
      state.selectedBodyId = null;
      state.selectedAsteroidId = null;
      render();
      return;
    }

    if (hit.type === "station") {
      openStationModal(hit.stationId);
      return;
    }
  }

  // ─── Station tooltip ───────────────────────────────────────────────────────
  let tooltip = null;

  function ensureTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement("div");
    tooltip.className = "starmap__tooltip";
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function handleMouseMove(event) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const hit = state.clickTargets.find(
      (t) => t.type === "station" && Math.hypot(t.x - x, t.y - y) <= t.radius
    );

    const tip = ensureTooltip();
    if (hit) {
      const station = state.stations.find((s) => s.id === hit.stationId);
      tip.textContent = station ? station.name : hit.stationId;
      tip.hidden = false;
      tip.style.left = `${event.clientX + 12}px`;
      tip.style.top = `${event.clientY - 8}px`;
      canvas.style.cursor = "pointer";
    } else {
      tip.hidden = true;
      canvas.style.cursor = "";
    }
  }

  // ─── Station detail modal ─────────────────────────────────────────────────
  function openStationModal(stationId) {
    const station = state.stations.find((s) => s.id === stationId);
    if (!station) return;

    // Remove any existing modal
    closeStationModal();

    const isCurrent = station.id === state.currentStationId;

    const overlay = document.createElement("section");
    overlay.className = "modal-backdrop";
    overlay.id = "starmap-station-modal";

    // Bug #2340: the catalog's buildingIds, the one office rate, and the station's jurisdiction (AB#810). The modal read
    // buildings, officeRentPerCycle and ownership, which no station has, so every one said 0, "—" and NPC-controlled.
    const buildingCount = Array.isArray(station.buildingIds) ? station.buildingIds.length : 0;
    const memberStation = getMemberStation();
    const officeRent = `¤${memberOfficeCost(officeLeaseCost(1), memberStation, station.id).toLocaleString("en-US")} a day, for 7 to 28 days${isMemberStation(memberStation, station.id) ? " (member rate)" : ""}`;
    const jurisdiction = isNeutralStation(station)
      ? "Neutral: no corporation owns it; any corporation may dock and rent an office here."
      : isConglomerateStation(station) // ISP-210 (AB#905): built by a conglomerate; GET /api/stations names it, never its id
        ? `Owned by ${station.ownerName || "a conglomerate"}, the conglomerate that built it.`
        : `Jurisdiction: ${station.jurisdiction || "not recorded"}`;

    overlay.innerHTML = `
      <article class="modal-card starmap__station" role="dialog" aria-modal="true" aria-labelledby="starmap-station-title">
        <header class="starmap__station-head">
          <div>
            <p class="starmap__overline">${escapeHtmlAttr(station.designation || "")} // ${escapeHtmlAttr((station.systemId || "").toUpperCase())}</p>
            <h2 id="starmap-station-title" class="starmap__station-title">${escapeHtmlAttr(station.name)}</h2>
          </div>
          <button class="ui-button ui-button--ghost starmap__close" type="button" aria-label="Close">&times;</button>
        </header>
        <p class="ui-panel__meta">In orbit of ${escapeHtmlAttr(station.body)}. ${escapeHtmlAttr(jurisdiction)}</p>

        <dl class="ui-kv">
          <dt>Buildings</dt><dd>${buildingCount}</dd>
          <dt>Office Rent</dt><dd>${officeRent}</dd>
          <dt>Status</dt><dd>${isCurrent ? "Docked" : "Not docked"}</dd>
        </dl>

        ${station.description ? `<p class="ui-panel__meta">${escapeHtmlAttr(station.description)}</p>` : ""}

        <div class="starmap__station-actions">
          ${isCurrent
            ? `<p class="ui-panel__meta">You are currently docked at this station.</p>`
            : !canTravelToSystem(station.systemId)
              ? `<p class="starmap__status starmap__status--locked">${escapeHtmlAttr(travelLockText(station.systemId))}</p>`
            : (state.currentSystemId || "sol") === station.systemId
              ? `<button class="ui-button ui-button--primary starmap__station-dock" type="button" data-station-id="${escapeHtmlAttr(station.id)}">Dock at Station</button><p class="starmap__dock-refused" role="alert" hidden></p>`
              : `<p class="ui-panel__meta">Jump to <strong>${escapeHtmlAttr(systemName(state.systems, station.systemId) || "its system")}</strong> from the system view, then dock here.</p>`
          }
        </div>
      </article>
    `;

    document.body.appendChild(overlay);

    // Bind close
    overlay.querySelector(".starmap__close")?.addEventListener("click", closeStationModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeStationModal();
    });

    // Bind travel/dock
    const dockBtn = overlay.querySelector(".starmap__station-dock");
    if (dockBtn) {
      dockBtn.addEventListener("click", async () => {
        const sid = dockBtn.getAttribute("data-station-id");
        if (sid && onDockAtStation) {
          dockBtn.disabled = true;
          const result = await onDockAtStation(sid);
          // Bug #4651: the modal stays open on a refusal and says why; it closes once the ship is on its way
          if (result?.error) {
            dockBtn.disabled = false;
            const why = overlay.querySelector(".starmap__dock-refused");
            if (why) {
              why.textContent = result.error;
              why.hidden = false;
            }
          } else closeStationModal();
        }
      });
    }
  }

  function closeStationModal() {
    const existing = document.getElementById("starmap-station-modal");
    if (existing) existing.remove();
  }

  function escapeHtmlAttr(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bindEvents() {
    if (!canvas) {
      return;
    }

    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", () => {
      if (tooltip) tooltip.hidden = true;
      canvas.style.cursor = "";
    });

    overlaySelect?.addEventListener("change", () => {
      state.overlay = overlaySelect.value;
      // ISP-143 (AB#837): the two overlays both colour the stars, so choosing one clears the other.
      if (state.overlay !== "none") setResource("none");
      render();
      renderDominanceLegend(); // ISP-218 (AB#913)
      renderDetails();
      onOverlayChange?.(state.overlay);
    });

    resourceSelect?.addEventListener("change", () => {
      setResource(resourceSelect.value);
      if (state.resource !== "none" && overlaySelect) { overlaySelect.value = "none"; state.overlay = "none"; }
      render();
      renderDetails();
    });

    resetButton?.addEventListener("click", () => {
      state.view = "cluster";
      state.selectedBodyId = null;
      render();
    });

    window.addEventListener("resize", () => {
      setCanvasSize();
      render();
    });

    _starmapRender = render;
  }

  function setGraphicsMode(enabled) {
    if (!canvas || !fallbackEl) {
      return;
    }

    canvas.hidden = !enabled;
    fallbackEl.hidden = enabled;
    render();
  }

  function mount(initialSystems) {
    state.systems = initialSystems || [];
    state.selectedSystemId = state.systems[0]?.id || null;

    const graphicsAvailable = Boolean(ctx);
    if (!graphicsAvailable) {
      fallbackEl.hidden = false;
      renderFallback();
      return;
    }

    bindEvents();
    setCanvasSize();
    render();
  }

  return {
    mount,
    setSystems(nextSystems) {
      state.systems = nextSystems || [];
      syncResourcePicker(); // AB#837
      if (!state.systems.some((item) => item.id === state.selectedSystemId)) {
        state.selectedSystemId = state.systems[0]?.id || null;
        state.selectedBodyId = null;
        state.selectedAsteroidId = null;
        state.view = "cluster";
      }
      render();
    },
    setStations(nextStations, currentStationId, currentSystemId) {
      state.stations = nextStations || [];
      state.currentStationId = currentStationId || null;
      state.currentSystemId = currentSystemId || "sol";
      render();
    },
    setGraphicsMode,
    /**
     * ISP-82 (AB#771): show a system, or one of its bodies, as a click on the map would, and say whether it could.
     * e2e/starmap-screen.spec.js opens a belt and a planet this way rather than hunting for them on the canvas.
     */
    show({ systemId, bodyId = null } = {}) {
      const system = state.systems.find((item) => item.id === systemId);
      if (!system || (bodyId && !(system.bodies || []).some((item) => item.id === bodyId))) return false;
      state.selectedSystemId = systemId;
      state.selectedBodyId = bodyId;
      state.selectedAsteroidId = null;
      state.view = bodyId ? "body" : "system";
      render();
      return true;
    },
    /** A station's detail modal, as a click on the station does. */
    openStation(stationId) {
      openStationModal(stationId);
    },
    setOverlay(value) {
      state.overlay = value;
      render();
      renderDominanceLegend();
    },
    /** ISP-229 (AB#924): every system's concession, and the viewer's own names (the overlay marks its holder). */
    setConcessions(reading, { corporation = "", conglomerate = "" } = {}) {
      state.concessions = reading && reading.systems ? reading : null;
      if (corporation || conglomerate) state.ownNames = { corporation, conglomerate };
      render();
      renderDominanceLegend();
      renderDetails();
    },
    /** ISP-229 (AB#924): one system's control reading and the viewer's status, for its panel. */
    setSystemConcession(systemId, read) {
      state.systemConcession[systemId] = read;
      if (state.view === "system" && state.selectedSystemId === systemId) renderDetails();
    },
    /** ISP-231 (AB#926): the viewer's tariff summary (GET /api/accounts/:id/tariffs): held systems' rates and its own. */
    setTariffs(summary) {
      state.tariffs = summary || null;
      if (state.view === "system") renderDetails();
    },
    /** ISP-218 (AB#913): the dominance reading, and the viewer's own corporation and conglomerate names. */
    setDominance(reading, { corporation = "", conglomerate = "" } = {}) {
      state.dominance = reading && reading.systems ? reading : null;
      state.ownNames = { corporation, conglomerate };
      render();
      renderDominanceLegend();
      renderDetails();
    },
    rerender() {
      render();
    },
    setUnlockedTech(techSet) {
      state.unlockedTech = techSet instanceof Set ? techSet : new Set(techSet || []);
    },
    /** Bug #2339: show a refused scout or launch in that belt's panel (null clears it). */
    setBeltNotice(notice) {
      state.beltNotice = notice && notice.message ? notice : null;
      if (state.view === "body") renderDetails();
    },
    /** ISP-143 (AB#837): show an item's concentration ("none" hides the overlay). */
    setResourceOverlay(item) {
      setResource(item);
      if (state.resource !== "none" && overlaySelect) { overlaySelect.value = "none"; state.overlay = "none"; }
      render();
      renderDetails();
    },
    setAsteroidMining(amState) {
      state.asteroidMining = amState || null;
      syncResourcePicker(); // AB#837: a newly scouted belt can add an item
      // Re-render details panel if we're viewing a belt
      if (state.view === "body" || state.view === "asteroid") {
        renderDetails();
      }
    },
    updateExpeditionProgress() {
      if (!detailsEl || (state.view !== "body" && state.view !== "asteroid")) return;
      const am = state.asteroidMining;
      if (!am) return;
      const system = getSelectedSystem();
      const body = getSelectedBody();
      if (!system || !body || body.type !== "Field") return;
      const beltKey = `${system.id}:${body.id}`;
      const activeExps = (am.activeExpeditions || []).filter(e => e.beltKey === beltKey);
      const cards = detailsEl.querySelectorAll(".starmap__expedition");
      cards.forEach((card, i) => {
        const exp = activeExps[i];
        if (!exp) return;
        const elapsed = Date.now() - exp.deployedAt;
        const total = exp.completesAt - exp.deployedAt;
        const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
        const remainMs = Math.max(0, exp.completesAt - Date.now());
        const mins = Math.floor(remainMs / 60000);
        const secs = Math.floor((remainMs % 60000) / 1000);
        const bar = card.querySelector(".progress-bar");
        if (bar) bar.style.width = pct.toFixed(1) + "%";
        const timeEl = card.querySelector(".starmap__expedition-time");
        const barWrap = card.querySelector(".progress-wrap");
        if (barWrap) barWrap.setAttribute("aria-valuenow", String(Math.round(pct)));
        if (timeEl) timeEl.textContent = `${exp.duration} expedition — ${mins}m ${secs}s remaining`;
      });
    },
    resize() {
      setCanvasSize();
      render();
    }
  };
}
