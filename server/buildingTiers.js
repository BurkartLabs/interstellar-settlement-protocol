// server/buildingTiers.js: the shared tier rule (public/scripts/buildingTiers.js, ISP-102, AB#794) with the server's
// own catalogue and economy as its defaults, so a route cannot pass the page's copy by mistake.

import { ECONOMY } from "./economy.js";
import { PLAYER_BUILDING_CATALOGUE } from "./playerBuildings.js";
import { fabricationMsFor as sharedFabricationMsFor, tierTableFor as sharedTierTableFor } from "../public/scripts/buildingTiers.js";

export function tierTableFor(building, catalogue = PLAYER_BUILDING_CATALOGUE, buildings = ECONOMY.buildings) {
  return sharedTierTableFor(building, catalogue, buildings);
}

/** The catalogue entry for a built building, by the name corp.buildings records. */
export function catalogueEntryFor(buildingRecord, catalogue = PLAYER_BUILDING_CATALOGUE) {
  return catalogue.find((b) => b.name === buildingRecord?.name) || null;
}

export function fabricationMsFor(tier, baseMs, buildings = ECONOMY.buildings) {
  return sharedFabricationMsFor(tier, baseMs, buildings);
}
