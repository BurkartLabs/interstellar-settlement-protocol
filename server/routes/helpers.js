// server/routes/helpers.js: helpers more than one route module uses, split out of server/index.js (AB#1815).
// Bug #1057: what a player can do when building slots run out, worked out from their own leases and level.
import { unleasedBodies } from "../leases.js";
import { corporationSlotsFullMessage } from "../../public/scripts/slotAdvice.js";
import { MILESTONE_LEVELS } from "../gameState.js";
import { SYSTEMS_CATALOG, STATIONS_DATA } from "../travel.js";

function formatCredits(amount) {
  return `${Math.round(Number(amount || 0)).toLocaleString("en-US")} credits`;
}

function fundingRequirementMessage(actionLabel, corp, requiredCredits, extra = "") {
  const parts = [
    `${actionLabel} requires ${formatCredits(requiredCredits)}.`,
    `Current reserves: ${formatCredits(corp.finances.credits)}.` // Bug #1201: formatCredits already says "credits"
  ];

  if (extra) {
    parts.push(extra);
  }

  return parts.join(" ");
}

// Bug #1124: an office registers a corporation's presence at one station, not company-wide, and only while its
// lease has not lapsed. Hiring, filing a lease and operating a lease all read this same check, so an office
// rented somewhere else, or one that has expired, cannot stand in for one here.
function activeOfficeAt(corp, stationId, now = Date.now()) {
  if (!stationId || !Array.isArray(corp.offices)) return null;
  return corp.offices.find((o) => o.stationId === stationId && o.rentedUntil > now) || null;
}
const unleasedFor = (corp) => unleasedBodies(SYSTEMS_CATALOG, STATIONS_DATA.stations, corp);
/** The corporation-slots message for this corporation, from its leases, what it can reach and the level table. */
const corpSlotsFull = (corp) => corporationSlotsFullMessage(corp, unleasedFor(corp), MILESTONE_LEVELS);

export { activeOfficeAt, fundingRequirementMessage, formatCredits, unleasedFor, corpSlotsFull };
