const CLUSTER_LAYOUT = {
  sol: { x: 0.16, y: 0.5 },
  "alpha-centauri": { x: 0.35, y: 0.26 },
  "barnards-star": { x: 0.34, y: 0.72 },
  "wolf-359": { x: 0.56, y: 0.35 },
  "tau-ceti": { x: 0.72, y: 0.55 },
  "epsilon-eridani": { x: 0.83, y: 0.3 }
};

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

function generatedComposition(body) {
  const seed = hashSeed(body.id);
  const entries = [
    { name: "Silicates", pct: 20 + (seed % 25) },
    { name: "Nickel", pct: 8 + ((seed >> 2) % 18) },
    { name: "Titanium", pct: 6 + ((seed >> 3) % 16) },
    { name: "Water Ice", pct: 5 + ((seed >> 4) % 28) },
    { name: "Helium-3", pct: 2 + ((seed >> 5) % 10) }
  ];

  const sum = entries.reduce((acc, item) => acc + item.pct, 0);
  return entries.map((item) => ({
    name: item.name,
    pct: Math.round((item.pct / sum) * 100)
  }));
}

function styleForBody(body) {
  return PLANET_STYLE[body.id] || FALLBACK_PLANET_STYLE;
}

// ─── Planet image assets ─────────────────────────────────────────────────────
const PLANET_IMAGES = {};
const PLANET_IMAGE_PATHS = {
  earth: "/images/planets/earth.png",
  mars: "/images/planets/mars.png",
  luna: "/images/planets/moon.png"
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

    // Glow ring
    ctx.beginPath();
    ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
    ctx.strokeStyle = style.glow;
    ctx.stroke();

    // Saturn rings
    if (body.id === "saturn") {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.28);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 1.75, radius * 0.68, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(220, 200, 140, 0.7)";
      ctx.lineWidth = 1.4;
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

  ctx.beginPath();
  ctx.arc(x - radius * 0.32, y - radius * 0.28, radius * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
  ctx.strokeStyle = style.glow;
  ctx.stroke();

  if (body.id === "saturn") {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.28);
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.75, radius * 0.68, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(220, 200, 140, 0.7)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }
}

