/**
 * Starfield canvas — lightweight animated cosmic background.
 * Two star layers at different speeds for a subtle parallax feel.
 * AB#1453: at most 5 frames a second, not every animation frame. The drift is under 1.5px a second, so 5 frames
 * (a third of a pixel a step) look the same as 60, and the movement is scaled by the time elapsed, so the stars keep
 * the speed they had at 60. Each frame costs more than its own drawing: every blurred panel above the canvas is
 * recomposited.
 *
 * AB#1760: loaded as a module so it can ask motion.js whether the player wants reduced motion. If so, the stars are
 * drawn once, still, and redrawn only when the window is resized.
 *
 * AB#964 (ISP-268): the loop stops outright while the tab is hidden, not only when the browser withholds frames: its
 * 5-a-second timer kept waking a hidden tab. It starts again when the tab is shown, and a change to the reduced-motion
 * setting applies at once. createStarfield takes its window and document so a test can drive it.
 */
import { REDUCED_MOTION_QUERY, prefersReducedMotion } from "./motion.js";

const STAR_COUNT = 260;
const FRAME_MS = 1000 / 5;
const STEP_MS = 1000 / 60; // the speeds below are per 60th of a second
const LAYERS = [
  { speed: 0.012, radiusMax: 1.1, opacity: 0.55 }, // far stars
  { speed: 0.022, radiusMax: 1.6, opacity: 0.80 }, // near stars
];

/** Draw the starfield on `canvas` and keep it moving while it may. Returns { running(), sync(), stop() }. */
export function createStarfield(canvas, { win = globalThis.window, doc = globalThis.document } = {}) {
  const ctx = canvas.getContext("2d");
  let W, H, stars;
  let timer = null, frame = null, last = 0;

  function randomStar(layer) {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * layer.radiusMax + 0.3,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.004 + Math.random() * 0.008,
      speed: layer.speed,
      opacity: layer.opacity,
    };
  }

  function buildStars() {
    stars = [];
    LAYERS.forEach((layer) => {
      const count = Math.round(STAR_COUNT / LAYERS.length);
      for (let i = 0; i < count; i++) {
        stars.push(randomStar(layer));
      }
    });
  }

  /** Draw every star once; `steps` (60ths of a second, 0 for none) advances the drift and the twinkle first. */
  function paint(steps) {
    ctx.clearRect(0, 0, W, H);

    for (const s of stars) {
      if (steps) {
        s.twinkle += s.twinkleSpeed * steps;
        // Very slow vertical drift
        s.y -= s.speed * steps;
        if (s.y < -2) {
          s.y = H + 2;
          s.x = Math.random() * W;
        }
      }

      const alpha = s.opacity * (0.65 + 0.35 * Math.sin(s.twinkle));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200, 230, 255, ${alpha.toFixed(2)})`;
      ctx.fill();
    }
  }

  const mayMove = () => !doc?.hidden && !prefersReducedMotion(win);

  function draw(now) {
    frame = null;
    if (!mayMove()) { sync(); return; }
    // A long gap moves the stars at most a sixth of a second, never a jump.
    paint(last ? Math.min((now - last) / STEP_MS, 10) : 1);
    last = now;
    timer = win.setTimeout(() => { timer = null; frame = win.requestAnimationFrame(draw); }, FRAME_MS);
  }

  function stop() {
    if (timer !== null) win.clearTimeout(timer);
    if (frame !== null) win.cancelAnimationFrame(frame);
    timer = frame = null;
  }

  /** Start the loop if it may run and is not running; otherwise stop it (and, under reduced motion, draw it still). */
  function sync() {
    if (mayMove()) {
      if (timer === null && frame === null) { last = 0; frame = win.requestAnimationFrame(draw); }
      return;
    }
    stop();
    if (!doc?.hidden) paint(0); // reduced motion: the field, still
  }

  function resize() {
    W = canvas.width = win.innerWidth;
    H = canvas.height = win.innerHeight;
    buildStars();
    if (!mayMove() && !doc?.hidden) paint(0);
  }

  win.addEventListener("resize", resize, { passive: true });
  doc?.addEventListener?.("visibilitychange", sync);
  win.matchMedia?.(REDUCED_MOTION_QUERY)?.addEventListener?.("change", sync);
  resize();
  sync();
  return { running: () => timer !== null || frame !== null, sync, stop };
}

const canvas = globalThis.document?.getElementById("starfield-canvas");
if (canvas) createStarfield(canvas);
