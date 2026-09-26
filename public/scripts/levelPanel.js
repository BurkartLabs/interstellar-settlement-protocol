// ISP-111 (AB#803): what the Overview's level panel shows. The corporation's level out of the highest level the data
// defines (never a literal), and one level at a time: by default the next one, with every requirement's progress from
// the server's levelProgress and what reaching it unlocks; any other level is a step away, so the panel never renders
// all of them at once. Pure: it loads in node and the browser.

/**
 * @param {object} args
 * @param {number} args.level the corporation's level
 * @param {number} [args.levelCap] the highest level the server's data defines (corp.levelCap)
 * @param {object} [args.levelProgress] corp.levelProgress: { levelN: { requirements: [{ id, title, progress, target, complete }], allCompleted } }
 * @param {{ level: number, unlocks: { key: string, label: string, value: string }[] }[]} [args.ladder] GET /api/bootstrap's levelLadder
 * @param {number|null} [args.browse] the level asked for, or null for the default
 */
export function levelPanelView({ level, levelCap, levelProgress, ladder, browse = null }) {
  const current = Math.max(0, Math.floor(Number(level) || 0));
  const levels = Array.isArray(ladder) ? ladder : [];
  const max = Number(levelCap) > 0 ? Number(levelCap) : levels.reduce((top, l) => Math.max(top, Number(l.level) || 0), 0);
  const atTop = max > 0 && current >= max;
  const fallback = atTop ? max : current + 1;
  const asked = Number.isInteger(browse) ? browse : fallback;
  const shown = max > 0 ? Math.min(Math.max(1, asked), max) : fallback;
  const state = shown <= current ? "reached" : shown === current + 1 ? "next" : "ahead";
  const requirements = levelProgress?.[`level${shown}`]?.requirements || [];
  const unlocks = levels.find((l) => Number(l.level) === shown)?.unlocks || [];
  return {
    level: current,
    max,
    atTop,
    shown,
    state,
    requirements,
    unlocks,
    isDefault: shown === fallback,
    prev: shown > 1 ? shown - 1 : null,
    next: max > 0 && shown < max ? shown + 1 : null
  };
}
