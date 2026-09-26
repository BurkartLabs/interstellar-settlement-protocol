// Where a level milestone card sends the player (AB#1061).
//
// Most requirements are done on one tab, and the card says "Go to <Tab>". A lease on a body is different: it is filed
// at the station that orbits that body, so from anywhere else the card has to say where to travel, or it leads to a
// claims office that cannot offer it. The body comes from the milestone's own metric ("miningLease:Mars"), so a new
// lease milestone needs no change here.
import { leaseStationFor } from "./navigation.js";
import { TAB_LABELS } from "./navGroups.js"; // ISP-83 (AB#772): the tab's name as the navigation shows it

/**
 * { tab, label, hint? } for a requirement card, or null when it has nowhere to go. `defaultTab` is the tab the
 * requirement is done on in general (REQ_TAB in app.js).
 */
export function requirementLink(req, currentStationId, stations, defaultTab) {
  const body = /^miningLease:(.+)$/.exec(String(req?.metric || ""))?.[1];
  const office = body ? leaseStationFor(stations, body) : null;
  if (office && office.id !== currentStationId) {
    return {
      tab: "starmap",
      label: `Travel to ${office.name} →`,
      hint: `Leases on ${office.body} are filed at ${office.name}. Travel there on the Starmap, then open its ISA Claims & Leases Division.`
    };
  }
  const tab = office ? "station" : defaultTab;
  return tab ? { tab, label: `Go to ${TAB_LABELS[tab] || tab} →` } : null;
}
