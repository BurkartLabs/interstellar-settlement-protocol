import { canReachSystem, travelResearchLock, travelResearchName } from "./navigation.js";
import { bodyResourceHtml } from "./bodyInfo.js"; // AB#740: what the catalogue holds, not a hash of the name
import { systemName } from "./displayNames.js"; // AB#1336

const CLUSTER_LAYOUT = {
  sol: { x: 0.16, y: 0.5 },
  "alpha-centauri": { x: 0.35, y: 0.26 },
  "barnards-star": { x: 0.34, y: 0.72 },
  "wolf-359": { x: 0.56, y: 0.35 },
  "tau-ceti": { x: 0.72, y: 0.55 },
  "epsilon-eridani": { x: 0.83, y: 0.3 }
};

// Starmap system view: the innermost orbit's distance from the star, and the room kept between the outermost body and
// the canvas edge; labels keep this margin from the right edge (Bug #1315).
const ORBIT_INNER = 56;
const ORBIT_EDGE_MARGIN = 20;
const LABEL_EDGE_MARGIN = 4;

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

function overlayColor(system, overlay) {
  if (overlay === "none") {
    return "rgba(0, 247, 255, 0.88)";
  }

  const value =
    overlay === "gdp"
      ? system.gdpIndex / 100
      : overlay === "activity"
        ? system.activityLevel / 100
        : overlay === "pirates"
          ? system.pirateDensity / 40
          : Math.max(0.12, (100 - system.pirateDensity + system.gdpIndex) / 150);

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

/** A scouted belt whose composition has not reached the page yet (Bug #1264): say so rather than show nothing. */
export function scoutedBeltLoadingHtml() {
  return `<p class="muted" data-belt-composition="loading">Scouted. Loading composition…</p>`;
}

function styleForBody(body) {
  return PLANET_STYLE[body.id] || FALLBACK_PLANET_STYLE;
}

/** The belt panel for an unscouted belt. Bug #1285: the Scout button is offered only to a corporation the server
 * will let scout (Asteroid Prospecting Arrays, in the belt's system: AB#1256); anyone else is told what to do instead
 * of meeting a button whose refusal only shows on the Overview tab. */
export function unscoutedBeltHtml({ hasProspecting, inSameSystem, systemName }) {
  const unknown = `<p class="muted">Material composition unknown. Scout this belt to reveal resource data.</p>`;
  if (!hasProspecting) {
    return `${unknown}
            <p class="muted" style="margin-top:0.5rem;">🔒 Research <em>Asteroid Prospecting Arrays</em> in Corporate R&amp;D to scout this belt.</p>`;
  }
  if (!inSameSystem) {
    const name = String(systemName || "this system").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `${unknown}
            <p class="muted" style="margin-top:0.5rem;">Travel to ${name} to scout this belt.</p>`;
  }
  return `${unknown}
            <button id="scout-belt-btn" class="btn btn-accent" style="margin-top:0.5rem;">Scout Asteroid Belt</button>`;
}

// ─── Planet image assets ─────────────────────────────────────────────────────
// Every Sol planet and moon has a NASA image (AB#741): public domain, each source and credit in
// public/images/planets/CREDITS.md, cropped square around the disc at 512 px and under 150 KB. The asteroid belt has
// none on purpose: it is drawn as a field of asteroids (drawAsteroidBelt), never as a disc.
const PLANET_IMAGES = {};
export const PLANET_IMAGE_PATHS = {
  mercury: "/images/planets/mercury.jpg",
  venus: "/images/planets/venus.jpg",
  earth: "/images/planets/earth.jpg",
  mars: "/images/planets/mars.jpg",
  jupiter: "/images/planets/jupiter.jpg",
  saturn: "/images/planets/saturn.jpg",
  uranus: "/images/planets/uranus.jpg",
  neptune: "/images/planets/neptune.jpg",
  luna: "/images/planets/luna.jpg",
  phobos: "/images/planets/phobos.jpg",
  deimos: "/images/planets/deimos.jpg",
  io: "/images/planets/io.jpg",
  europa: "/images/planets/europa.jpg",
  ganymede: "/images/planets/ganymede.jpg",
  callisto: "/images/planets/callisto.jpg",
  titan: "/images/planets/titan.jpg",
  enceladus: "/images/planets/enceladus.jpg"
};

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

function drawAsteroidBelt(ctx, cx, cy, radius) {
  // Faint ring glow
  const ringGlow = ctx.createRadialGradient(cx, cy, radius - 8, cx, cy, radius + 8);
  ringGlow.addColorStop(0, "rgba(155, 185, 210, 0.05)");
  ringGlow.addColorStop(0.5, "rgba(155, 185, 210, 0.08)");
  ringGlow.addColorStop(1, "rgba(155, 185, 210, 0)");
  ctx.fillStyle = ringGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
  ctx.fill();

  // Dashed ring line
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(155, 185, 205, 0.18)";
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
    ctx.fillStyle = i % 7 === 0 ? `rgba(200, 220, 240, ${alpha})` : `rgba(140, 165, 190, ${alpha * 0.8})`;
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
  resetButton,
  onTravelToSystem,
  onDockAtStation,
  onScoutBelt,
  onLaunchExpedition,
  getAsteroidMiningState,
  researchCatalog = [], // Bug #1270: to name the research a locked jump needs
  getCorpLevel = () => 0
}) {
  const ctx = canvas?.getContext?.("2d");
  const state = {
    systems: [],
    stations: [],
    currentStationId: null,
    currentSystemId: "sol",
    overlay: "none",
    view: "cluster",
    selectedSystemId: null,
    selectedBodyId: null,
    unlockedTech: new Set(),
    selectedAsteroidId: null,
    clickTargets: [],
    asteroidMining: null  // { probeCount, maxProbes, maxDeployments, activeExpeditions, scoutedBelts, beltCompositions }
  };

  // The same gate as the server's travel route (public/scripts/navigation.js, Bug #976).
  function canTravelToSystem(targetSystemId) {
    return canReachSystem(state.unlockedTech, state.currentSystemId, targetSystemId);
  }

  // Bug #1270: what the lock says, the same text the travel route refuses with.
  function travelLockText(targetSystemId) {
    return travelResearchLock(researchCatalog, state.unlockedTech, getCorpLevel(), state.currentSystemId, targetSystemId) || "";
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
  function labelX(text, x, gap) {
    const textWidth = ctx.measureText(text).width;
    return x + gap + textWidth > canvas.clientWidth - LABEL_EDGE_MARGIN ? x - gap - textWidth : x + gap;
  }

  function drawClusterView() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    state.clickTargets = [];

    const currentSystemId = state.currentSystemId || "sol";

    // Draw lane connections with gradient lines
    for (let i = 0; i < state.systems.length; i += 1) {
      for (let j = i + 1; j < state.systems.length; j += 1) {
        const a = CLUSTER_LAYOUT[state.systems[i].id];
        const b = CLUSTER_LAYOUT[state.systems[j].id];
        if (!a || !b) continue;

        const ax = a.x * width;
        const ay = a.y * height;
        const bx = b.x * width;
        const by = b.y * height;
        const d = Math.hypot(ax - bx, ay - by);
        if (d < width * 0.42) {
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
      }
    }

    // Draw star systems
    state.systems.forEach((system) => {
      const p = CLUSTER_LAYOUT[system.id] || { x: 0.5, y: 0.5 };
      const x = p.x * width;
      const y = p.y * height;
      const isSelected = state.selectedSystemId === system.id;
      const isCurrent = system.id === currentSystemId;
      const baseRadius = isSelected ? 10 : 7;
      const color = overlayColor(system, state.overlay);

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

      // System name label
      ctx.fillStyle = isSelected ? "rgba(255, 255, 255, 0.95)" : "rgba(200, 220, 240, 0.8)";
      ctx.font = isSelected ? 'bold 12px "Inter", sans-serif' : '11px "Inter", sans-serif';
      ctx.fillText(system.name, labelX(system.name, x, baseRadius + 10), y + 1);

      // "YOU ARE HERE" label for current system
      if (isCurrent) {
        ctx.fillStyle = "rgba(0, 247, 255, 0.6)";
        ctx.font = '9px "Inter", sans-serif';
        ctx.fillText("YOU ARE HERE", labelX("YOU ARE HERE", x, baseRadius + 10), y + 13);
      }

      state.clickTargets.push({
        type: "system",
        systemId: system.id,
        x,
        y,
        radius: baseRadius + 14
      });
    });

    renderDetails();
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
    ctx.font = '10px "Inter", sans-serif';
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
    ctx.font = '10px "Inter", sans-serif';
    return Math.max(88, Math.ceil(ctx.measureText(label).width + 28));
  }

  function drawStationMarker(x, y, isCurrent) {
    const size = isCurrent ? 5 : 4;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);

    // Glow
    const glowColor = isCurrent ? "rgba(0, 247, 255, 0.3)" : "rgba(255, 210, 80, 0.25)";
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 3);
    glow.addColorStop(0, glowColor);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-size * 3, -size * 3, size * 6, size * 6);

    // Diamond shape
    ctx.fillStyle = isCurrent ? "rgba(0, 247, 255, 0.95)" : "rgba(255, 210, 80, 0.9)";
    ctx.fillRect(-size, -size, size * 2, size * 2);

    // Outline
    ctx.strokeStyle = isCurrent ? "rgba(0, 247, 255, 0.5)" : "rgba(255, 210, 80, 0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-size - 2, -size - 2, size * 2 + 4, size * 2 + 4);
    ctx.restore();
  }

  function bodyHasStation(systemId, bodyName) {
    return state.stations.some((s) => s.systemId === systemId && s.body === bodyName);
  }

  function bodyHasCurrentStation(systemId, bodyName) {
    return state.stations.some((s) => s.systemId === systemId && s.body === bodyName && s.id === state.currentStationId);
  }

  function drawSystemView(system) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const { cx, cy, orbitLimit, button } = systemViewLayout(width, height, backButtonWidth("Back To Cluster"));

    state.clickTargets = [];

    const backWidth = drawBackButton("Back To Cluster", button.x, button.y);
    state.clickTargets.push({
      type: "back",
      x: button.x,
      y: button.y,
      radius: Math.max(36, backWidth * 0.55)
    });

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
        drawAsteroidBelt(ctx, x, y, beltRadius);

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
      ctx.font = '11px "Inter", sans-serif';
      const bodyLabelX = labelX(body.name, x, 8);
      ctx.fillText(body.name, bodyLabelX, y - 4);

      // Station indicator pip next to name (before it when the label is drawn to the left of the body)
      if (bodyHasStation(system.id, body.name)) {
        const hasCurrentStn = bodyHasCurrentStation(system.id, body.name);
        ctx.fillStyle = hasCurrentStn ? "rgba(0, 247, 255, 0.8)" : "rgba(255, 210, 80, 0.7)";
        const nameW = ctx.measureText(body.name).width;
        ctx.beginPath();
        ctx.arc(bodyLabelX < x ? bodyLabelX - 6 : bodyLabelX + nameW + 6, y - 7, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      state.clickTargets.push({
        type: "body",
        systemId: system.id,
        bodyId: body.id,
        x,
        y,
        radius: Math.max(10, body.radius + 8)
      });
    });

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

    state.clickTargets.push({ type: "back-to-system", x: 108, y: 36, radius: Math.max(40, backSysWidth * 0.55) });
    state.clickTargets.push({ type: "back-to-cluster", x: backClusterX, y: 36, radius: Math.max(42, backClusterWidth * 0.55) });

    if (body.type === "Field") {
      const beltRadius = Math.min(width, height) * 0.2;
      drawAsteroidBelt(ctx, cx, cy, beltRadius);

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
        drawStationMarker(markerX, markerY, isCurrent);
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
        } else {
          ctx.beginPath();
          ctx.arc(x, y, bmr, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(158, 194, 224, 0.94)";
          ctx.fill();
        }

        ctx.fillStyle = "rgba(216, 235, 245, 0.9)";
        ctx.font = "11px Inter";
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

    state.clickTargets.push({ type: "back-to-body", x: 98, y: 36, radius: Math.max(38, backBodyWidth * 0.55) });
    state.clickTargets.push({ type: "back-to-system", x: backSystemX, y: 36, radius: Math.max(38, backSystemWidth * 0.55) });

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

  function renderDetails() {
    const system = getSelectedSystem();
    const body = getSelectedBody();

    if (!detailsEl) {
      return;
    }

    if (state.view === "cluster") {
      detailsEl.innerHTML = `
        <h3>Star Cluster</h3>
        <p class="muted">Select a system to enter solar view mode.</p>
      `;
      return;
    }

    if (state.view === "system" && system) {
      const bodyLines = (system.bodies || [])
        .filter((entry) => entry.type === "Planet" || entry.type === "Field")
        .map((entry) => `<li>${entry.name} (${entry.type})</li>`)
        .join("");
      const currentSystemId = state.currentSystemId || "sol";
      const isCurrentSystem = system.id === currentSystemId;
      const reachable = canTravelToSystem(system.id);
      let jumpHtml = "";
      if (isCurrentSystem) {
        jumpHtml = `<p class="muted" style="color:rgba(0,247,255,0.85);margin-top:0.5rem;">Currently in this system. Select a body to view stations.</p>`;
      } else if (!reachable) {
        jumpHtml = `<p class="muted" style="color:rgba(255,180,60,0.85);margin-top:0.5rem;">🔒 ${escapeHtmlAttr(travelLockText(system.id))}</p>`;
      } else if (onTravelToSystem) {
        jumpHtml = `<button class="btn btn-accent starmap-travel-system-btn" data-system-id="${system.id}" style="margin-top:0.75rem;">Jump to ${escapeHtmlAttr(system.name)}</button>
          <p class="muted" style="font-size:0.78rem;margin-top:0.4rem;">Stations can only be docked from inside the destination system.</p>`;
      }
      detailsEl.innerHTML = `
        <h3>${system.name}</h3>
        <p class="muted">GDP ${system.gdpIndex} | Activity ${system.activityLevel} | Pirates ${system.pirateDensity}</p>
        <p>${system.ownerRule || "Ownership available via territorial dominance and treaties."}</p>
        <ul class="text-list">${bodyLines}</ul>
        ${jumpHtml}
      `;
      // Bind the jump button rendered in the system view.
      detailsEl.querySelectorAll(".starmap-travel-system-btn").forEach((btn) => {
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
        ? `<h4 style="margin-top:1rem;">Stations</h4><ul class="text-list">${bodyStations.map((s) => {
            const isCurrent = s.id === state.currentStationId;
            const reachable = canTravelToSystem(s.systemId);
            const inSameSystem = (state.currentSystemId || "sol") === s.systemId;
            const dockLabel = isCurrent
              ? `<span style="color:rgba(0,247,255,0.85);font-size:0.8rem;margin-left:0.4rem;">[DOCKED]</span>`
              : !reachable
                ? `<span style="color:rgba(255,180,60,0.85);font-size:0.75rem;margin-left:0.4rem;">🔒 Needs ${escapeHtmlAttr(travelResearchName(researchCatalog, s.systemId) || "navigation research")}</span>`
              : inSameSystem && onDockAtStation
                ? `<button class="btn btn-outline starmap-dock-btn" data-station-id="${s.id}" style="margin-left:0.5rem;font-size:0.75rem;padding:0.15em 0.5em;">Dock</button>`
              : !inSameSystem
                ? `<span style="color:rgba(180,180,180,0.7);font-size:0.75rem;margin-left:0.4rem;">Jump to ${escapeHtmlAttr(s.systemId)} system first</span>`
                : "";
            return `<li><strong>${s.name}</strong> <span style="opacity:0.6;">${s.designation}</span>${dockLabel}</li>`;
          }).join("")}</ul>`
        : "";

      // ── Asteroid Belt (Field) mining panel ──
      if (body.type === "Field") {
        const beltKey = `${system.id}:${body.id}`;
        const am = state.asteroidMining || {};
        const scoutedBelts = am.scoutedBelts || [];
        const beltComps = am.beltCompositions || {};
        const isBeltScouted = scoutedBelts.includes(beltKey);
        const hasProspecting = state.unlockedTech.has("tt-asteroid-prospecting");
        const hasAssemblyTech = state.unlockedTech.has("tt-assembly-fabrication");
        const inSameSystem = (state.currentSystemId || "sol") === system.id;
        const activeExps = (am.activeExpeditions || []).filter(e => e.beltKey === beltKey);

        // Bug #1264: scouted, but the composition has not arrived from the server yet (it is fetched after a load).
        let compositionHtml = isBeltScouted && !beltComps[beltKey] ? scoutedBeltLoadingHtml() : "";
        if (isBeltScouted && beltComps[beltKey]) {
          const comp = beltComps[beltKey];
          compositionHtml = `<h4 style="margin-top:0.75rem;">Material Composition</h4><ul class="text-list">${
            Object.entries(comp).map(([name, pct]) => `<li>${name}: ${pct}%</li>`).join("")
          }</ul>`;
        } else if (!isBeltScouted) {
          compositionHtml = unscoutedBeltHtml({ hasProspecting, inSameSystem, systemName: system.name });
        }

        let miningHtml = "";
        if (!hasAssemblyTech && !hasProspecting) {
          miningHtml = `<div class="starmap-mining-locked">
            <p class="muted" style="margin-top:1rem;">🔒 <strong>Mining Operations Locked</strong></p>
            <p class="muted">Research <em>Assembly &amp; Fabrication Systems</em> and <em>Asteroid Prospecting Arrays</em> in Corporate R&amp;D to unlock asteroid belt mining.</p>
          </div>`;
        } else if (hasAssemblyTech && !hasProspecting) {
          miningHtml = `<div class="starmap-mining-locked">
            <p class="muted" style="margin-top:1rem;">🔒 <strong>Mining Probes Locked</strong></p>
            <p class="muted">Research <em>Asteroid Prospecting Arrays</em> to unlock Mining Probe fabrication and expedition operations.</p>
          </div>`;
        } else if (hasProspecting) {
          const probeCount = am.probeCount || 0;
          const maxDeployments = am.maxDeployments || 1;
          const activeCount = (am.activeExpeditions || []).length;
          const canLaunch = isBeltScouted && probeCount > 0 && activeCount < maxDeployments && inSameSystem;

          let activeExpHtml = "";
          if (activeExps.length > 0) {
            activeExpHtml = `<h4 style="margin-top:0.75rem;">Active Expeditions</h4>` + activeExps.map(exp => {
              const elapsed = Date.now() - exp.deployedAt;
              const total = exp.completesAt - exp.deployedAt;
              const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
              const remainMs = Math.max(0, exp.completesAt - Date.now());
              const mins = Math.floor(remainMs / 60000);
              const secs = Math.floor((remainMs % 60000) / 1000);
              const yieldEntries = Object.entries(exp.yields || {});
              const yieldText = yieldEntries.length ? yieldEntries.map(([r, q]) => `${q} ${r}`).join(", ") : "Scanning...";
              return `<div class="starmap-expedition-card">
                <p class="muted" style="font-size:0.8rem;">${exp.duration} expedition &mdash; ${mins}m ${secs}s remaining</p>
                <div class="progress-wrap"><div class="progress-bar" style="width:${pct.toFixed(1)}%"></div></div>
                <p class="muted" style="font-size:0.78rem;margin-top:0.3rem;">Yields so far: ${yieldText}</p>
              </div>`;
            }).join("");
          }

          miningHtml = `
            <div class="starmap-mining-panel" style="margin-top:1rem;">
              <h4>Asteroid Belt Mining</h4>
              <p class="muted">Probes: <strong>${probeCount}</strong> available | Deployment Slots: <strong>${activeCount}/${maxDeployments}</strong></p>
              ${activeExpHtml}
              ${canLaunch ? `
                <div style="margin-top:0.75rem;">
                  <label class="muted" style="font-size:0.8rem;">Mission Duration</label>
                  <select id="expedition-duration" class="starmap-exp-select">
                    <option value="short">Short Sweep (30 min)</option>
                    <option value="standard" selected>Standard Survey (1 hr)</option>
                    <option value="extended">Deep Core Drill (2 hr)</option>
                  </select>
                  <button id="launch-expedition-btn" class="btn btn-accent" style="margin-top:0.5rem;">Launch Expedition (¤3,000)</button>
                </div>
              ` : !isBeltScouted
                ? `<p class="muted" style="margin-top:0.5rem;">Scout this asteroid belt before launching expeditions.</p>`
                : !inSameSystem
                ? `<p class="muted" style="margin-top:0.5rem;">You must be in this system to launch expeditions.</p>`
                : probeCount <= 0
                  ? `<p class="muted" style="margin-top:0.5rem;">No probes available. Fabricate probes at your Assembly Facility.</p>`
                  : `<p class="muted" style="margin-top:0.5rem;">All deployment slots occupied. Wait for a probe to return.</p>`
              }
            </div>
          `;
        }

        detailsEl.innerHTML = `
          <h3>${body.name} — ${system.name}</h3>
          <p class="muted">Type: Asteroid Belt</p>
          ${compositionHtml}
          ${miningHtml}
          ${stationListHtml}
        `;

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
        detailsEl.innerHTML = `
          <h3>${body.name} - ${system.name}</h3>
          <p class="muted">Type: ${body.type}</p>
          ${bodyResourceHtml(body, state.stations)}
          ${stationListHtml}
        `;
      }

      // Bind dock buttons in starmap details
      detailsEl.querySelectorAll(".starmap-dock-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const stationId = btn.getAttribute("data-station-id");
          if (stationId && onDockAtStation) {
            onDockAtStation(stationId);
          }
        });
      });
      // Bind travel-to-system buttons in starmap details
      detailsEl.querySelectorAll(".starmap-travel-system-btn").forEach((btn) => {
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
      const surveyed = (am.scoutedBelts || []).includes(beltKey) && (am.beltCompositions || {})[beltKey];
      const profile = surveyed
        ? Object.entries(surveyed).sort((x, y) => y[1] - x[1]).map(([name, pct]) => `${name} ${pct}%`).join(", ")
        : "Not surveyed (scout the belt)";
      const hasProspecting = state.unlockedTech.has("tt-asteroid-prospecting");
      detailsEl.innerHTML = `
        <h3>Asteroid Sample — ${body.name}</h3>
        <p class="muted">Catalog ID: ${asteroidId.split(":").slice(-1)[0]} | Belt composition: ${profile}</p>
        ${hasProspecting
          ? `<p class="muted" style="margin-top:0.5rem;">Use the belt-level view to launch mining expeditions to this asteroid field.</p>`
          : `<p class="muted" style="margin-top:0.5rem;">Research Asteroid Prospecting Arrays to unlock mining operations in this belt.</p>`
        }
      `;
    }
  }

  function renderFallback() {
    if (!fallbackEl) {
      return;
    }

    const rows = state.systems
      .map((system) => `<li><strong>${system.name}</strong> - ${(system.bodies || []).length} catalogued bodies.</li>`)
      .join("");

    fallbackEl.innerHTML = `
      <h3>Text-mode Starmap Summary</h3>
      <p class="muted">Graphical mode unavailable. Use list navigation to inspect systems and body counts.</p>
      <ul class="text-list">${rows}</ul>
    `;
  }

  function render() {
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

    const hit = state.clickTargets.find((target) => Math.hypot(target.x - x, target.y - y) <= target.radius);
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
    tooltip.className = "starmap-tooltip";
    tooltip.style.display = "none";
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
      tip.style.display = "block";
      tip.style.left = `${event.clientX + 12}px`;
      tip.style.top = `${event.clientY - 8}px`;
      canvas.style.cursor = "pointer";
    } else {
      tip.style.display = "none";
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

    const overlay = document.createElement("div");
    overlay.className = "starmap-modal-overlay";
    overlay.id = "starmap-station-modal";

    const buildingCount = station.buildings ? station.buildings.length : 0;
    const officeRent = station.officeRentPerCycle
      ? `¤${Number(station.officeRentPerCycle).toLocaleString()} / cycle`
      : "—";

    overlay.innerHTML = `
      <div class="starmap-modal-card">
        <button class="starmap-modal-close" aria-label="Close">&times;</button>
        <p class="overline starmap-modal-overline">${escapeHtmlAttr(station.designation || "")} // ${escapeHtmlAttr((station.systemId || "").toUpperCase())}</p>
        <h2 class="starmap-modal-title">${escapeHtmlAttr(station.name)}</h2>
        <p class="muted" style="margin-bottom:1rem;">${escapeHtmlAttr(station.body)} &mdash; ${escapeHtmlAttr(station.ownership || "NPC")}-controlled</p>

        <div class="starmap-modal-stats">
          <div class="starmap-modal-stat">
            <span class="starmap-modal-stat-label">Buildings</span>
            <span class="starmap-modal-stat-value">${buildingCount}</span>
          </div>
          <div class="starmap-modal-stat">
            <span class="starmap-modal-stat-label">Office Rent</span>
            <span class="starmap-modal-stat-value">${officeRent}</span>
          </div>
          <div class="starmap-modal-stat">
            <span class="starmap-modal-stat-label">Status</span>
            <span class="starmap-modal-stat-value">${isCurrent ? "Docked" : "Not docked"}</span>
          </div>
        </div>

        ${station.description ? `<p class="muted" style="margin-top:1rem;font-size:0.85rem;">${escapeHtmlAttr(station.description)}</p>` : ""}

        <div class="starmap-modal-actions">
          ${isCurrent
            ? `<span class="muted" style="font-size:0.85rem;">You are currently docked at this station.</span>`
            : !canTravelToSystem(station.systemId)
              ? `<span class="muted" style="font-size:0.85rem;color:rgba(255,180,60,0.85);">🔒 ${escapeHtmlAttr(travelLockText(station.systemId))}</span>`
            : (state.currentSystemId || "sol") === station.systemId
              ? `<button class="btn btn-accent starmap-modal-dock-btn" data-station-id="${escapeHtmlAttr(station.id)}">Dock at Station</button>`
              : `<span class="muted" style="font-size:0.85rem;">Jump to <strong>${escapeHtmlAttr(systemName(state.systems, station.systemId) || "its system")}</strong> from the system view, then dock here.</span>`
          }
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Bind close
    overlay.querySelector(".starmap-modal-close")?.addEventListener("click", closeStationModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeStationModal();
    });

    // Bind travel/dock
    const dockBtn = overlay.querySelector(".starmap-modal-dock-btn");
    if (dockBtn) {
      dockBtn.addEventListener("click", () => {
        const sid = dockBtn.getAttribute("data-station-id");
        if (sid && onDockAtStation) {
          closeStationModal();
          onDockAtStation(sid);
        }
      });
    }
    const systemBtn = overlay.querySelector(".starmap-modal-system-btn");
    if (systemBtn) {
      systemBtn.addEventListener("click", () => {
        const sysId = systemBtn.getAttribute("data-system-id");
        if (sysId && onTravelToSystem) {
          closeStationModal();
          onTravelToSystem(sysId);
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
      if (tooltip) tooltip.style.display = "none";
      canvas.style.cursor = "";
    });

    overlaySelect?.addEventListener("change", () => {
      state.overlay = overlaySelect.value;
      render();
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
    setOverlay(value) {
      state.overlay = value;
      render();
    },
    rerender() {
      render();
    },
    setUnlockedTech(techSet) {
      state.unlockedTech = techSet instanceof Set ? techSet : new Set(techSet || []);
    },
    setAsteroidMining(amState) {
      state.asteroidMining = amState || null;
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
      const cards = detailsEl.querySelectorAll(".starmap-expedition-card");
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
        const timeEl = card.querySelector("p.muted");
        if (timeEl) timeEl.textContent = `${exp.duration} expedition — ${mins}m ${secs}s remaining`;
      });
    },
    resize() {
      setCanvasSize();
      render();
    }
  };
}
