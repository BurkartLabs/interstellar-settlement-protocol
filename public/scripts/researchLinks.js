// ISP-191 (AB#885): research named on another screen is a link to its card on the Corporate R&D tab, and a resource
// that is dug but not recovered without research (data/research.json `recovers`, AB#880) says so wherever an
// extraction offers it: the Starmap's body and belt panels. The tree is GET /api/research (appState's techTree).

import { escapeHtml } from "./html.js";

/** The id of a node's card on the R&D tab. */
export const researchNodeId = (id) => `research-node-${id}`;

/** A link to a research node's card, named as the tree names it. */
export function researchLinkHtml(id, tree = []) {
  const name = tree.find((node) => node.id === id)?.name || id;
  return `<a class="refinery__link" href="#${escapeHtml(researchNodeId(id))}" data-research-link="${escapeHtml(id)}">${escapeHtml(name)}</a>`;
}

/** Each research-gated item and the node that recovers it. */
export function itemGates(tree = []) {
  const gates = new Map();
  for (const node of tree) for (const item of node.recovers || []) gates.set(item, node.id);
  return gates;
}

/**
 * The line an extraction panel shows under what it yields: each of `items` that this corporation would dig and not
 * recover, with a link to the research it needs. "" when there is none.
 */
export function unrecoveredItemsHtml(items, tree = [], unlockedTech = new Set()) {
  const gates = itemGates(tree);
  const lacking = [...new Set(items)].filter((item) => gates.has(item) && !unlockedTech.has(gates.get(item)));
  if (!lacking.length) return "";
  const parts = lacking.map((item) => `${escapeHtml(item)} needs ${researchLinkHtml(gates.get(item), tree)}`);
  return `<p class="ui-panel__meta" data-unrecovered>Not recovered until researched: ${parts.join("; ")}. Without it, that share is dug and lost.</p>`;
}

/**
 * Follow a research link from anywhere: open the R&D tab and bring the node's card on screen. Installed once, on the
 * document, so a link drawn after this runs still works.
 */
export function bindResearchLinks(setTab, doc = document) {
  doc.addEventListener("click", (event) => {
    const link = event.target.closest?.("[data-research-link]");
    if (!link) return;
    event.preventDefault();
    setTab("rnd");
    const card = doc.getElementById(researchNodeId(link.getAttribute("data-research-link")));
    card?.scrollIntoView({ block: "center" });
    card?.focus({ preventScroll: true });
  });
}
