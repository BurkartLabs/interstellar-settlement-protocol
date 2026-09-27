// ISP-212 (AB#907): what a conglomerate member pays at its own conglomerate's station (docs/design/CONGLOMERATES.md
// Part 2, "What the station gives members"). Pure, so the server charges and the page quotes the same figure:
// - an office there at stationMemberRentPct (50%) of the rent anyone else pays, for a lease and for a renewal;
// - moving goods between that station and another station in the same system costs nothing.
// `memberStation` is { id, officeRentPct } for the corporation's own conglomerate's station, or null. The server resolves
// it at the moment of each order (server/game/stationGovernance.js memberStation); the page has it from the
// conglomerate the server last described (appState.conglomerate.station).

/** Whether this is the corporation's own conglomerate's station. */
export const isMemberStation = (memberStation, stationId) => Boolean(memberStation?.id) && memberStation.id === stationId;

/** An office's cost at `stationId`: the member rate there for a member, `cost` everywhere else. */
export function memberOfficeCost(cost, memberStation, stationId) {
  if (!isMemberStation(memberStation, stationId)) return cost;
  return Math.round((Number(cost) || 0) * (Number(memberStation.officeRentPct) || 0) / 100);
}

/** Whether a transfer's fee is waived: a member moving goods within its station's system, to or from that station. */
export function transferFeeWaived(memberStationId, fromStationId, toStationId, hops) {
  return Boolean(memberStationId) && hops === 0 && (fromStationId === memberStationId || toStationId === memberStationId);
}
