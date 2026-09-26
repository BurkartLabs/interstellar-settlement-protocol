// Which navigation research reaches which system, and the jump routes between systems. The one copy of the travel
// gate: the server's travel route and lease check and the browser's starmap all use it (Bug #976: three copies had
// drifted, and two of them made Sol a deep-star system, so a corporation with only Proxima navigation could reach
// Alpha Centauri and not return).
//
// ISP-112 (AB#804): the gate and the routes are facts of each system, so they live in data/systems.json
// (`accessResearch`, `adjacent`) and these rules read them from the catalog they are given: `navigationFor(systems)`.
// The server builds one from the file (server/game/catalog.js, NAVIGATION); the page builds one from GET /api/systems.

/**
 * A system the catalog does not list is closed to anyone without the deep-star research, as every system past the near
 * stars was before AB#804: a fail-closed default, not a fact of any system.
 */
const UNCHARTED_RESEARCH = "tt-deep-star-navigation";

// Bug #1270: a jump that needs research the corporation lacks says which research, and what stands before it, instead
// of 'Navigation research required'. Names, tiers, levels and prerequisites come from the research catalog the caller
// passes (the server's research library, or the page's copy of it), so the text cannot drift from the rules. The
// order of what is missing is queue-rnd's order of checks: prerequisites, corporation level, then Tier 1 research.
const catalogEntries = (catalog) => (Array.isArray(catalog) ? catalog : Object.values(catalog || {}));
const catalogEntry = (catalog, id) => catalogEntries(catalog).find((t) => t?.id === id) || { id, name: id, prereqs: [] };

/** The navigation rules over `systems`, data/systems.json's list. */
export function navigationFor(systems) {
  const byId = new Map((Array.isArray(systems) ? systems : []).map((s) => [s.id, s]));

  /** The research a jump to this system needs, or null for one that needs none (Sol: always a way home). */
  function researchForSystem(systemId) {
    const system = byId.get(systemId);
    if (!system) return UNCHARTED_RESEARCH;
    return system.accessResearch ?? null;
  }

  /** Whether a corporation in currentSystemId with this research (a Set or an array) can go to targetSystemId. */
  function canReachSystem(unlockedTech, currentSystemId, targetSystemId) {
    if ((currentSystemId || "sol") === targetSystemId) return true;
    const required = researchForSystem(targetSystemId);
    if (!required) return true;
    const unlocked = unlockedTech instanceof Set ? unlockedTech : new Set(unlockedTech || []);
    return unlocked.has(required);
  }

  // The jump routes: the one copy of the map's distances. The server's travel times and the transfer fee (AB#718) both
  // count jumps on them, and the Logistics tab quotes the same fee before a transfer.
  /** The fewest jumps from one system to another: 0 for the same system, null when no route joins them. */
  function systemHops(fromSystemId, toSystemId) {
    if (fromSystemId === toSystemId) return 0;
    const seen = new Set([fromSystemId]);
    let frontier = [fromSystemId];
    for (let depth = 1; frontier.length > 0; depth += 1) {
      const next = [];
      for (const system of frontier) {
        for (const neighbour of byId.get(system)?.adjacent || []) {
          if (neighbour === toSystemId) return depth;
          if (!seen.has(neighbour)) { seen.add(neighbour); next.push(neighbour); }
        }
      }
      frontier = next;
    }
    return null;
  }

  /** The name of the research a jump to this system needs, or null when it needs none. */
  function travelResearchName(catalog, targetSystemId) {
    const id = researchForSystem(targetSystemId);
    return id ? catalogEntry(catalog, id).name : null;
  }

  /**
   * Why a corporation cannot jump to targetSystemId, naming the research and what it still needs before that research
   * can be queued, or null when the jump is open. The Starmap shows it on the lock; the travel route refuses with it.
   */
  function travelResearchLock(catalog, unlockedTech, corpLevel, currentSystemId, targetSystemId) {
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

  return Object.freeze({ researchForSystem, canReachSystem, systemHops, travelResearchName, travelResearchLock });
}

// AB#1061: a station's claims office files leases only on the body it orbits (NEW_PLAYER_EXPERIENCE.md): Earth from
// Earth Station Prime, Mars from Mars Orbital Dock. The one copy of that rule: the server's lease route refuses with
// it and the level milestone cards use it to say where to go. `stations` is data/stations.json's list, or the
// server's id-keyed registry of the same objects.
const stationList = (stations) => (Array.isArray(stations) ? stations : Object.values(stations || {}));

/** The station whose claims office files leases on this body, or null when no station orbits it. */
/**
 * Bug #2328: the cluster view's lanes are the jump graph, each pair of systems where one lists the other in
 * `adjacent` (the rule systemHops routes by), once. They were every pair closer than 42% of the canvas width, which
 * drew jumps that do not exist and left out ones that do.
 */
export function lanePairs(systems) {
  const ids = new Set((systems || []).map((s) => s.id));
  const pairs = new Map();
  for (const s of systems || []) {
    for (const other of s.adjacent || []) {
      if (!ids.has(other) || other === s.id) continue;
      const key = [s.id, other].sort().join("|");
      if (!pairs.has(key)) pairs.set(key, [s.id, other].sort());
    }
  }
  return [...pairs.values()];
}

export function leaseStationFor(stations, body) {
  const wanted = String(body || "").toLowerCase();
  return stationList(stations).find((s) => String(s?.body || "").toLowerCase() === wanted) || null;
}

/** Why a lease on `body` cannot be filed from `currentStationId` (null while in transit), or null when it can. */
export function leaseFilingRefusal(stations, currentStationId, body) {
  if (!currentStationId) return "You are in transit. Dock at a station, then file the lease at its ISA Claims & Leases Division.";
  const here = stationList(stations).find((s) => s?.id === currentStationId);
  const office = leaseStationFor(stations, body);
  if (!office) return `No station files mining leases on ${body}.`;
  if (office.id === currentStationId) return null;
  return `Leases on ${office.body} are filed at ${office.name}, the station that orbits it. You are docked at ${here?.name || "another station"}: travel to ${office.name} on the Starmap, then file at its ISA Claims & Leases Division.`;
}

