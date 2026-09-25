// AB#1124/AB#1870: an office registers a corporation's presence at one station, not company-wide, and only while
// its lease has not lapsed. The one copy of that rule: the server's routes and every client view that asks "does
// this corporation have a usable office here" import it, so an office rented somewhere else, or one that has
// expired, cannot stand in for one at the station being asked about.
export function activeOfficeAt(corp, stationId, now = Date.now()) {
  if (!stationId || !Array.isArray(corp?.offices)) return null;
  return corp.offices.find((o) => o.stationId === stationId && o.rentedUntil > now) || null;
}
