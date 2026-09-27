// The military upkeep rule (ISP-173, AB#867; docs/design/v0.10-combat.md section 7), in one place: the server charges by
// it (server/upkeep.js) and the Fleet tab shows it (ISP-175, AB#869), so the number beside a Queue button is the number
// the ticker takes. Pure: it reads the unit catalog it is given and the corporation's counts.
//
// upkeep a day = the units' base upkeep x (1 + (S / K)^2), S the total supply, K 40 per Orbital Shipyard tier (40
// without one). Each unit type's share of the day is its base share times the same factor.

export const K_PER_SHIPYARD_TIER = 40;

/** The catalog as a map by id, from either a map or the /api/bootstrap list. */
const byId = (catalog) => (Array.isArray(catalog) ? Object.fromEntries(catalog.map((u) => [u.id, u])) : catalog || {});

/**
 * The day's upkeep for `counts` ({ lf: 14, ... }) at a shipyard of `shipyardTier` (0 without one): each type's share,
 * the total, and the supply, capacity and factor behind them.
 */
export function upkeepBreakdown(catalog, counts = {}, shipyardTier = 0) {
  const units = byId(catalog);
  const ids = Object.keys(units);
  const n = (id) => Math.max(0, Math.floor(Number(counts?.[id]) || 0));
  const supply = ids.reduce((sum, id) => sum + n(id) * units[id].supply, 0);
  const capacity = K_PER_SHIPYARD_TIER * Math.max(1, Math.floor(Number(shipyardTier) || 0));
  const factor = 1 + (supply / capacity) ** 2;
  const perType = Object.fromEntries(ids.map((id) => [id, n(id) * units[id].upkeepPerDay * factor]));
  const total = ids.reduce((sum, id) => sum + perType[id], 0);
  return { perType, total, supply, capacity, factor };
}

/** The Orbital Shipyard's tier from a corporation's buildings, 0 when it has none. */
export function shipyardTierOf(buildings = []) {
  const yard = (buildings || []).find((b) => b?.name === "Orbital Shipyard");
  return yard ? Math.max(1, Number(yard.tier) || 1) : 0;
}
