// public/scripts/resourceOverlay.js: the Starmap's resource concentration overlay (ISP-143, AB#837).
//
// For a chosen item, how much of it each body yields (its share of an extraction there), and each system's best body.
// Prior art: DOTLAN's per-system overlays on the EVE map (evemaps.dotlan.net), which colour every system by one
// statistic, with a legend, and name the value on hover. Only what the player may see counts: planets' and moons'
// profiles from the public catalog (data/systems.json resourceProfile, AB#826), and a belt's composition only when this
// player has scouted its current generation (GET .../belt-compositions, AB#2331; Bug #2355 keeps the rest off the page).

/**
 * The colour bands, lowest first: colour is one of two ways the value is shown (the other is the text beside every
 * star, body and panel line), so the bands are few and far apart, in a light-on-dark sequence readable for the common
 * colour-vision deficiencies (lightness rises with the band). Canvas colours, rgba so the map can fade them.
 */
export const CONCENTRATION_BANDS = Object.freeze([
  { key: "none", label: "None", min: 0, color: "rgba(110, 122, 138, 0.8)" },
  { key: "trace", label: "Under 10%", min: Number.MIN_VALUE, color: "rgba(123, 104, 238, 0.92)" },
  { key: "low", label: "10% to 24%", min: 0.1, color: "rgba(56, 160, 214, 0.92)" },
  { key: "mid", label: "25% to 49%", min: 0.25, color: "rgba(80, 204, 124, 0.92)" },
  { key: "high", label: "50% and over", min: 0.5, color: "rgba(253, 231, 37, 0.95)" }
]);

/** The band a concentration (0 to 1) falls in; null for a value the player cannot see. */
export function concentrationBand(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  return [...CONCENTRATION_BANDS].reverse().find((band) => v >= band.min) || CONCENTRATION_BANDS[0];
}

/** A concentration as the overlay writes it: "30%", "none", or "not scouted" for a belt it cannot see. */
export function concentrationText(value) {
  if (value === null || value === undefined) return "not scouted";
  const v = Number(value);
  if (!(v > 0)) return "none";
  const pct = v * 100;
  return `${pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`;
}

/**
 * How much of `item` an extraction on `body` yields (0 to 1), or null when the player cannot know: a belt it has not
 * scouted in this generation, or a slot with no belt. `beltSlots` is the belt-compositions route's `belts` for this
 * player; a belt's catalog composition is never read here (the public catalog no longer carries it).
 */
export function bodyConcentration(system, body, item, beltSlots = {}) {
  if (!body || !item) return null;
  if (body.type === "Field") {
    const slot = beltSlots?.[`${system?.id}:${body.id}`];
    if (!slot || !slot.present || !slot.scouted || !slot.composition) return null;
    return (Number(slot.composition[item]) || 0) / 100;
  }
  const entry = (body.resourceProfile || []).find((p) => p.item === item);
  return entry ? Number(entry.concentration) || 0 : 0;
}

/**
 * A system's best body for `item`: { best, body, unscoutedBelts }. `best` is 0 when no body the player can see yields
 * it; `unscoutedBelts` counts belts left out because they are not scouted, so the page can say the number may be low.
 */
export function systemConcentration(system, item, beltSlots = {}) {
  let best = 0;
  let bestBody = null;
  let unscoutedBelts = 0;
  for (const body of system?.bodies || []) {
    const value = bodyConcentration(system, body, item, beltSlots);
    if (value === null) {
      if (body.type === "Field" && beltSlots?.[`${system.id}:${body.id}`]?.present !== false) unscoutedBelts += 1;
      continue;
    }
    if (value > best) { best = value; bestBody = body; }
  }
  return { best, body: bestBody, unscoutedBelts };
}

/** Every item the overlay can show: what the visible profiles and this player's scouted belts yield, sorted. */
export function overlayItems(systems, beltSlots = {}) {
  const items = new Set();
  for (const system of systems || []) {
    for (const body of system.bodies || []) {
      if (body.type === "Field") continue;
      for (const p of body.resourceProfile || []) if (Number(p.concentration) > 0) items.add(p.item);
    }
  }
  for (const slot of Object.values(beltSlots || {})) {
    if (slot?.scouted && slot.composition) for (const [item, pct] of Object.entries(slot.composition)) if (Number(pct) > 0) items.add(item);
  }
  return [...items].sort((a, b) => a.localeCompare(b));
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The legend under the map: the item, each band's colour and range, and what is left out. "" when the overlay is off. */
export function concentrationLegendHtml(item) {
  if (!item) return "";
  const swatches = CONCENTRATION_BANDS.map((band) =>
    `<li><span class="starmap__band" style="background:${band.color}" aria-hidden="true"></span>${esc(band.label)}</li>`).join("");
  return `<p><strong>${esc(item)}</strong>: the best share of an extraction in each system, and on each body in a system.</p>
    <ul class="starmap__bands" aria-label="${esc(`${item} concentration bands`)}">${swatches}</ul>
    <p class="ui-panel__meta">A belt counts once you have scouted it. The share is written beside each star and body, and listed when you open a system.</p>`;
}

/**
 * A system's bodies for the details panel, best first: [{ name, type, text }]. Moons are included (the system view
 * draws planets and belts; Luna is Sol's Helium-3).
 */
export function concentrationRows(system, item, beltSlots = {}) {
  const rows = (system?.bodies || []).map((body) => ({ body, value: bodyConcentration(system, body, item, beltSlots) }));
  rows.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.body.name.localeCompare(b.body.name));
  return rows.map(({ body, value }) => ({ name: body.name, type: body.type, value, text: concentrationText(value) }));
}
