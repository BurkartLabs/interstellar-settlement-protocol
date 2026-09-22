// What the feedback log says in asteroid mining (AB#1257): it said "Mining Probe fabricated." the moment fabrication
// began, 30 minutes before a probe existed, and named a scouted belt by its internal key ("sol:belt").

/** A duration a player reads: "45 seconds", "30 minutes", "1h 30m". Rounded up, so it never promises early. */
export function readyInText(ms) {
  const seconds = Math.max(1, Math.ceil(Number(ms) / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** After Fabricate Mining Probe: started, and when it will be ready, from the fabrication queue the server returned. */
export function probeFabricationStartedText(fabricationQueue, now = Date.now()) {
  const readyAt = (fabricationQueue || []).reduce((latest, job) => Math.max(latest, Number(job?.completesAt) || 0), 0);
  if (!readyAt) return "Mining Probe fabrication started.";
  return `Mining Probe fabrication started: ready in ${readyInText(readyAt - now)}.`;
}

/** When fabrication completes: the probe exists now, and how many are in the hangar. */
export function probeReadyText(probeCount) {
  const n = Math.max(1, Number(probeCount) || 0);
  return `Mining Probe fabricated: ${n} ${n === 1 ? "probe" : "probes"} in the hangar, ready to launch.`;
}

/** After Scout Asteroid Belt: the belt and system by their names, never the key. */
export function beltScoutedText(beltKey, systems) {
  const [systemId, bodyId] = String(beltKey || "").split(":");
  const system = (systems || []).find((s) => s.id === systemId);
  const body = (system?.bodies || []).find((b) => b.id === bodyId);
  if (system && body) return `Scouted the ${body.name} in ${system.name}.`;
  if (system) return `Scouted the asteroid belt in ${system.name}.`;
  return "Scouted the asteroid belt.";
}
