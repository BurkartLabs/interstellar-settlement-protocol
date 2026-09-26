// server/routes/helpers.js: helpers more than one route module uses, split out of server/index.js (AB#1815).
// Bug #1057: what a player can do when building slots run out, worked out from their own leases and level.
import { unleasedBodies } from "../leases.js";
import { corporationSlotsFullMessage } from "../../public/scripts/slotAdvice.js";
import { activeOfficeAt } from "../../public/scripts/officeStatus.js";
import { MILESTONE_LEVELS, addAccountNotification, mutateAccountState, saveAccountsNow } from "../gameState.js";
import { SYSTEMS_CATALOG, STATIONS_DATA } from "../travel.js";
// AB#743: defined in server/receipts.js, below the route modules, so a receipt and a refusal say credits the same way.
import { formatCredits } from "../receipts.js";
// ISP-94 (AB#784): the one build handler every build route module shares.
import { emitToAccount } from "../realtime.js";
import { leaseSlotsFullMessage } from "../../public/scripts/slotAdvice.js";
import { PLAYER_BUILDING_CATALOGUE } from "../playerBuildings.js";
import { CONSTRUCTIONS, construct } from "../construction.js";
import { RESEARCH_LIBRARY } from "../game/catalog.js";

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

// Bug #1124, moved to public/scripts/officeStatus.js by AB#1870 so the claims page can read the same rule: an
// office registers a corporation's presence at one station, not company-wide, and only while its lease has not
// lapsed. Hiring, filing a lease and operating a lease all read this same check, so an office rented somewhere
// else, or one that has expired, cannot stand in for one here.
const unleasedFor = (corp) => unleasedBodies(SYSTEMS_CATALOG, STATIONS_DATA.stations, corp);
/** The corporation-slots message for this corporation, from its leases, what it can reach and the level table. */
const corpSlotsFull = (corp) => corporationSlotsFullMessage(corp, unleasedFor(corp), MILESTONE_LEVELS);

// ─── ISP-94 (AB#784): building a player building ───────────────────────────────────────────────────────────
// POST /gameplay/build and the three old build routes are this handler; server/construction.js holds the rules, this
// says what happened, in the words each old route used.

const capitalised = (word) => String(word || "").replace(/^./, (c) => c.toUpperCase());
/** The name of the building an upgrade upgrades, from the catalogue. */
const upgradedName = (building) => PLAYER_BUILDING_CATALOGUE.find((b) => b.id === building.upgrades)?.name || "building";
const researchNames = (building) => building.researchGates.map((id) => RESEARCH_LIBRARY[id]?.name || id).join(" and ");

/** Where an old route said a refusal its own way, its words, kept so the client reads what it always read. */
const OWN_WORDS = {
  "basic-extractor-yard": {
    "no-corp-slot": (b, corp) => corpSlotsFull(corp)
  },
  "assembly-facility": {
    "missing-research": () => "Assembly & Fabrication Systems research is required before constructing an Assembly Facility.",
    "at-cap": () => "Your corporation already operates an Assembly Facility.",
    "no-corp-slot": (b, corp) => `An Assembly Facility needs a free building slot. ${corpSlotsFull(corp)}`
  },
  refinery: {
    "at-cap": (b) => `You already operate the maximum of ${b.cap.perCorporation} refineries.`,
    "no-corp-slot": (b, corp) => `A refinery needs a free building slot. ${corpSlotsFull(corp)}`
  }
};

/** What the player is told for a refusal. Nothing here repeats the request back. */
function refusalMessage(outcome, building, corp, leaseId) {
  const own = building && OWN_WORDS[building.id]?.[outcome];
  if (own) return own(building, corp);
  switch (outcome) {
    case "unknown-building": return "Choose a building from the game's list.";
    case "not-constructible": return `The ${building.name} cannot be built yet.`;
    case "no-lease-named": return `Choose one of your mining leases for the ${building.name}.`;
    case "no-lease": return "The specified lease could not be found on your account.";
    case "not-on-lease": return `The ${building.name} is not built on a lease. Build it without choosing one.`;
    case "missing-research": return `${building.name} construction requires ${researchNames(building)} research.`;
    case "at-cap":
      // ISP-97 (AB#787): an upgrade's cap is per building it upgrades.
      if (building.slot === "upgrade") return `Every ${upgradedName(building)} you have is already a ${building.name}.`;
      return `You already operate the maximum of ${building.cap.perCorporation} of the ${building.name}.`;
    case "wrong-lease": return `The ${building.name} is built only on a ${capitalised(building.lease)} lease.`; // ISP-98
    case "lease-at-cap": {
      const lease = (corp.miningLeases || []).find((l) => l.id === leaseId);
      return `Your ${lease?.body || "mining"} lease already has a ${building.name}.`;
    }
    case "nothing-to-upgrade": return `The ${building.name} upgrades a ${upgradedName(building)}: build one first.`;
    case "lease-slots-full": return leaseSlotsFullMessage(corp, (corp.miningLeases || []).find((l) => l.id === leaseId), unleasedFor(corp));
    case "no-corp-slot": return `The ${building.name} needs a free building slot. ${corpSlotsFull(corp)}`;
    // AB#2286: the price the construction charges (a yard's rises with each one built), not the catalogue's base.
    case "insufficient-credits": return fundingRequirementMessage(`${building.name} construction`, corp, CONSTRUCTIONS[building.id]?.cost ? CONSTRUCTIONS[building.id].cost(building, corp) : building.cost);
    default: return "Build action failed.";
  }
}

/** A string id from the request, trimmed, or null. The input check has already refused anything else. */
const idFrom = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The build handler. `fromRequest(req)` names the building and lease: the body for /build, fixed for an old route. */
function buildHandler(fromRequest) {
  return (req, res) => {
    const { accountId } = req.params;
    const asked = fromRequest(req);
    const buildingId = idFrom(asked.buildingId);
    const leaseId = idFrom(asked.leaseId);
    const building = PLAYER_BUILDING_CATALOGUE.find((b) => b.id === buildingId);
    let result = { outcome: "unknown-building" };

    const account = mutateAccountState(accountId, (state) => {
      result = construct(state.corp, building, leaseId);
    });
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    if (result.outcome !== "ok") {
      res.status(400).json({ error: refusalMessage(result.outcome, building, account.state.corp, leaseId) });
      return;
    }

    const { notification: words, receipt } = CONSTRUCTIONS[building.id];
    const notification = addAccountNotification(accountId, { type: "infrastructure", ...words });
    if (notification) emitToAccount(accountId, "notifications:new", { accountId, notification });
    saveAccountsNow(); // a purchase: on disk now, not at the next debounced save
    res.json({ ...account, receipt: receipt(result, account.state.corp) });
  };
}

export { activeOfficeAt, fundingRequirementMessage, formatCredits, unleasedFor, corpSlotsFull, buildHandler };
