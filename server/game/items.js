// server/game/items.js: the item catalog (ISP-130, AB#824). Every raw and refined good the game names is one entry of
// data/items.json, and every data file names an item by that entry's `name`. Items were free strings, so "Helium-3"
// and "Helium 3" would have been two commodities and nobody would have noticed (T-019). Now the server does not start
// while any data file names an item the catalog lacks, and tests/schema/items.test.js holds the same line.
//
// It reads the data files itself rather than importing the modules that load them, so every other catalog module may
// import it without a cycle.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (file) => JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));

export const ITEM_TIERS = Object.freeze([1, 2, 3]);
export const ITEM_CATEGORIES = Object.freeze(["raw", "refined"]);

/** Each entry of `items` whose id, name, tier or category is missing or wrong, or whose id or name repeats. */
export function itemSchemaProblems(items) {
  const problems = [];
  const ids = new Set();
  const names = new Set();
  for (const [i, item] of (items || []).entries()) {
    const at = `item ${i} (${item?.id ?? "no id"})`;
    if (typeof item?.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(item.id)) problems.push(`${at}: id must be kebab-case`);
    if (typeof item?.name !== "string" || !item.name.trim()) problems.push(`${at}: no name`);
    if (!ITEM_TIERS.includes(item?.tier)) problems.push(`${at}: tier must be one of ${ITEM_TIERS.join(", ")}`);
    if (!ITEM_CATEGORIES.includes(item?.category)) problems.push(`${at}: category must be one of ${ITEM_CATEGORIES.join(", ")}`);
    if ((item?.category === "refined") !== (item?.tier === 3)) problems.push(`${at}: tier 3 is refined, and only tier 3`);
    if (ids.has(item?.id)) problems.push(`${at}: id repeats`);
    if (names.has(item?.name)) problems.push(`${at}: name repeats`);
    ids.add(item?.id);
    names.add(item?.name);
  }
  return problems;
}

/**
 * Every item a data file names, as { source, name }: the refinery chains (their resource list, inputs and outputs),
 * each belt's composition, the NPC bids and asks, what each NPC corporation trades, each contract's quota, and each
 * milestone's totalMined:<resource> (its lowercase key; "silicate" is the Silicate yards' own, AB#798).
 */
export function itemReferences({ refineryChains, systems, economy, npcCorporations, missions, milestones }) {
  const refs = [];
  const add = (source, name) => refs.push({ source, name });
  for (const name of refineryChains?.resourceCatalog || []) add("refinery-chains.json resourceCatalog", name);
  for (const chain of refineryChains?.chains || []) {
    if (chain?.input) add(`refinery-chains.json ${chain.id} input`, chain.input);
    for (const out of chain?.outputs || []) add(`refinery-chains.json ${chain.id} output`, out?.item);
  }
  for (const system of systems || []) {
    for (const body of system?.bodies || []) {
      for (const name of Object.keys(body?.composition || {})) add(`systems.json ${system.id}:${body.id}`, name);
    }
  }
  for (const buyer of economy?.npcBuyers || []) add("economy.json npcBuyers", buyer?.item);
  for (const ask of economy?.npcAsks?.dailyQty || []) add("economy.json npcAsks", ask?.item);
  for (const corp of npcCorporations?.corporations || []) for (const name of corp?.trades || []) add(`npc-corporations.json ${corp.id}`, name);
  for (const template of missions?.templates || []) if (template?.resource) add(`missions.json ${template.id}`, template.resource);
  for (const level of milestones?.levels || []) {
    for (const req of level?.requirements || []) {
      const key = String(req?.metric || "").match(/^totalMined:(.+)$/)?.[1];
      if (key) refs.push({ source: `milestones.json level ${level.level} ${req.id}`, name: key, metricKey: true });
    }
  }
  return refs;
}

/** The references that name no item in `items`, as "source: name". A metric key matches a name case-insensitively. */
export function unknownItemReferences(sources, items) {
  const names = new Set((items || []).map((i) => i.name));
  const lower = new Set((items || []).map((i) => i.name.toLowerCase()));
  return itemReferences(sources).filter((ref) => {
    if (ref.metricKey) return !(ref.name === "silicate" || lower.has(String(ref.name).toLowerCase()));
    return !names.has(ref.name);
  }).map((ref) => `${ref.source}: ${JSON.stringify(ref.name ?? null)}`);
}

/** Every data file that names items, as the server reads them. */
export function dataItemSources() {
  return {
    refineryChains: read("refinery-chains.json"),
    systems: read("systems.json"),
    economy: read("economy.json"),
    npcCorporations: read("npc-corporations.json"),
    missions: read("missions.json"),
    milestones: read("milestones.json")
  };
}

export const ITEMS = Object.freeze(read("items.json").items.map((item) => Object.freeze({ ...item })));
export const ITEM_NAMES = Object.freeze(new Set(ITEMS.map((item) => item.name)));
{
  const problems = [...itemSchemaProblems(ITEMS), ...unknownItemReferences(dataItemSources(), ITEMS)];
  if (problems.length) throw new Error(`data/items.json and the data files that name items disagree (AB#824): ${problems.join("; ")}.`);
}
