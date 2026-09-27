// server/transfers.js
// What a transfer between two stations costs and how long it takes (AB#718), for any pair in the station registry (server/game/stations.js).
// The rules are public/scripts/logistics.js's, which the Logistics tab shares; the rates are data/economy.json's.

import { ECONOMY } from "./economy.js";
import { stationHops, transferFee as feeOverJumps, transitMinutes } from "../public/scripts/logistics.js";
import { NAVIGATION } from "./game/catalog.js";
import { allStations } from "./game/stations.js"; // ISP-209 (AB#904)

/** Jumps between two stations in the catalog; null for an unknown station or no route. */
export function jumpsBetween(fromStationId, toStationId) {
  return stationHops(allStations(), fromStationId, toStationId, NAVIGATION);
}

/** The fee, in credits, to move `quantity` units from one station to another; null for an unknown station. */
export function transferFee(fromStationId, toStationId, quantity) {
  const hops = jumpsBetween(fromStationId, toStationId);
  return hops === null ? null : feeOverJumps(ECONOMY.logistics, hops, [{ quantity }]);
}

/** How long a shipment from one station to another takes, in minutes; null for an unknown station. */
export function transitTime(fromStationId, toStationId) {
  const hops = jumpsBetween(fromStationId, toStationId);
  return hops === null ? null : transitMinutes(ECONOMY.logistics, hops);
}
