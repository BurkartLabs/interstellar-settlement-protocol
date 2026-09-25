// public/scripts/motion.js
// AB#1760 (ISP-291): one answer to "has the player asked for less motion?". The stylesheet's
// @media (prefers-reduced-motion: reduce) block stops every CSS animation and transition; this module covers the
// motion CSS cannot reach, which is driven from script: the dialogue typewriter, the starfield background, and smooth
// scrolling. Pure, no DOM of its own: pass a window (or anything with matchMedia) to test it.

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** True when the player's system asks for reduced motion. Read at the moment of use, so a change applies next time. */
export function prefersReducedMotion(win = globalThis) {
  try {
    return Boolean(win?.matchMedia?.(REDUCED_MOTION_QUERY)?.matches);
  } catch {
    return false;
  }
}

/** The scroll behavior to ask for: "auto" (a jump) under reduced motion, otherwise "smooth". */
export function scrollBehavior(win = globalThis) {
  return prefersReducedMotion(win) ? "auto" : "smooth";
}
