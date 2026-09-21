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
