// server/routes/fleets.js: fleet management (ISP-174, AB#868). The rules are server/fleets.js; these routes say what
// happened. A fleet id that is not one of the caller's fleets - unknown, another corporation's or malformed - gets 404
// and nothing changes, so ids cannot be probed. Names come from a fixed list; nothing here takes free text.
import { mutateAccountState, saveAccountsNow, RESEARCH_LIBRARY } from "../gameState.js";
import { NAVIGATION } from "../game/catalog.js";
import { STATION_REGISTRY } from "../travel.js";
import { UNITS } from "../game/units.js";
import { bodyNumber } from "../bodyNumber.js";
import { FLEET_NAMES, MAX_FLEETS, deployFleet, disbandFleet, formFleet, mergeFleets, splitFleet } from "../fleets.js";

const stationName = (id) => STATION_REGISTRY[id]?.name || "that station";
const whole = (v) => bodyNumber(v, { fallback: 0, min: 0, integer: true }); // Bug #1014: the one way a body number is read
const unitsOf = (body) => ({ lf: whole(body?.lf), ds: whole(body?.ds), se: whole(body?.se), at: whole(body?.at) });

function refusal(result, corp) {
  switch (result.outcome) {
    case "no-units": return "Choose at least one ship or squad of Attack Troops.";
    case "not-docked": return "Dock first: a fleet forms where your corporation is docked.";
    case "too-many-fleets": return `Your corporation commands ${MAX_FLEETS} fleets at most. Merge or disband one first.`;
    case "not-in-reserve": return `Your reserve holds ${result.have} ${UNITS[result.unitId].name}${result.have === 1 ? "" : "s"}; the rest are in fleets.`;
    case "not-in-fleet": return `That fleet holds ${result.have} ${UNITS[result.unitId].name}${result.have === 1 ? "" : "s"}.`;
    case "split-everything": return "A split leaves some units behind. To move the whole fleet, deploy it.";
    case "bad-name": return `Choose a fleet name from the list: ${FLEET_NAMES.join(", ")}.`;
    case "name-taken": return "One of your fleets already has that name. Choose another from the list.";
    case "in-transit": return "That fleet is in transit. Wait for it to arrive.";
    case "same-fleet": return "Choose a different fleet to merge into.";
    case "not-together": return "Both fleets must be at the same station to merge.";
    case "not-here": return `That fleet is at ${stationName(result.stationId)}. A fleet disbands where your corporation is docked.`;
    case "no-station": return "Choose where to deploy it.";
    case "already-there": return "That fleet is already stationed there.";
    case "missing-research": return NAVIGATION.travelResearchLock(RESEARCH_LIBRARY, corp.unlockedTech, corp.level, result.fromSystemId, result.toSystemId) || "That system needs navigation research first.";
    case "no-route": return "No jump route reaches that system from where the fleet is.";
    default: return "The fleet order could not be carried out.";
  }
}

/** One handler per order: `order(corp, req)` returns the result; a missing fleet answers 404, other refusals 400. */
function fleetRoute(order) {
  return (req, res) => {
    let result = { outcome: "no-fleet" };
    const account = mutateAccountState(req.params.accountId, (state) => { result = order(state.corp, req); });
    if (!account) { res.status(404).json({ error: "Account not found." }); return; }
    if (result.outcome === "no-fleet") { res.status(404).json({ error: "That fleet is not one of yours." }); return; }
    if (result.outcome !== "ok") { res.status(400).json({ error: refusal(result, account.state.corp) }); return; }
    saveAccountsNow();
    res.json({ ...account, fleet: result.fleet || null, part: result.part || null });
  };
}

export function registerFleetRoutes(app) {
  app.post("/api/accounts/:accountId/gameplay/fleets/form", fleetRoute((corp, req) => formFleet(corp, { units: unitsOf(req.body), name: req.body?.name })));
  app.post("/api/accounts/:accountId/gameplay/fleets/:fleetId/split", fleetRoute((corp, req) => splitFleet(corp, req.params.fleetId, { units: unitsOf(req.body), name: req.body?.name })));
  app.post("/api/accounts/:accountId/gameplay/fleets/:fleetId/merge", fleetRoute((corp, req) => mergeFleets(corp, req.params.fleetId, String(req.body?.intoFleetId || ""))));
  app.post("/api/accounts/:accountId/gameplay/fleets/:fleetId/deploy", fleetRoute((corp, req) => deployFleet(corp, req.params.fleetId, String(req.body?.toStationId || ""))));
  app.post("/api/accounts/:accountId/gameplay/fleets/:fleetId/disband", fleetRoute((corp, req) => disbandFleet(corp, req.params.fleetId)));
}
