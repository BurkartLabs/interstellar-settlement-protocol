// A mining lease's building slots (ISP-98, AB#788): its extractors (`extractorIds`, which server/game/mining.js rebuilds
// from the yards) and the other buildings standing on it (`facilities`, by name, such as a Cryo-vapor Extractor Array).
// Every reader that asks whether a lease has room counts both through here, on the server and in the page alike.

/** The names of the buildings on a lease that are not extractors. */
export function leaseFacilities(lease) {
  return Array.isArray(lease?.facilities) ? lease.facilities : [];
}

/** How many of a lease's building slots are in use. */
export function leaseSlotsUsed(lease) {
  return (Array.isArray(lease?.extractorIds) ? lease.extractorIds.length : 0) + leaseFacilities(lease).length;
}

/** Whether a lease has a free building slot. */
export function leaseHasRoom(lease) {
  return leaseSlotsUsed(lease) < (Number(lease?.buildingSlots) || 2);
}
