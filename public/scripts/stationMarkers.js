// ISP-119 (AB#811): where the starmap marks neutral stations. A station is neutral when data/stations.json says so
// (`"jurisdiction": "neutral"`, ISP-118, AB#810): no corporation owns it, and any corporation may dock and rent an office
// there. Everything here reads that field from the catalog the page is given (GET /api/stations); nothing keeps its own
// list of stations. Pure: it loads in node and the browser.

/** Whether the catalog marks this station neutral. A station with no jurisdiction, or another one, is not. */
export const isNeutralStation = (station) => station?.jurisdiction === "neutral";

/** How many neutral stations each system has: Map systemId -> count, only systems with at least one. */
export function neutralStationCounts(stations) {
  const counts = new Map();
  for (const station of stations || []) {
    if (!isNeutralStation(station) || !station.systemId) continue;
    counts.set(station.systemId, (counts.get(station.systemId) || 0) + 1);
  }
  return counts;
}

/**
 * The neutral stations of `system`, each with the body the system view marks it on: the body it orbits when that is a
 * planet or a belt, and the planet a moon orbits when it orbits a moon (the system view draws planets and belts only;
 * Luna Gateway is marked on Earth). A station naming no body of the system is left out, not guessed at.
 */
export function systemStationMarkers(system, stations) {
  const bodies = system?.bodies || [];
  const byName = new Map(bodies.map((b) => [b.name, b]));
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const markers = [];
  for (const station of stations || []) {
    if (!isNeutralStation(station) || station.systemId !== system?.id) continue;
    const body = byName.get(station.body);
    if (!body) continue;
    const anchor = body.type === "Moon" ? byId.get(body.parentId) : body;
    if (!anchor || (anchor.type !== "Planet" && anchor.type !== "Field")) continue;
    markers.push({ station, bodyId: anchor.id });
  }
  return markers;
}

/**
 * The cluster view's count badge for a star at (x, y) with core radius `starRadius`: a box above and to the left of the
 * star, or to the right when the left would leave the canvas. `textWidth` is the drawn width of the count. The label
 * planner is given these boxes first, so no system's name is drawn across a badge.
 */
export function stationBadgeBox({ x, y, starRadius, textWidth, fontPx = 9 }) {
  const w = Math.ceil(textWidth) + 18; // 5px pad, an 8px diamond, 3px gap, the count, 2px pad
  const h = Math.max(13, Math.ceil(fontPx) + 4); // a phone draws the count at 14px (chartFont)
  const bottom = y - starRadius - 2;
  const leftAligned = x - 3 - w;
  const left = leftAligned >= 2 ? leftAligned : x + 3;
  return { left, right: left + w, top: bottom - h, bottom };
}
