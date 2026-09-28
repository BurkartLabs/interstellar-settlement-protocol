// AB#2477 (Board review item 24): draws the research prerequisites as a connected tree, on Corporate R&D and CEO
// Insight, after the Starmap's own node display: a glowing dot per node, lanes between them, the selected node named
// and its chain lit. The layout is ../prereqGraph.js (pure, unit-tested).
//
// Where each row is wide enough, every node is named under its dot. Where it is not (a phone), only the selected node
// is, as the Starmap names only the selected system and its neighbours on a phone; the line under the tree names what
// the selected node is still waiting on in words, at every width. Tap or click a node to select it.
//
// The drawing depends on the container's width, so it is drawn again when that changes (a hidden tab has none until
// it is opened).

import { escapeHtml } from "../html.js";
import { layoutPrereqs, prereqChain, waitingOn } from "../prereqGraph.js";

const PAD = 18;          // above the first row and below the last
const DOT = 14;          // the dot's diameter
const LABELLED_ROW = 92; // a row's height when every node is named: the dot, two lines of name, and room for the lanes
const COMPACT_ROW = 60;  // and when only the selected node is
const UNDER_NAME = 50;   // from a dot's centre to the foot of two lines of name: where its lanes leave
const MIN_SLOT = 86;     // the narrowest a node's share of a row can be for its name to fit under it
const LABEL_MAX = 150;
const STATE_WORD = { done: "researched", queued: "in the queue", available: "ready to start", locked: "locked", planned: "planned" };

const selected = new Map(); // graph key → the selected node's id, for this page view

/**
 * Draws `model` into `el`: { key, nodes: [{ id, name, prereqs, state, met, lock? }], empty }. `state` is one of
 * done | queued | available | locked | planned; `met` whether it counts as met for what depends on it; `lock` a
 * reason it is locked other than its prerequisites (a corporation level).
 */
export function renderPrereqGraph(el, model) {
  if (!el) return;
  el._prereqModel = model;
  if (!el._prereqBound) {
    el._prereqBound = true;
    el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-prereq-id]");
      if (!btn || !el._prereqModel) return;
      selected.set(el._prereqModel.key, btn.getAttribute("data-prereq-id"));
      draw(el, btn.getAttribute("data-prereq-id"));
    });
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => { if (el.clientWidth !== el._prereqWidth) draw(el); }).observe(el);
    }
  }
  draw(el);
}

function defaultSelection(nodes) {
  return (nodes.find((n) => n.state === "locked") || nodes.find((n) => n.state !== "done") || nodes[0])?.id;
}

