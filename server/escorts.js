// AB#821 (docs/design/rats.md, sections 3 and 7): which fleets can escort an expedition, why the others cannot, and what
// each would do, from the rules launch-expedition applies. One copy of the rules: the launch route refuses with these,
// and the launch panel shows them before the player commits.
import { forceSupply, launchOutlook, nominalHours } from "./game/rats.js";
import { SYSTEMS_BY_ID } from "./game/catalog.js";
import { stationById } from "./game/stations.js";
import { combatModifiersFor } from "./game/combat.js";
import { hiredEscortFor } from "./hiredEscort.js"; // AB#4678
import { getAccountById } from "./gameState.js";
import { accountIdOfCorp } from "./playerLoans.js";
import { rateFactorFor } from "./hunts.js"; // AB#991: a belt a hunt cleared is quiet

/** What launch-expedition says when it refuses an escort, by outcome. */
export const ESCORT_REFUSALS = {
  "no-such-fleet": "Choose one of your own fleets to escort the probe.",
  "escort-contracted": "That fleet is offered or hired out, and takes no order until its contract ends.",
  "escort-busy": "That fleet is already escorting an expedition.",
  "escort-hunting": "That fleet is hunting Rats until it comes back.", // AB#991
  "escort-travelling": "That fleet is travelling. Escort with it once it has arrived.",
  "escort-elsewhere": "An escort must be stationed in the belt's system. Deploy the fleet there first.",
  "escort-empty": "That fleet has no units to escort with.",
  // AB#4678: a hired escort
  "no-such-contract": "Choose one of the fleets you have hired to escort the probe.",
  "escort-not-permitted": "That contract does not permit escorting: only a contract for pve or raids does."
};

const systemOf = (stationId) => stationById(stationId)?.systemId;
const unitsOf = (units) => Object.fromEntries(Object.entries(units || {}).filter(([, n]) => Number(n) > 0));

/** One of the corporation's own fleets as the escort, checked as section 3 says. { escort: { fleetId, units } } or { outcome }. */
export function ownEscortFor(corp, fleetId, beltSystemId, now = Date.now()) {
  const fleet = (corp?.military?.fleets || []).find((f) => f.id === fleetId);
  if (!fleet) return { outcome: "no-such-fleet" }; // not the caller's: never looked up anywhere else
  if (fleet.contract) return { outcome: "escort-contracted" };
  if (fleet.escort) return { outcome: "escort-busy" };
  if (fleet.hunt) return { outcome: "escort-hunting" }; // AB#991
  if (fleet.transit && now < fleet.transit.arrivesAt) return { outcome: "escort-travelling" };
  if (systemOf(fleet.stationId) !== beltSystemId) return { outcome: "escort-elsewhere" };
  if (!forceSupply(fleet.units)) return { outcome: "escort-empty" };
  return { escort: { fleetId: fleet.id, units: unitsOf(fleet.units) } };
}

/** A hired fleet as the escort (server/hiredEscort.js), with the same shape of answer. */
export function hiredEscortOption(corp, contractId, beltSystemId, now = Date.now()) {
  const pick = hiredEscortFor(corp, contractId, beltSystemId, systemOf, now);
  if (pick.outcome) return pick;
  if (!forceSupply(pick.escort.units)) return { outcome: "escort-empty" };
  return pick;
}

/**
 * The launch panel's figures for a belt and a length (section 7): the danger without an escort, and every fleet the
 * corporation could name, its own and those it has hired, each with the figures it would give or the reason it cannot
 * escort. The figures are launchOutlook's, the same functions the tick resolves encounters with. A hired fleet's are
 * worked with its owner's combat modifiers, as it fights (server/hiredEscort.js).
 */
export function expeditionOutlook(corp, beltKey, duration, now = Date.now()) {
  const modifiersOfOwner = (ownerCorpId) => combatModifiersFor(getAccountById(accountIdOfCorp(ownerCorpId))?.state?.corp);
  const beltSystemId = beltKey.split(":")[0];
  const density = Number(SYSTEMS_BY_ID.get(beltSystemId)?.pirateDensity);
  if (!Number.isFinite(density) || density < 0) return null;
  const hours = nominalHours(duration);
  const rateFactor = rateFactorFor(beltKey, now); // the factor launch fixes on the expedition
  const none = launchOutlook(density, hours, null, {}, rateFactor);
  const option = (base, pick, modifiers) => (pick.outcome
    ? { ...base, eligible: false, why: ESCORT_REFUSALS[pick.outcome] }
    : { ...base, eligible: true, units: pick.escort.units, ...launchOutlook(density, hours, pick.escort.units, modifiers, rateFactor) });
  const own = (corp?.military?.fleets || []).map((f) => option(
    { kind: "own", id: f.id, name: f.name || f.id }, ownEscortFor(corp, f.id, beltSystemId, now), combatModifiersFor(corp)));
  const hired = (corp?.military?.hired || []).map((h) => {
    const pick = hiredEscortOption(corp, h.contractId, beltSystemId, now);
    return option({ kind: "hired", id: h.contractId, name: h.fleetName || "Hired fleet" }, pick, pick.escort ? modifiersOfOwner(pick.escort.ownerCorpId) : {});
  });
  return {
    beltKey, duration, hours, density, quiet: rateFactor < 1,
    unescorted: { chance: none.chance, keptShare: none.keptShare },
    escorts: [...own, ...hired]
  };
}
