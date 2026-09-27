// server/game/researchGates.js: the Tier 4 resources a corporation recovers only once it has the research that names
// them (ISP-186, AB#880). A node's `recovers` in data/research.json lists them (docs/design/v0.11-tier4.md section 1).
// Without the node, an item's share of what an expedition or an extractor digs is not recovered: the units are drawn
// from the belt or the body all the same, and lost. What a corporation already holds is never taken back. The chain
// gate lives here too, so a chain that names a node is refused by the same check whatever the building.

import { RESEARCH_DATA } from "./catalog.js";

/** Each research-gated item, and the node that lets a corporation recover it. */
export const ITEM_RESEARCH_GATES = Object.freeze(Object.fromEntries(
  RESEARCH_DATA.nodes.flatMap((node) => (node.recovers || []).map((item) => [item, node.id]))));

/** The first research a chain names that `corp` lacks, or null: the start route's gate, for every chain (AB#880). */
export function chainResearchMissing(chain, corp) {
  const unlocked = corp?.unlockedTech || [];
  return (chain?.requiresTechIds || []).find((id) => !unlocked.includes(id)) || null;
}

/** Whether `corp` recovers `item` when it digs it: always, unless a node gates it and the corporation lacks that node. */
export function canRecover(corp, item) {
  const gate = ITEM_RESEARCH_GATES[item];
  return !gate || (corp?.unlockedTech || []).includes(gate);
}
