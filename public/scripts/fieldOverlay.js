// The Starmap's field overlays: GDP Index, Activity Level and Pirate Density, each colouring a system by one field
// data/systems.json holds. Their definitions, colour and legend, as resourceOverlay.js, dominanceOverlay.js and
// concessionOverlay.js hold theirs (Bug AB#4745 gave them a legend; moved out of starmap.js with it).

/**
 * The Starmap's overlays, in picker order (index.html's #map-overlay lists the same, after None). Each colours a system
 * by one field data/systems.json holds, over its full scale. AB#1459: there is no resource overlay, because no system
 * carries resource data yet; the one that was here blended GDP and pirates under a resource label.
 */
export const STARMAP_OVERLAYS = {
  gdp: { label: "GDP Index", field: "gdpIndex", scale: 100 },
  activity: { label: "Activity Level", field: "activityLevel", scale: 100 },
  pirates: { label: "Pirate Density", field: "pirateDensity", scale: 40 }
};

/** A system's colour under an overlay; "none", or any overlay not offered, draws the plain map. */
export function overlayColor(system, overlay) {
  const spec = Object.hasOwn(STARMAP_OVERLAYS, overlay) ? STARMAP_OVERLAYS[overlay] : null;
  if (!spec) {
    return "rgba(0, 247, 255, 0.88)";
  }

  const value = Number(system[spec.field]) / spec.scale;
  const clamped = Math.max(0.1, Math.min(1, value));
  return `rgba(${Math.floor((1 - clamped) * 180 + 40)}, ${Math.floor(clamped * 220 + 30)}, 255, 0.92)`;
}

/** Bug AB#4745: the legend for a field overlay: its scale from low to high in the colours the stars take. "" otherwise. */
export function fieldOverlayLegendHtml(overlay) {
  const spec = Object.hasOwn(STARMAP_OVERLAYS, overlay) ? STARMAP_OVERLAYS[overlay] : null;
  if (!spec) return "";
  const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * spec.scale));
  const swatches = steps.map((v, i) => {
    const word = i === 0 ? "low, " : i === steps.length - 1 ? "high, " : "";
    return `<li><span class="starmap__band" style="background:${overlayColor({ [spec.field]: v }, overlay)}" aria-hidden="true"></span>${word}${v}</li>`;
  }).join("");
  const scaleLabel = `${spec.label} scale, low to high`; // Bug #4790: the interpolation is the whole attribute (the Bug #1254 check)
  return `<p class="starmap__subhead">${spec.label}: each system coloured by its ${spec.label}, 0 to ${spec.scale}.</p>
    <ul class="starmap__bands" aria-label="${scaleLabel}" data-field-legend="${overlay}">${swatches}</ul>
    <p class="ui-panel__meta">A thin grey ring marks a system you cannot jump to yet. Its figures are in its panel when you open it.</p>`;
}
