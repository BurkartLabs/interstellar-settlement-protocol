// ISP-218 (AB#913): the Starmap's dominance overlays, as data and HTML. Pure: no DOM (the palette's colours are read
// through a function the caller passes), so node tests read it. public/scripts/starmap.js draws what this decides.
//
// The reading is GET /api/starmap/dominance (ISP-217, AB#912): per system, the top three by corporation and by
// conglomerate, rounded, and "others". Each system is coloured by its leader. Colours come from the design system's
// series tokens and every one is named in the legend (never colour alone); the viewer's own corporation or conglomerate
// always takes the first token and is named "you" in the legend and the details panel.

import { escapeHtml } from "./html.js";
import { utcTime } from "./timeFormat.js";

/** The two overlays, as the #map-overlay select names them. */
export const DOMINANCE_OVERLAYS = {
  "corp-dominance": { label: "Corporate dominance", view: "byCorporation", noun: "corporation" },
  "cong-dominance": { label: "Conglomerate dominance", view: "byConglomerate", noun: "conglomerate" }
};
export const isDominanceOverlay = (overlay) => Object.hasOwn(DOMINANCE_OVERLAYS, overlay);

/** The viewer's own leader colour, then one per other leader, then everyone else and the quiet systems. */
export const OWN_TOKEN = "--series-1";
// Hues a viewer can tell apart on the dark map: green, amber and rose; cyan is the viewer's own, grey everyone else.
export const LEADER_TOKENS = ["--series-2", "--series-3", "--series-4"];
export const OTHER_TOKEN = "--series-5";
export const QUIET_TOKEN = "--surface-3";

/**
 * Which colour each system takes, and the legend that names them: { bySystem: { id: { key, token, leader, share } },
 * legend: [{ key, token, label, systems, own }] }. Leaders other than the viewer take the palette in order of how many
 * systems they lead (then by name), so the same reading always gives the same colours; any beyond the palette share
 * "Other leaders".
 */
export function dominanceKey(reading, overlay, ownName = "") {
  const spec = DOMINANCE_OVERLAYS[overlay];
  const bySystem = {};
  if (!spec || !reading?.systems) return { bySystem, legend: [] };
  const led = new Map();
  for (const [id, s] of Object.entries(reading.systems)) {
    const top = s?.activity ? s[spec.view]?.leaders?.[0] : null;
    if (top) led.set(top.name, (led.get(top.name) || 0) + 1);
  }
  const own = ownName && led.has(ownName) ? ownName : "";
  const others = [...led.keys()].filter((n) => n !== own).sort((a, b) => led.get(b) - led.get(a) || a.localeCompare(b));
  const slot = new Map(others.slice(0, LEADER_TOKENS.length).map((name, i) => [name, LEADER_TOKENS[i]]));
  const legend = [];
  if (own) legend.push({ key: `leader:${own}`, token: OWN_TOKEN, label: own, systems: led.get(own), own: true });
  for (const [name, token] of slot) legend.push({ key: `leader:${name}`, token, label: name, systems: led.get(name), own: false });
  const rest = others.slice(LEADER_TOKENS.length);
  if (rest.length) legend.push({ key: "other", token: OTHER_TOKEN, label: `Other leaders (${rest.length})`, systems: rest.reduce((n, name) => n + led.get(name), 0), own: false });
  let quiet = 0;
  for (const [id, s] of Object.entries(reading.systems)) {
    const top = s?.activity ? s[spec.view]?.leaders?.[0] : null;
    if (!top) { quiet += 1; bySystem[id] = { key: "quiet", token: QUIET_TOKEN, leader: null, share: 0 }; continue; }
    const token = top.name === own ? OWN_TOKEN : slot.get(top.name) || OTHER_TOKEN;
    bySystem[id] = { key: slot.has(top.name) || top.name === own ? `leader:${top.name}` : "other", token, leader: top.name, share: top.share, own: top.name === own };
  }
  if (quiet) legend.push({ key: "quiet", token: QUIET_TOKEN, label: "No activity in the last 7 days", systems: quiet, own: false });
  return { bySystem, legend };
}

/** A hex colour (#rgb or #rrggbb) as the rgba() string the canvas code expects; a fallback for anything else. */
export function tokenRgba(hex, alpha = 0.92) {
  const h = String(hex || "").trim().replace(/^#/, "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return `rgba(174, 189, 201, ${alpha})`;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The legend under the map: a swatch and a name for every colour shown, and how many systems it leads. */
export function dominanceLegendHtml(key, overlay, { computedAt } = {}) {
  const spec = DOMINANCE_OVERLAYS[overlay];
  if (!spec) return "";
  if (!key.legend.length) return `<p class="ui-panel__meta">No dominance reading yet. It is computed at 00:00 UTC each day.</p>`;
  const when = computedAt ? ` Computed ${utcTime(computedAt, { withDate: true })}, over the 7 days before.` : ""; // ISP-249 (AB#945)
  return `<p class="starmap__subhead">${escapeHtml(spec.label)}: each system in its leading ${spec.noun}'s colour.${when}</p>
    <ul class="dominance-legend" data-dominance-legend>${key.legend.map((e) => `
      <li class="dominance-legend__item${e.own ? " dominance-legend__item--own" : ""}" data-legend-key="${escapeHtml(e.key)}"><span class="dominance-legend__swatch dominance-swatch--${e.token.slice(2)}" aria-hidden="true"></span><span>${e.own ? `<strong>You: ${escapeHtml(e.label)}</strong>` : escapeHtml(e.label)} · ${e.systems} system${e.systems === 1 ? "" : "s"}</span></li>`).join("")}
    </ul>
    ${key.legend.some((e) => e.own) ? `<p class="ui-panel__meta">A ring in your colour (cyan) marks each system your ${spec.noun} leads; a thin grey ring is a system you cannot jump to yet.</p>` : ""}`;
}

/** A system's panel section: the top three with their shares, and others, or that nothing happened there. */
export function dominanceDetailsHtml(systemReading, overlay, ownName = "") {
  const spec = DOMINANCE_OVERLAYS[overlay];
  if (!spec) return "";
  const view = systemReading?.activity ? systemReading[spec.view] : null;
  if (!view?.leaders?.length) {
    return `<h4 class="starmap__subhead">${escapeHtml(spec.label)}</h4><p class="ui-panel__meta" data-dominance-details>No leases, mining or sales here in the last 7 days.</p>`;
  }
  const rows = view.leaders.map((l, i) => `<li${l.name === ownName ? ' class="dominance-details__own"' : ""}><span>${i + 1}. ${escapeHtml(l.name)}${l.name === ownName ? " (you)" : ""}</span><strong>${l.share}%</strong></li>`).join("");
  const others = view.others > 0 ? `<li class="dominance-details__others"><span>Others</span><strong>${view.others}%</strong></li>` : "";
  return `<h4 class="starmap__subhead">${escapeHtml(spec.label)}</h4>
    <ol class="dominance-details" data-dominance-details>${rows}${others}</ol>
    <p class="ui-panel__meta">Shares of leases, tonnes mined and sales here over the last 7 days, rounded to 5%.</p>`;
}
