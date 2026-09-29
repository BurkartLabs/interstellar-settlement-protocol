// The first thing to do, on screen (AB#1056).
//
// A new player's next action sat below the fold on the Station and Overview, and at phone width a tab tap changed a
// panel nobody could see. These are the decisions; app.js only applies them. Panel widths at 375px are AB#1055's.

/** Widths at or below this are phone layouts: the sidebar starts collapsed and a chosen panel is scrolled to. */
export const NARROW_MAX_WIDTH = 767;

/** Whether the Overview shows the next milestones above the stat cards: while the corporation is finding its feet. */
export function milestonesFirst(level) {
  return Number(level || 0) <= 2;
}

/** Whether the sidebar (identity, quick actions) starts collapsed at this viewport width. */
export function sidebarStartsCollapsed(width) {
  return Number(width) <= NARROW_MAX_WIDTH;
}

/** Gap left between the pinned header and whatever is scrolled to sit under it. */
const REVEAL_GAP = 8;

/**
 * How far to scroll (px, negative is up) so that something whose top is at `top` sits just under the pinned header
 * whose bottom is at `headerBottom`; 0 when it is already in the upper two thirds of the band below the header.
 * The header is pinned (position: sticky), so the top of the viewport is not the top of what a player can see: an
 * element scrolled to the very top sits behind it.
 */
export function revealScroll(top, headerBottom, viewportHeight) {
  const bandTop = Math.max(0, headerBottom);
  const visible = top >= bandTop && top <= bandTop + (viewportHeight - bandTop) * 0.66;
  return visible ? 0 : top - bandTop - REVEAL_GAP;
}
