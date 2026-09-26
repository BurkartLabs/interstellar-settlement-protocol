// What an hour of extraction on a lease is multiplied by (ISP-86; ISP-98, AB#788): the corporation's research (+10%
// Basic Extraction, +6% Supply Forecast) and, on a lease with a Cryo-vapor Extractor Array, data/economy.json's
// buildings.cryoVaporExtractorArrayMiningMultiplier. One rule for the server's mining tick (server/game/mining.js) and
// the extractor panel's projection (views/station.js), which each had their own copy of the research part.
import { leaseFacilities } from "./leaseSlots.js";

export const CRYO_VAPOR_ARRAY = "Cryo-vapor Extractor Array";

export function miningEfficiency(corp, lease, buildings) {
  const tech = corp?.unlockedTech || [];
  let efficiency = 1;
  if (tech.includes("tt-basic-extraction")) efficiency *= 1.1;
  if (tech.includes("tt-supply-forecast")) efficiency *= 1.06;
  const cryo = Number(buildings?.cryoVaporExtractorArrayMiningMultiplier);
  if (leaseFacilities(lease).includes(CRYO_VAPOR_ARRAY) && Number.isFinite(cryo) && cryo > 0) efficiency *= cryo;
  return efficiency;
}
