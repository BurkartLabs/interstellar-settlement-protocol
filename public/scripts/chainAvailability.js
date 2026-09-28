// ISP (AB#2485): which refinery chains a corporation can run, and what stands between it and the rest. The Board's
// review (2026-09-26, item 31) found "Available Chains" listing every chain; it lists the ones the corporation can run
// now, and an "Unavailable Chains" section says what each of the others is missing.
//
// A chain can run when its research is done and its building is owned or can be built: the building's own research
// (data/player-buildings.json researchGates, sent as playerBuildings) and its Corporation Level. Inputs never make a
// chain unavailable. They can be mined, bought or refined, and every chain shows its shortfall the same way. A slot,
// the credits or an idle refinery never make it unavailable either: those are the card's own controls and badges.

/** Each chain building's research, when the catalogue has not loaded (as data/player-buildings.json has them). */
const FALLBACK = {
  refinery: { name: "Refinery", researchGates: ["tt-material-compression", "tt-nano-lattice"] },
  "synthesis-array": { name: "Synthesis Array", researchGates: ["tt-high-energy-synthesis", "tt-integrated-manufacturing"] }
};

/**
 * What stands between the corporation and running `chain`:
 * { available, research: [missing research ids, the chain's then its building's], building: { id, name, owned,
 *   minLevel } } where minLevel is the Corporation Level still needed to build it (0 when none).
 */
export function chainBlockers(chain, { unlockedTech = [], refineries = [], synthesisArrays = [], playerBuildings = [], level = 0 } = {}) {
  const has = new Set(unlockedTech);
  const kind = chain?.building === "synthesis-array" ? "synthesis-array" : "refinery";
  const entry = playerBuildings.find((b) => b?.id === kind) || FALLBACK[kind];
  const owned = (kind === "synthesis-array" ? synthesisArrays : refineries).length > 0;
  const research = [...new Set([
    ...(chain?.requiresTechIds || []),
    ...(owned ? [] : entry.researchGates || FALLBACK[kind].researchGates)
  ])].filter((id) => !has.has(id));
  const minLevel = !owned && Number(entry.minLevel) > (Number(level) || 0) ? Number(entry.minLevel) : 0;
  return { available: !research.length && !minLevel, research, building: { id: kind, name: entry.name || FALLBACK[kind].name, owned, minLevel } };
}

/** The chains split in their order: { available: [chain], unavailable: [{ chain, blockers }] }. */
export function splitChains(chains = [], ctx = {}) {
  const available = [];
  const unavailable = [];
  for (const chain of chains) {
    const blockers = chainBlockers(chain, ctx);
    if (blockers.available) available.push(chain);
    else unavailable.push({ chain, blockers });
  }
  return { available, unavailable };
}
