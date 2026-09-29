// AB#2475 (Board review item 22): how long it would take to finish every research item still outstanding, on Corporate
// R&D and CEO Insight. Pure, so a test reads it without a page.
//
// Both tracks run one item at a time: Corporate R&D's queue is a sequence (rndQueue.js, Bug #1258), and CEO Insight
// takes one program at a time (server/routes/research.js, "queue-full"). Prerequisites therefore never let two items
// run together, and the time to finish everything is the sum of what is left: the running item's remaining time, and
// every queued or unstarted item's full duration, whatever order the prerequisites impose. (A critical path would only
// be shorter if items could run in parallel; neither track allows it.) A CEO program with several levels counts each
// level it still has to run. A CEO program the catalog marks as planned (no effect yet, and refused by the server) is
// left out: it cannot be researched today.

const HOUR = 3_600_000;
const hoursOf = (item) => { const h = Number(item?.durationHours); return Number.isFinite(h) && h > 0 ? h : 0; };
/** What a queue item still has to run at `now`: its remaining time if running, its whole duration if not started. */
function leftOf(item, now) {
  const start = Number(item?.startedAt || 0);
  const whole = hoursOf(item) * HOUR;
  if (!start || start > now) return whole;
  return Math.max(0, start + whole - now);
}

/**
 * Corporate R&D: { ms, items } to finish every node not yet researched. `nodes` is the research tree, `done` the
 * corporation's unlocked tech ids, `queue` its R&D queue.
 */
export function researchRemaining({ nodes = [], done = [], queue = [] } = {}, now = Date.now()) {
  const finished = new Set(done);
  const inQueue = new Map((queue || []).filter((q) => q?.techId).map((q) => [q.techId, q]));
  let ms = 0, items = 0;
  for (const node of nodes || []) {
    if (!node?.id || finished.has(node.id)) continue;
    const q = inQueue.get(node.id);
    ms += q ? leftOf(q, now) : hoursOf(node) * HOUR;
    items += 1;
  }
  return { ms, items };
}

/**
 * CEO Insight: { ms, items } to finish every level of every program still to run. `programs` is the catalog,
 * `completed` the corporation's completed program ids (one per level done), `queue` its CEO queue, `isLive(program)`
 * whether the program can be researched today.
 */
export function insightRemaining({ programs = [], completed = [], queue = [], isLive = () => true } = {}, now = Date.now()) {
  let ms = 0, items = 0;
  for (const prog of programs || []) {
    if (!prog?.id || !isLive(prog)) continue;
    const levels = Math.max(1, Number(prog.maxLevels) || 1);
    const left = levels - (completed || []).filter((id) => id === prog.id).length;
    if (left <= 0) continue;
    const running = (queue || []).find((q) => q?.programId === prog.id);
    ms += running ? leftOf(running, now) + (left - 1) * hoursOf(prog) * HOUR : left * hoursOf(prog) * HOUR;
    items += left;
  }
  return { ms, items };
}

/** "18 d 4 h (436 h) to finish all 12 remaining technologies, one at a time.", or that nothing is left. */
export function totalText({ ms, items }, one = "item", many = "items") {
  if (!(items > 0)) return `nothing left: every ${one} is done.`;
  const mins = Math.ceil(ms / 60_000);
  const h = Math.floor(mins / 60), m = mins % 60, d = Math.floor(h / 24);
  const time = d ? `${d} d ${h % 24} h (${h} h)` : h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
  return `${time} to finish ${items === 1 ? `the 1 remaining ${one}` : `all ${items} remaining ${many}`}, one at a time.`;
}
