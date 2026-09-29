// server/game/researchGates.js: the Tier 4 resources a corporation recovers only once it has the research that names
// them (ISP-186, AB#880). A node's `recovers` in data/research.json lists them (docs/design/v0.11-tier4.md section 1).
// Without the node, an item's share of what an expedition or an extractor digs is not recovered: the units are drawn
// from the belt or the body all the same, and lost. What a corporation already holds is never taken back. The chain
// gate lives here too, so a chain that names a node is refused by the same check whatever the building.

import { ITEMS } from "./items.js";
import { REFINERY_CHAINS_DATA, RESEARCH_DATA, SYSTEMS_DATA } from "./catalog.js";

/** The lowest tier that is research-gated (docs/design/v0.11-tier4.md section 1). */
export const GATED_TIER = 4;

/**
 * Bug #4804: canRecover lets anything no node names be recovered by everyone, which is right for ordinary resources
 * and would be silent for a Tier 4 item left out of every node's `recovers`. So the data is held to it here, and the
 * server does not start without it (as rats.js does): every Tier 4 item a body or a belt yields is recovered by some
 * node, every Tier 4 item a chain makes comes from a chain that names research, and every `recovers` names an item.
 * Returns the problems as sentences; none today.
 */
export function researchGateProblems({ items, systems, chains, nodes }) {
  const names = new Set((items || []).map((i) => i.name));
  const gatedTier = new Set((items || []).filter((i) => i.tier >= GATED_TIER).map((i) => i.name));
  const recovered = new Set((nodes || []).flatMap((n) => n.recovers || []));
  const problems = [];
  for (const node of nodes || []) for (const item of node.recovers || []) {
    if (!names.has(item)) problems.push(`research.json ${node.id} recovers "${item}", which is no item`);
  }
  const dug = new Map(); // item -> where it is dug
  for (const system of systems || []) for (const body of system.bodies || []) {
    const at = `systems.json ${system.id}:${body.id}`;
    for (const item of Object.keys(body.composition || {})) if (!dug.has(item)) dug.set(item, `${at} composition`);
    for (const p of body.resourceProfile || []) if (!dug.has(p?.item)) dug.set(p?.item, `${at} resourceProfile`);
  }
  for (const [item, at] of dug) {
    if (gatedTier.has(item) && !recovered.has(item)) problems.push(`${at} yields Tier ${GATED_TIER} "${item}", which no research node recovers, so everyone would recover it from the start`);
  }
  for (const chain of chains || []) for (const out of chain.outputs || []) {
    if (gatedTier.has(out?.item) && !(chain.requiresTechIds || []).length) problems.push(`refinery-chains.json ${chain.id} makes Tier ${GATED_TIER} "${out.item}" and names no research`);
  }
  return problems;
}

const GATE_PROBLEMS = researchGateProblems({ items: ITEMS, systems: SYSTEMS_DATA, chains: REFINERY_CHAINS_DATA.chains, nodes: RESEARCH_DATA.nodes });
if (GATE_PROBLEMS.length) throw new Error(`Research gates: ${GATE_PROBLEMS.join("; ")}. The server does not start with a Tier ${GATED_TIER} item open to everyone (Bug #4804).`);

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
