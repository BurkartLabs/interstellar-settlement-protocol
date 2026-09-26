// ISP-78 (AB#767): a station is known by the body it orbits. Its header shows that body, a Sol body from its
// photograph (AB#741) and any other from the procedural renderer the Starmap draws it with (AB#742), so a screenshot of
// the Station tab says which station it is. The catalogue names the body (data/stations.json `body`), and the world's
// systems carry its id and style.
import { drawProceduralBody, isProcedural } from "./bodyRender.js";
import { PLANET_IMAGE_PATHS } from "./planetImages.js";
import { escapeHtml } from "./html.js";

/** The body a station orbits, from the world's systems: matched by name within the station's system. */
export function stationBody(station, systems) {
  const system = (systems || []).find((s) => s.id === station?.systemId);
  return (system?.bodies || []).find((b) => b.name === station?.body) || null;
}

/** How the body is shown: "image" for a photograph, "procedural" for a drawn body, null when there is neither. */
export function stationArtKind(body) {
  if (PLANET_IMAGE_PATHS[body?.id]) return "image";
  if (isProcedural(body)) return "procedural";
  return null;
}

/** The figure for a station's header, or "" when its body cannot be shown. */
export function stationArtHtml(station, systems) {
  const body = stationBody(station, systems);
  const kind = stationArtKind(body);
  const label = `${body?.name}, the body ${station?.name} orbits`;
  if (kind === "image") {
    return `<figure class="station__art"><img class="station__body" src="${escapeHtml(PLANET_IMAGE_PATHS[body.id])}" alt="${escapeHtml(label)}"></figure>`;
  }
  if (kind === "procedural") {
    return `<figure class="station__art"><canvas class="station__body" data-body-id="${escapeHtml(body.id)}" width="176" height="176" role="img" aria-label="${escapeHtml(label)}"></canvas></figure>`;
  }
  return "";
}

/** Paint the procedural bodies `stationArtHtml` left as canvases under `root`. */
export function paintStationArt(root, systems) {
  for (const canvas of root?.querySelectorAll?.("canvas[data-body-id]") || []) {
    const body = (systems || []).flatMap((s) => s.bodies || []).find((b) => b.id === canvas.dataset.bodyId);
    const ctx = canvas.getContext?.("2d");
    if (!body || !ctx) continue;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const size = 176;
    canvas.width = canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawProceduralBody(ctx, body, size / 2, size / 2, size * 0.4);
  }
}