function draw(el, focusId) {
  const model = el._prereqModel;
  el._prereqWidth = el.clientWidth;
  if (!model || !el.clientWidth) return;
  const style = getComputedStyle(el); // the tree fills the content box: the panel body's padding is not the tree's
  const width = Math.floor(el.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0));
  const nodes = model.nodes || [];
  if (!nodes.length) {
    el.innerHTML = `<p class="ui-state__title">${escapeHtml(model.empty || "Nothing to show.")}</p>`;
    return;
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let sel = selected.get(model.key);
  if (!byId.has(sel)) sel = defaultSelection(nodes);
  const chain = prereqChain(sel, nodes);
  const lit = new Set([sel, ...chain]);

  const { rows } = layoutPrereqs(nodes);
  const widest = Math.max(...rows.map((r) => r.length));
  const labelled = width / widest >= MIN_SLOT;
  const rowH = labelled ? LABELLED_ROW : COMPACT_ROW;
  const height = PAD + (rows.length - 1) * rowH + DOT / 2 + UNDER_NAME + PAD / 2;
  const pos = new Map();
  rows.forEach((row, r) => row.forEach((id, i) => pos.set(id, { x: ((i + 0.5) / row.length) * width, y: PAD + r * rowH + DOT / 2, slot: width / row.length })));

  // a lane leaves under the prerequisite's name (or dot) and arrives at the top of the dependent's dot
  const below = labelled ? UNDER_NAME : DOT / 2 + 3;
  const lanes = [];
  for (const n of nodes) {
    for (const p of n.prereqs || []) {
      if (!byId.has(p)) continue;
      const a = pos.get(p), b = pos.get(n.id);
      const y1 = a.y + below, y2 = b.y - DOT / 2 - 2, mid = (y1 + y2) / 2;
      const met = byId.get(p).met;
      const onChain = lit.has(n.id) && lit.has(p);
      const cls = `prereq-lane prereq-lane--${met ? "met" : "waiting"}${onChain ? " prereq-lane--chain" : ""}`;
      lanes.push({ onChain, svg: `<path class="${cls}" d="M${a.x.toFixed(1)} ${y1.toFixed(1)} C${a.x.toFixed(1)} ${mid.toFixed(1)} ${b.x.toFixed(1)} ${mid.toFixed(1)} ${b.x.toFixed(1)} ${y2.toFixed(1)}"/>` });
    }
  }
  lanes.sort((l, m) => Number(l.onChain) - Number(m.onChain)); // the lit chain is drawn last, on top

  const buttons = nodes.map((n) => {
    const { x, y, slot } = pos.get(n.id);
    const isSel = n.id === sel;
    const named = labelled || isSel;
    const labelW = Math.min(LABEL_MAX, labelled ? slot - 6 : LABEL_MAX);
    // keep a name inside the tree: shift it off an edge
    const shift = named ? Math.min(Math.max(x, labelW / 2), width - labelW / 2) - x : 0;
    const cls = ["prereq-node", `prereq-node--${n.state}`, isSel ? "prereq-node--selected" : "", lit.has(n.id) ? "prereq-node--lit" : ""].filter(Boolean).join(" ");
    const label = `${n.name}: ${STATE_WORD[n.state] || n.state}`;
    return `<button type="button" class="${cls}" data-prereq-id="${escapeHtml(n.id)}" aria-pressed="${isSel}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">
      <span class="prereq-node__dot" aria-hidden="true"></span>${named ? `<span class="prereq-node__name" aria-hidden="true" style="width:${labelW.toFixed(0)}px;margin-left:${(shift - labelW / 2).toFixed(1)}px">${escapeHtml(n.name)}</span>` : ""}
    </button>`;
  }).join("");

  el.innerHTML = `<div class="prereq-graph__map${labelled ? "" : " prereq-graph__map--compact"}" style="height:${height.toFixed(0)}px">
      <svg class="prereq-graph__lanes" width="${width}" height="${height.toFixed(0)}" viewBox="0 0 ${width} ${height.toFixed(0)}" aria-hidden="true" focusable="false">${lanes.map((l) => l.svg).join("")}</svg>
      ${buttons}
    </div>
    <p class="prereq-graph__detail" role="status">${detailHtml(byId.get(sel), nodes)}</p>
    <ul class="prereq-graph__legend" aria-label="Key">
      ${["done", "queued", "available", "locked", "planned"].filter((s) => nodes.some((n) => n.state === s)).map((s) => `<li><span class="prereq-node prereq-node--${s} prereq-graph__key" aria-hidden="true"><span class="prereq-node__dot"></span></span>${escapeHtml(STATE_WORD[s])}</li>`).join("")}
    </ul>`;
  if (focusId) el.querySelector(`[data-prereq-id="${CSS.escape(focusId)}"]`)?.focus();
}

/** The selected node, and what it is still waiting on, in words. */
export function detailHtml(node, nodes) {
  if (!node) return "";
  const name = `<strong>${escapeHtml(node.name)}</strong>`;
  const names = (ids) => ids.map((id) => escapeHtml(nodes.find((n) => n.id === id)?.name || id)).join(", ");
  if (node.state === "done") return `${name}: researched.`;
  if (node.state === "planned") return `${name}: planned for a later version; it cannot be researched yet.`;
  const { waiting, next: ready } = waitingOn(node.id, nodes);
  const stateOf = (id) => nodes.find((n) => n.id === id)?.state;
  const queued = ready.filter((id) => stateOf(id) === "queued");
  const next = ready.filter((id) => stateOf(id) === "available");
  if (!waiting.length) {
    if (node.state === "queued") return `${name}: in the queue. Every prerequisite is met.`;
    if (node.lock) return `${name}: every prerequisite is met. ${escapeHtml(node.lock)}.`;
    return `${name}: every prerequisite is met; ready to start.`;
  }
  const blocked = waiting.some((id) => nodes.find((n) => n.id === id)?.state === "planned");
  return `${name} is waiting on ${waiting.length} ${waiting.length === 1 ? "prerequisite" : "prerequisites"}: ${names(waiting)}.`
    + (queued.length ? ` In the queue: ${names(queued)}.` : "")
    + (next.length ? ` Start with ${names(next)}.` : "")
    + (blocked ? " Part of its chain is planned for a later version." : "");
}