function drawAsteroidBelt(ctx, cx, cy, radius) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(155, 185, 205, 0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();

  for (let i = 0; i < 120; i += 1) {
    const t = (i / 120) * Math.PI * 2;
    const jitter = ((i * 37) % 13) - 6;
    const r = radius + jitter;
    const x = cx + Math.cos(t) * r;
    const y = cy + Math.sin(t) * r;
    const s = (i % 3) + 1;
    ctx.fillStyle = i % 7 === 0 ? "rgba(190, 210, 230, 0.72)" : "rgba(145, 170, 195, 0.58)";
    ctx.fillRect(x, y, s, s);
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

function asteroidComposition(seedKey) {
  const seed = hashSeed(seedKey);
  const profiles = [
    "Silicate-rich",
    "Nickel-iron",
    "Carbonaceous",
    "Volatile-rich",
    "Mixed ore"
  ];
  return profiles[seed % profiles.length];
}

export function createStarmapController({
  canvas,
  fallbackEl,
  detailsEl,
  overlaySelect,
  resetButton,
  onScoutBody,
  isBodyScouted,
  onTravelToStation
}) {
  const ctx = canvas?.getContext?.("2d");
  const state = {
    systems: [],
    stations: [],
    currentStationId: null,
    overlay: "none",
    view: "cluster",
    selectedSystemId: null,
    selectedBodyId: null,
    selectedAsteroidId: null,
    clickTargets: []
  };

  function setCanvasSize() {
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(500, Math.floor(rect.width));
    const availableHeight = Math.max(320, Math.floor(window.innerHeight - rect.top - 34));
    const targetHeight = Math.min(560, availableHeight);

    canvas.style.height = `${targetHeight}px`;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(targetHeight * dpr);
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function clearScene() {
    if (!ctx || !canvas) {
      return;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#030712";
    ctx.fillRect(0, 0, width, height);

    const nebulaA = ctx.createRadialGradient(width * 0.12, height * 0.2, 10, width * 0.12, height * 0.2, width * 0.45);
    nebulaA.addColorStop(0, "rgba(0, 247, 255, 0.1)");
    nebulaA.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = nebulaA;
    ctx.fillRect(0, 0, width, height);

    const nebulaB = ctx.createRadialGradient(width * 0.8, height * 0.75, 10, width * 0.8, height * 0.75, width * 0.4);
    nebulaB.addColorStop(0, "rgba(255, 170, 51, 0.08)");
    nebulaB.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = nebulaB;
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < 220; i += 1) {
      const x = (i * 79) % width;
      const y = (i * 113) % height;
      ctx.fillStyle = `rgba(210, 235, 255, ${(i % 8) / 20 + 0.1})`;
      ctx.fillRect(x, y, 1.3, 1.3);
    }
  }

  function drawClusterView() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    state.clickTargets = [];

    ctx.strokeStyle = "rgba(120, 180, 220, 0.2)";
    ctx.lineWidth = 1;

    for (let i = 0; i < state.systems.length; i += 1) {
      for (let j = i + 1; j < state.systems.length; j += 1) {
        const a = CLUSTER_LAYOUT[state.systems[i].id];
        const b = CLUSTER_LAYOUT[state.systems[j].id];
        if (!a || !b) {
          continue;
        }

        const ax = a.x * width;
        const ay = a.y * height;
        const bx = b.x * width;
        const by = b.y * height;
        const d = Math.hypot(ax - bx, ay - by);
        if (d < width * 0.42) {
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }
    }

    state.systems.forEach((system) => {
      const p = CLUSTER_LAYOUT[system.id] || { x: 0.5, y: 0.5 };
      const x = p.x * width;
      const y = p.y * height;
      const radius = state.selectedSystemId === system.id ? 10 : 8;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = overlayColor(system, state.overlay);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0, 247, 255, 0.3)";
      ctx.stroke();

      ctx.fillStyle = "rgba(216, 235, 245, 0.95)";
      ctx.font = "12px Inter";
      ctx.fillText(system.name, x + 14, y - 4);

      state.clickTargets.push({
        type: "system",
        systemId: system.id,
        x,
        y,
        radius: radius + 8
      });
    });

    renderDetails();
  }

  function drawBackButton(label = "Back", x = 88, y = 36) {
    const paddingX = 12;
    const height = 30;
    const textWidth = ctx.measureText(label).width;
    const width = Math.max(88, Math.ceil(textWidth + paddingX * 2));

    ctx.fillStyle = "rgba(17, 34, 51, 0.92)";
    ctx.strokeStyle = "rgba(0, 247, 255, 0.42)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - height / 2, width, height, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(216, 235, 245, 0.94)";
    ctx.font = "11px Inter";
    ctx.fillText(label, x - textWidth / 2, y + 4);

    return width;
  }

  function drawStationMarker(x, y, isCurrent) {
    const size = 4;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = isCurrent ? "rgba(0, 247, 255, 0.95)" : "rgba(255, 210, 80, 0.85)";
    ctx.fillRect(-size, -size, size * 2, size * 2);
    ctx.strokeStyle = isCurrent ? "rgba(0, 247, 255, 0.5)" : "rgba(255, 210, 80, 0.4)";
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
    const cx = width / 2;
    const cy = height / 2;

    state.clickTargets = [];

    const backWidth = drawBackButton("Back To Cluster", 102, 36);
    state.clickTargets.push({
      type: "back",
      x: 102,
      y: 36,
      radius: Math.max(36, backWidth * 0.55)
    });

    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 170, 51, 0.92)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 170, 51, 0.35)";
    ctx.stroke();

    const bodies = (system?.bodies || []).filter((body) => body.type === "Planet" || body.type === "Field");
    const moons = (system?.bodies || []).filter((body) => body.type === "Moon");
    const bodyPositions = new Map();
    const maxOrbitX = Math.max(1, ...bodies.map((body) => Number(body.x || 0)));
    const orbitLimit = Math.min(width, height) * 0.42;

    bodies.forEach((body, index) => {
      const orbit = ((Number(body.x || 0) / maxOrbitX) * orbitLimit) + 56;
      const angle = (index / Math.max(1, bodies.length)) * Math.PI * 2;
      const x = cx + Math.cos(angle) * orbit;
      const y = cy + Math.sin(angle) * orbit;

      ctx.beginPath();
      ctx.arc(cx, cy, orbit, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(120, 180, 220, 0.14)";
      ctx.lineWidth = 1;
      ctx.stroke();

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

      bodyPositions.set(body.id, { x, y, radius: Math.max(4, body.radius) });

      ctx.fillStyle = "rgba(216, 235, 245, 0.92)";
      ctx.font = "11px Inter";
      ctx.fillText(body.name, x + 8, y - 4);

      state.clickTargets.push({
        type: "body",
        systemId: system.id,
        bodyId: body.id,
        x,
        y,
        radius: Math.max(10, body.radius + 8)
      });
    });

    moons.forEach((moon, idx) => {
      const parent = bodyPositions.get(moon.parentId);
      if (!parent) {
        return;
      }

      const moonOrbit = parent.radius + 16 + (idx % 3) * 9;
      const angle = ((idx * 97) % 360) * (Math.PI / 180);
      const x = parent.x + Math.cos(angle) * moonOrbit;
      const y = parent.y + Math.sin(angle) * moonOrbit;
      const moonRadius = Math.max(2, moon.radius || 2);

      ctx.beginPath();
      ctx.arc(parent.x, parent.y, moonOrbit, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(120, 180, 220, 0.11)";
      ctx.stroke();

      const moonImg = PLANET_IMAGES[moon.id];
      if (moonImg && moonImg.complete && moonImg.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, moonRadius, 0, Math.PI * 2);
        ctx.clip();
        const miw = moonImg.naturalWidth;
        const mih = moonImg.naturalHeight;
        const md = moonRadius * 2;
        const ms = Math.max(md / miw, md / mih);
        const mdw = miw * ms;
        const mdh = mih * ms;
        ctx.drawImage(moonImg, x - mdw / 2, y - mdh / 2, mdw, mdh);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, moonRadius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(158, 194, 224, 0.95)";
        ctx.fill();
      }

      ctx.fillStyle = "rgba(216, 235, 245, 0.9)";
      ctx.font = "10px Inter";
      ctx.fillText(moon.name, x + 6, y - 4);

      state.clickTargets.push({
        type: "body",
        systemId: system.id,
        bodyId: moon.id,
        x,
        y,
        radius: Math.max(8, moonRadius + 6)
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
    const backClusterWidth = drawBackButton("Back To Cluster", 250, 36);

    state.clickTargets.push({ type: "back-to-system", x: 108, y: 36, radius: Math.max(40, backSysWidth * 0.55) });
    state.clickTargets.push({ type: "back-to-cluster", x: 250, y: 36, radius: Math.max(42, backClusterWidth * 0.55) });

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
    const backSystemWidth = drawBackButton("Back To System", 228, 36);

    state.clickTargets.push({ type: "back-to-body", x: 98, y: 36, radius: Math.max(38, backBodyWidth * 0.55) });
    state.clickTargets.push({ type: "back-to-system", x: 228, y: 36, radius: Math.max(38, backSystemWidth * 0.55) });

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
      detailsEl.innerHTML = `
        <h3>${system.name}</h3>
        <p class="muted">GDP ${system.gdpIndex} | Activity ${system.activityLevel} | Pirates ${system.pirateDensity}</p>
        <p>${system.ownerRule || "Ownership available via territorial dominance and treaties."}</p>
        <ul class="text-list">${bodyLines}</ul>
      `;
      return;
    }

    if (state.view === "body" && system && body) {
      const scouted = isBodyScouted ? Boolean(isBodyScouted(system.id, body.id)) : false;
      const composition = generatedComposition(body)
        .map((part) => `<li>${part.name}: ${part.pct}%</li>`)
        .join("");

      // Find stations orbiting this body
      const bodyStations = state.stations.filter(
        (s) => s.systemId === system.id && s.body === body.name
      );
      const stationListHtml = bodyStations.length
        ? `<h4 style="margin-top:1rem;">Stations</h4><ul class="text-list">${bodyStations.map((s) => {
            const isCurrent = s.id === state.currentStationId;
            const dockLabel = isCurrent
              ? `<span style="color:rgba(0,247,255,0.85);font-size:0.8rem;margin-left:0.4rem;">[DOCKED]</span>`
              : onTravelToStation
                ? `<button class="btn btn-outline starmap-travel-btn" data-station-id="${s.id}" style="margin-left:0.5rem;font-size:0.75rem;padding:0.15em 0.5em;">Travel</button>`
                : "";
            return `<li><strong>${s.name}</strong> <span style="opacity:0.6;">${s.designation}</span>${dockLabel}</li>`;
          }).join("")}</ul>`
        : "";

      detailsEl.innerHTML = `
        <h3>${body.name} - ${system.name}</h3>
        <p class="muted">Type: ${body.type} | Scouting Status: ${scouted ? "Completed" : "Unscouted"}</p>
        ${
          scouted
            ? `<ul class="text-list">${composition}</ul>`
            : `<p class="muted">Resource composition is unknown. You must scout this body first.</p>
               <button id="scout-body-btn" class="btn btn-accent">Scout Body</button>`
        }
        ${stationListHtml}
      `;

      if (!scouted) {
        const scoutButton = detailsEl.querySelector("#scout-body-btn");
        scoutButton?.addEventListener("click", () => {
          if (onScoutBody) {
            onScoutBody(system.id, body.id);
          }
          render();
        });
      }

      // Bind travel buttons in starmap details
      detailsEl.querySelectorAll(".starmap-travel-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const stationId = btn.getAttribute("data-station-id");
          if (stationId && onTravelToStation) {
            onTravelToStation(stationId);
          }
        });
      });
    }

    if (state.view === "asteroid" && system && body) {
      const asteroidId = state.selectedAsteroidId || `${system.id}:${body.id}:ast-0`;
      const profile = asteroidComposition(asteroidId);
      detailsEl.innerHTML = `
        <h3>Asteroid Sample - ${body.name}</h3>
        <p class="muted">Catalog ID: ${asteroidId.split(":").slice(-1)[0]} | Composition class: ${profile}</p>
        <p class="muted">Detailed yield simulation and claim mechanics can be added to this body-level asteroid selector.</p>
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
    if (!ctx || !canvas || canvas.hidden) {
      renderFallback();
      return;
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
            : onTravelToStation
              ? `<button class="btn btn-accent starmap-modal-travel-btn" data-station-id="${escapeHtmlAttr(station.id)}">Undock &amp; Travel Here</button>`
              : ""
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

    // Bind travel
    const travelBtn = overlay.querySelector(".starmap-modal-travel-btn");
    if (travelBtn) {
      travelBtn.addEventListener("click", () => {
        const sid = travelBtn.getAttribute("data-station-id");
        if (sid && onTravelToStation) {
          closeStationModal();
          onTravelToStation(sid);
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
    setStations(nextStations, currentStationId) {
      state.stations = nextStations || [];
      state.currentStationId = currentStationId || null;
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
    resize() {
      setCanvasSize();
      render();
    }
  };
}
