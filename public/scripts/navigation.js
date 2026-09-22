// Which navigation research reaches which system. The one copy of the travel gate: the server's travel route and
// lease check and the browser's starmap all import it (Bug #976: three copies had drifted, and two of them made
// Sol a deep-star system, so a corporation with only Proxima navigation could reach Alpha Centauri and not return).

const NEAR_STAR_SYSTEMS = new Set(["alpha-centauri", "barnards-star"]);
const NEAR_STAR_TECH = "tt-proxima-navigation";
const DEEP_STAR_TECH = "tt-deep-star-navigation";

/** The research a jump to this system needs, or null for Sol, which every corporation can always return to. */
export function researchForSystem(systemId) {
  if (systemId === "sol") return null;
  return NEAR_STAR_SYSTEMS.has(systemId) ? NEAR_STAR_TECH : DEEP_STAR_TECH;
}

/** Whether a corporation in currentSystemId with this research (a Set or an array) can go to targetSystemId. */
export function canReachSystem(unlockedTech, currentSystemId, targetSystemId) {
  if ((currentSystemId || "sol") === targetSystemId) return true;
  const required = researchForSystem(targetSystemId);
  if (!required) return true;
  const unlocked = unlockedTech instanceof Set ? unlockedTech : new Set(unlockedTech || []);
  return unlocked.has(required);
}

// Bug #1270: a jump that needs research the corporation lacks says which research, and what stands before it, instead
// of 'Navigation research required'. Names, tiers, levels and prerequisites come from the research catalog the caller
// passes (the server's research library, or the page's copy of it), so the text cannot drift from the rules. The
// order of what is missing is queue-rnd's order of checks: prerequisites, corporation level, then Tier 1 research.
const catalogEntries = (catalog) => (Array.isArray(catalog) ? catalog : Object.values(catalog || {}));
const catalogEntry = (catalog, id) => catalogEntries(catalog).find((t) => t?.id === id) || { id, name: id, prereqs: [] };

/** The name of the research a jump to this system needs, or null when it needs none. */
export function travelResearchName(catalog, targetSystemId) {
  const id = researchForSystem(targetSystemId);
  return id ? catalogEntry(catalog, id).name : null;
}

/**
 * Why a corporation cannot jump to targetSystemId, naming the research and what it still needs before that research
 * can be queued, or null when the jump is open. The Starmap shows it on the lock; the travel route refuses with it.
 */
export function travelResearchLock(catalog, unlockedTech, corpLevel, currentSystemId, targetSystemId) {
  if (canReachSystem(unlockedTech, currentSystemId, targetSystemId)) return null;
  const unlocked = unlockedTech instanceof Set ? unlockedTech : new Set(unlockedTech || []);
  const tech = catalogEntry(catalog, researchForSystem(targetSystemId));
  const level = Number(tech.requiresCorpLevel) || 0;
  const head = `Requires ${tech.name} (Corporate R&D, Tier ${tech.tier ?? "?"}${level ? `, corporation level ${level}` : ""}).`;

  const missing = (tech.prereqs || []).filter((id) => !unlocked.has(id)).map((id) => catalogEntry(catalog, id).name);
  if (level && (Number(corpLevel) || 0) < level) missing.push(`corporation level ${level} (you are level ${Number(corpLevel) || 0})`);
  if ((tech.tier || 0) >= 2) {
    const tier1 = catalogEntries(catalog).filter((t) => t.tier === 1);
    const done = tier1.filter((t) => unlocked.has(t.id)).length;
    if (done < tier1.length) missing.push(`all Tier 1 research (${done} of ${tier1.length} done)`);
  }
  return missing.length
    ? `${head} Before you can research it: ${missing.join("; ")}.`
    : `${head} You meet its requirements: research it in Corporate R&D.`;
}
