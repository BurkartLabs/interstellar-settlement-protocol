/**
 * What the Starmap is told about asteroid mining, from the corporation's state and the belt compositions the server
 * has revealed to it (GET .../gameplay/belt-compositions). One shape for both callers: every full redraw
 * (updateAllViews) and the moment the compositions arrive after a load (Bug #1264).
 */
export function starmapMiningState(data, beltCompositions, beltSlots = {}) {
  const am = data?.corp?.asteroidMining || {};
  return {
    probeCount: am.probeCount || 0,
    maxProbes: data?.corp?.fleet?.cap ?? 2,
    maxDeployments: am.maxDeployments || 1,
    activeExpeditions: am.activeExpeditions || [],
    scoutedBelts: am.scoutedBelts || [],
    beltCompositions: beltCompositions || {},
    // AB#2331: each slot's state (present, generation, next draw; for a scouted belt its rarity and reserve)
    belts: beltSlots.belts || {},
    respawnChancePerHour: beltSlots.respawnChancePerHour ?? null,
    remoteDispatchYieldPct: beltSlots.remoteDispatchYieldPct ?? null // Bug #4656: a remote launch's share of the yield
  };
}
