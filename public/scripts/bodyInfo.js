// What the starmap says about a planet or moon (AB#740): only what the server's catalogue holds. A body with lease terms
// (data/systems.json leaseCost) says what a lease costs, where it is filed and what an extractor there produces; any
// other body says "Not surveyed". Nothing here is derived from a body's id: the percentages the panel used to show were
// a hash of the name (generatedComposition), and a player chose where to lease by them. The shares it shows now are the
// catalog's resource profile (AB#826), which is what a yard there mines (AB#828), worded as the lease picker words them
// (AB#829). AB#832: Kestrel and BL Ceti I lease too, and yield far more than Silicates.

import { escapeHtml } from "./html.js";
import { profileText } from "./bodyYield.js";

/** The panel's resource section for a planet or moon. `stations` are the stations in the catalogue. */
export function bodyResourceHtml(body, stations = []) {
  const cost = Number(body?.leaseCost);
  if (!(cost > 0)) {
    return `<p class="ui-panel__meta"><strong>Not surveyed.</strong> No mining data exists for ${escapeHtml(body?.name || "this body")}: it has no lease terms.</p>`;
  }
  const station = stations.find((s) => s.body === body.name);
  const filed = station ? `at ${escapeHtml(station.name)}, the station that orbits it` : "at the station that orbits it";
  // ISP-82 (AB#771): in the Starmap's design-system details panel.
  return `<div class="ui-stack">
  <p><strong>Mining lease:</strong> <span data-lease-cost="${cost}">${cost.toLocaleString("en-US")} credits</span>, filed ${filed}.</p>
  <p class="ui-panel__meta">An extractor here produces <strong data-body-yield>${escapeHtml(profileText(body.resourceProfile))}</strong>. The lease needs an office and five employees per lease.</p>
</div>`;
}
