// ISP-119 (AB#811): where the starmap marks neutral stations. A station is neutral when data/stations.json says so
// (`"jurisdiction": "neutral"`, ISP-118, AB#810): no corporation owns it, and any corporation may dock and rent an office
// there. Everything here reads that field from the catalog the page is given (GET /api/stations); nothing keeps its own
// list of stations. Pure: it loads in node and the browser.

/** Whether the catalog marks this station neutral. A station with no jurisdiction, or another one, is not. */
export const isNeutralStation = (station) => station?.jurisdiction === "neutral";
/** ISP-210 (AB#905): a station a conglomerate built and owns (`"jurisdiction": "conglomerate"`, from GET /api/stations). */
export const isConglomerateStation = (station) => station?.jurisdiction === "conglomerate";

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
 * AB#2349 (the Director's ruling on AB#811): every system has at least one neutral station (AB#810, AB#807), so a
 * count of one says nothing about where to expand. The cluster view badges only a count above this baseline; the
 * legend says every system has at least one. If station counts come to vary more, the rule still holds: the badge marks
 * what differs from the baseline.
 */
export const STATION_BADGE_BASELINE = 1;

/** The counts the cluster view badges: Map systemId -> count, only systems with more than the baseline. */
export function badgedStationCounts(stations, baseline = STATION_BADGE_BASELINE) {
  return new Map([...neutralStationCounts(stations)].filter(([, n]) => n > baseline));
}

/**
 * The neutral stations of `system`, and since ISP-210 (AB#905) the ones conglomerates built (`owned: true`), each with
 * the body the system view marks it on: the body it orbits when that is a planet or a belt, and the planet a moon orbits
 * when it orbits a moon (the system view draws planets and belts only; Luna Gateway is marked on Earth). A station naming
 * no body of the system, or with no jurisdiction the page knows, is left out, not guessed at. The cluster view's count
 * badges stay neutral stations only.
 */
export function systemStationMarkers(system, stations) {
  const bodies = system?.bodies || [];
  const byName = new Map(bodies.map((b) => [b.name, b]));
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const markers = [];
  for (const station of stations || []) {
    if (!(isNeutralStation(station) || isConglomerateStation(station)) || station.systemId !== system?.id) continue;
    const body = byName.get(station.body);
    if (!body) continue;
    const anchor = body.type === "Moon" ? byId.get(body.parentId) : body;
    if (!anchor || (anchor.type !== "Planet" && anchor.type !== "Field")) continue;
    markers.push({ station, bodyId: anchor.id, owned: isConglomerateStation(station) });
  }
  return markers;
}

/**
 * Where the cluster view puts each system's count badge. The names are planned first (AB#808's planClusterLabels, as
 * it was), so a badge never costs a name its place: each badge takes the first place round its star (above left,
 * above right, below left, below right, centred above or below, then level with it on the left or the right) that stays on the canvas and crosses no name, no
 * other badge and no other star. When none is free it takes the place on the canvas that covers the least of any name,
 * then the least of other badges and stars: a badge over a name is the one thing worse than a crowded badge.
 * `systems`: [{ id, x, y, starRadius, text, textWidth }]; `labelBoxes` and the returned boxes are
 * { left, right, top, bottom }; `stars`: [{ id, x, y, r }]. Returns Map id -> box.
 */
export function placeStationBadges({ systems, labelBoxes = [], stars = [], canvasWidth, canvasHeight, fontPx = 9 }) {
  const h = Math.max(13, Math.ceil(fontPx) + 4); // a phone draws the count at 14px (chartFont)
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const coversStar = (box, id) => stars.some((s) => s.id !== id &&
    Math.hypot(Math.max(box.left, Math.min(s.x, box.right)) - s.x, Math.max(box.top, Math.min(s.y, box.bottom)) - s.y) < s.r);
  const inside = (box) => box.left >= 2 && box.top >= 2 && box.right <= canvasWidth - 2 && box.bottom <= canvasHeight - 2;
  const placed = new Map();
  for (const s of systems) {
    const w = Math.ceil(s.textWidth) + 18; // 5px pad, an 8px diamond, 3px gap, the count, 2px pad
    const near = s.starRadius + 2;
    const corners = [
      { left: s.x - 3 - w, top: s.y - near - h }, { left: s.x + 3, top: s.y - near - h },
      { left: s.x - 3 - w, top: s.y + near }, { left: s.x + 3, top: s.y + near },
      { left: s.x - w / 2, top: s.y - near - h }, { left: s.x - w / 2, top: s.y + near },
      { left: s.x - near - 3 - w, top: s.y - h / 2 }, { left: s.x + near + 3, top: s.y - h / 2 }
    ].map((c) => ({ ...c, right: c.left + w, bottom: c.top + h }));
    const taken = [...labelBoxes, ...placed.values()];
    const free = corners.find((box) => inside(box) && !taken.some((b) => overlaps(box, b)) && !coversStar(box, s.id));
    if (free) { placed.set(s.id, free); continue; }
    const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const cost = (box) => labelBoxes.reduce((n, b) => n + area(box, b), 0) * 1000 + [...placed.values()].reduce((n, b) => n + area(box, b), 0) + (coversStar(box, s.id) ? 1 : 0);
    const onCanvas = corners.filter(inside);
    placed.set(s.id, (onCanvas.length ? onCanvas : corners).reduce((best, box) => (cost(box) < cost(best) ? box : best)));
  }
  return placed;
}
