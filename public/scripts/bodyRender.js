// AB#742 (ISP-56): the bodies outside Sol are fictional, so no photograph exists (Sol's are AB#741). Each is drawn
// on the canvas from its `style` in data/systems.json: a lit base colour and a night side, a surface (bands, craters,
// clouds, ice or lava) in an accent colour, and an atmosphere rim. The features come from a generator seeded by the
// body's id, so a body looks the same on every load and on every player's screen. A body is painted once per size
// into an offscreen canvas and reused, so a frame costs one image draw per body.

export const SURFACES = ["bands", "craters", "clouds", "ice", "lava"];

/** A deterministic 32-bit hash of a string (FNV-1a). */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A seeded generator of numbers in [0, 1) (mulberry32): the same seed gives the same sequence everywhere. */
export function seededRandom(seedText) {
  let a = hash(String(seedText));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** True when `body` carries a style this module can draw (a Field is a belt, drawn elsewhere). */
export function isProcedural(body) {
  return Boolean(body?.style && SURFACES.includes(body.style.surface));
}

/** A crack that wanders: 4 to 6 short steps from a start point, each turning a little from the last. */
function jagged(rand, between) {
  let x = between(-0.6, 0.6);
  let y = between(-0.6, 0.6);
  let heading = rand() * Math.PI * 2;
  const points = [[x, y]];
  const steps = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < steps; i += 1) {
    heading += between(-0.9, 0.9);
    const step = between(0.08, 0.2);
    x = Math.max(-1, Math.min(1, x + Math.cos(heading) * step));
    y = Math.max(-1, Math.min(1, y + Math.sin(heading) * step));
    points.push([x, y]);
  }
  return points;
}

/**
 * The surface features of a body, in unit coordinates (the disc is the unit circle, y down), from its id alone.
 * Pure, so it is tested without a canvas: the same body gives the same list, and two bodies give different ones.
 */
export function bodyFeatures(body) {
  const rand = seededRandom(`${body.id}:${body.style?.surface}`);
  const between = (lo, hi) => lo + rand() * (hi - lo);
  switch (body.style?.surface) {
    case "bands": {
      const count = 5 + Math.floor(rand() * 4);
      return Array.from({ length: count }, (_, i) => ({
        kind: "band",
        y: -0.9 + ((i + 0.5) / count) * 1.8 + between(-0.06, 0.06),
        height: between(0.06, 0.2),
        alpha: between(0.18, 0.45)
      }));
    }
    case "craters":
      return Array.from({ length: 9 + Math.floor(rand() * 6) }, () => {
        const angle = rand() * Math.PI * 2;
        const dist = Math.sqrt(rand()) * 0.8;
        return { kind: "crater", x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, r: between(0.05, 0.2), alpha: between(0.3, 0.6) };
      });
    case "clouds":
      return Array.from({ length: 6 + Math.floor(rand() * 4) }, () => ({
        kind: "cloud",
        x: between(-0.8, 0.8),
        y: between(-0.75, 0.75),
        rx: between(0.25, 0.55),
        ry: between(0.06, 0.14),
        rotation: between(-0.35, 0.35),
        alpha: between(0.25, 0.55)
      }));
    case "ice":
      return Array.from({ length: 7 + Math.floor(rand() * 5) }, () => ({ kind: "crack", points: jagged(rand, between), alpha: between(0.3, 0.65) }));
    case "lava":
      return Array.from({ length: 5 + Math.floor(rand() * 4) }, () => ({ kind: "fissure", points: jagged(rand, between), glow: between(0.5, 1) }));
    default:
      return [];
  }
}

function paint(ctx, body, cx, cy, r) {
  const { base, shadow, accent } = body.style;
  const lit = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.05, cx, cy, r * 1.1);
  lit.addColorStop(0, base);
  lit.addColorStop(1, shadow);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = lit;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  for (const f of bodyFeatures(body)) {
    ctx.globalAlpha = f.alpha ?? 1;
    if (f.kind === "band") {
      ctx.fillStyle = accent;
      ctx.fillRect(cx - r, cy + (f.y - f.height / 2) * r, r * 2, f.height * r);
    } else if (f.kind === "crater") {
      ctx.beginPath();
      ctx.arc(cx + f.x * r, cy + f.y * r, f.r * r, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.strokeStyle = base;
      ctx.lineWidth = Math.max(0.5, f.r * r * 0.25);
      ctx.stroke();
    } else if (f.kind === "cloud") {
      ctx.beginPath();
      ctx.ellipse(cx + f.x * r, cy + f.y * r, f.rx * r, f.ry * r, f.rotation, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
    } else if (f.kind === "crack" || f.kind === "fissure") {
      ctx.globalAlpha = f.kind === "crack" ? f.alpha : f.glow;
      ctx.beginPath();
      f.points.forEach(([px, py], i) => (i ? ctx.lineTo(cx + px * r, cy + py * r) : ctx.moveTo(cx + px * r, cy + py * r)));
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(0.6, r * (f.kind === "crack" ? 0.03 : 0.05));
      if (f.kind === "fissure") {
        ctx.shadowColor = accent;
        ctx.shadowBlur = r * 0.15;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
  ctx.globalAlpha = 1;
  // The night side, so features read as lying on a sphere rather than on a flat disc.
  const night = ctx.createRadialGradient(cx - r * 0.45, cy - r * 0.45, r * 0.4, cx, cy, r * 1.25);
  night.addColorStop(0, "rgba(0, 0, 0, 0)");
  night.addColorStop(1, "rgba(0, 0, 0, 0.7)");
  ctx.fillStyle = night;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

const cache = new Map();

/** Draw `body` centred on (x, y) with `radius` in CSS pixels, from its style; the atmosphere rim is drawn outside. */
export function drawProceduralBody(ctx, body, x, y, radius) {
  const scale = Math.max(1, Math.min(2, ctx.getTransform?.()?.a || 1));
  const px = Math.max(2, Math.round(radius * scale));
  const key = `${body.id}|${px}`;
  let sprite = cache.get(key);
  if (!sprite && typeof document !== "undefined") {
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = px * 2 + 2;
    const sctx = sprite.getContext("2d");
    if (sctx) {
      paint(sctx, body, px + 1, px + 1, px);
      cache.set(key, sprite);
    } else {
      sprite = null;
    }
  }
  if (sprite) {
    ctx.drawImage(sprite, x - radius - 1 / scale, y - radius - 1 / scale, (px * 2 + 2) / scale, (px * 2 + 2) / scale);
  } else {
    paint(ctx, body, x, y, radius);
  }

  const rim = ctx.createRadialGradient(x, y, radius, x, y, radius + Math.max(3, radius * 0.18));
  rim.addColorStop(0, body.style.glow);
  rim.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(x, y, radius + Math.max(3, radius * 0.18), 0, Math.PI * 2);
  ctx.fill();
}
