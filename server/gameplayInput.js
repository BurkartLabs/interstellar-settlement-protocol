// server/gameplayInput.js
// Hostile input on every route that changes state (AB#731 for /gameplay, AB#732 for the market, account and forum
// routes). Every such route is described here: each number is a whole number in a stated range, and each id is in the catalog it names or in the
// caller's own state. One middleware checks a request against its entry before any handler runs, so a refusal (400)
// never follows a partial write. Messages say what to enter and never repeat the request back.
//
// tests/integration/gameplay-input.test.js enumerates the routes Express has registered and fails if one is missing
// here, then posts "abc", NaN, Infinity, -5, 0, 2.5, a missing field and a 10,000-character string to every field.

import { yardMaxTier, yardTierFor } from "./economy.js";
import { MAX_RUN_HOURS } from "../public/scripts/refineryRun.js"; // AB#825
import { FLEET_NAMES } from "./fleets.js"; // ISP-174 (AB#868)
import { POSTURE_IDS } from "./garrison.js"; // ISP-180 (AB#874)
import { CONGLOMERATE_CATALOG } from "./conglomerates.js"; // ISP-197 (AB#891)
import { BOND_TERMS } from "./bondTerms.js"; // ISP-154 (AB#848)
import { CLAIM_TYPES, WARFARE_CATALOG } from "./warfare.js"; // ISP-230 (AB#925); CLAIM_TYPES: ISP-241 (AB#937)

/** The highest cap any yard tier has (AB#793): what start-mining accepts before the route clamps to the yard's own. */
const TOP_THROUGHPUT_CAP = yardTierFor(yardMaxTier()).throughputCap;

/** Longer than any id or name the game uses; anything longer is refused unread. */
export const MAX_ID_LENGTH = 64;
/** Lines one transfer may carry (AB#717). */
const MAX_TRANSFER_LINES = 10;

const int = (min, max, label, extra = {}) => ({ kind: "int", min, max, label, ...extra });
const choice = (values, label, extra = {}) => ({ kind: "choice", values, label, ...extra });
/** ISP-152 (AB#846): a number from `min` to `max` in steps of `step` (a loan offer's rate, 2.0 to 25.0 by 0.25). */
const decimal = (min, max, step, label, extra = {}) => ({ kind: "decimal", min, max, step, label, ...extra });
export const onStep = (n, spec) => typeof n === "number" && Number.isFinite(n) && n >= spec.min && n <= spec.max && Math.abs(n / spec.step - Math.round(n / spec.step)) < 1e-9;
const id = (catalog, label, extra = {}) => ({ kind: "id", catalog, label, ...extra });
/** Free text: a string of at most `max` characters (AB#732). The client's own maxlength is the same. */
const text = (max, label, extra = {}) => ({ kind: "text", max, label, ...extra });
/** One of a fixed list of words. */
const word = (values, label, extra = {}) => ({ kind: "word", values, label, ...extra });
/**
 * An id the route itself looks up and answers 404 for when it is not found (a message, a draft, a notification, a
 * forum thread, an order), without changing anything. Checked here for shape only: a string of sensible length.
 */
const ref = (label, extra = {}) => ({ kind: "ref", label, ...extra });

// Accepting takes a contract from the Bureau's list; abandoning or completing one takes it from the caller's own.
const ACCEPT_MISSION = { body: { missionId: id("missions", "a contract") } };
const OWN_MISSION = { body: { missionId: id("ownMissions", "one of your active contracts") } };
const NOTHING = {};
/** ISP-174 (AB#868): how many of each fleet unit type an order moves; each optional, the route refuses none at all. */
const FLEET_UNITS = Object.fromEntries(["lf", "ds", "se", "at"].map((u) => [u, int(1, 100_000, "a number of units from 1 to 100,000", { optional: true })]));

/**
 * Every gameplay route, keyed "METHOD /path" below the /gameplay mount. `optional: true` marks the few fields the
 * game's own client leaves out, where the route has a default; they are still checked whenever they are sent.
 */
export const GAMEPLAY_INPUT = {
  "POST /hire": { body: { count: int(1, 1000, "the number of employees to hire") } },
  "POST /rent-office": {
    body: {
      stationId: id("stations", "a station"),
      // The client sends no length on a first lease; the route leases for 7 days.
      durationDays: choice([7, 14, 21, 28], "a lease length of 7, 14, 21 or 28 days", { optional: true })
    }
  },
  "POST /renew-office": {
    body: { stationId: id("stations", "a station"), durationDays: choice([7, 14, 21, 28], "a lease length of 7, 14, 21 or 28 days") }
  },
  "POST /purchase-lease": { body: { body: id("leaseBodies", "a celestial body the ISA leases") } },
  "POST /transfer-resources": { custom: "transfer" },
  "GET /shipments": NOTHING,
  "GET /shipments/:shipmentId": { params: { shipmentId: ref("a shipment") } },
  "POST /travel": { oneOf: { toSystemId: id("systems", "a star system"), toStationId: id("stations", "a station") } },
  "POST /lease/:leaseId/build-extractor": { params: { leaseId: id("ownLeases", "one of your mining leases") } },
  // ISP-101 (AB#793): an id that is not one of the caller's buildings - unknown, another corporation's, or malformed -
  // gets this one answer, so ids cannot be probed.
  "POST /buildings/:buildingId/upgrade": { params: { buildingId: id("ownBuildings", "one of your buildings") } },
  "POST /lease/:leaseId/start-mining": {
    params: { leaseId: id("ownLeases", "one of your mining leases") },
    body: {
      // AB#793: a tier raises a yard's cap, at most to the last tier's; the route clamps to the yard's own cap.
      amount: int(10, TOP_THROUGHPUT_CAP, `a throughput from 10 to ${TOP_THROUGHPUT_CAP} tons per hour`),
      hours: int(1, 72, "a cycle length from 1 to 72 hours"),
      extractorId: id("ownExtractors", "one of your extractors")
    }
  },
  "POST /lease/:leaseId/stop-mining": {
    params: { leaseId: id("ownLeases", "one of your mining leases") },
    body: { extractorId: id("ownExtractors", "one of your extractors") }
  },
  "POST /build-assembly-facility": NOTHING,
  "POST /build-mining-probe": NOTHING,
  "POST /build-refinery": NOTHING,
  // ISP-94 (AB#784): the one build route. A lease only for a building that stands on one; the route refuses the rest.
  "POST /build": {
    body: {
      buildingId: id("playerBuildings", "a building from the construction list"),
      leaseId: id("ownLeases", "one of your mining leases", { optional: true })
    }
  },
  "GET /belt-compositions": NOTHING,
  "POST /scout-belt": { body: { beltKey: id("belts", "an asteroid belt") } },
  "POST /launch-expedition": {
    body: {
      beltKey: id("belts", "an asteroid belt"), duration: id("expeditionDurations", "an expedition length"),
      escortFleetId: ref("one of your fleets", { optional: true }) // AB#820: the rules check it is the caller's own
    }
  },
  "POST /start-refinery": {
    body: {
      refineryId: id("ownRefineries", "one of your refineries or your Synthesis Array"), // ISP-189 (AB#883): either facility
      chainId: id("refineryChains", "a refinery chain"),
      // AB#825: a run is `inputQuantity` of a one-input chain's input, or `batches` of any chain; the route refuses
      // neither or both, and a run longer than a week (public/scripts/refineryRun.js).
      inputQuantity: int(1, 10_000_000, "an input quantity of at least 1", { optional: true }),
      batches: int(1, MAX_RUN_HOURS, `a number of batches from 1 to ${MAX_RUN_HOURS}`, { optional: true })
    }
  },
  "POST /accept-mission": ACCEPT_MISSION,
  "POST /abandon-mission": OWN_MISSION,
  "POST /complete-mission": OWN_MISSION,
  "POST /queue-rnd": { body: { techId: id("techs", "a research project") } },
  // ISP-171 (AB#865): a ship from the unit catalog and how many; the cost and the time are the catalog's, never sent
  "POST /shipyard/queue": { body: { unitId: id("ships", "a ship: a Light Fighter, a Destroyer or a Siege Engine"), quantity: int(1, 100, "a quantity from 1 to 100") } },
  "POST /shipyard/cancel": { body: { jobId: ref("one of your shipyard jobs") } },
  // ISP-172 (AB#866): troops from the unit catalog and how many squads; the cost and the time are the catalog's
  "POST /training/queue": { body: { unitId: id("troops", "troops: Attack Troops or Defense Troops"), quantity: int(1, 100, "a number of squads from 1 to 100") } },
  "POST /training/cancel": { body: { jobId: ref("one of your training jobs") } },
  // ISP-174 (AB#868): fleets. Counts are whole numbers; a name is one of the list's, never free text; a fleet id that
  // is not the caller's is the route's 404.
  "POST /fleets/form": { body: { ...FLEET_UNITS, name: word(FLEET_NAMES, "a fleet name from the list", { optional: true }) } },
  "POST /fleets/:fleetId/split": { params: { fleetId: ref("one of your fleets") }, body: { ...FLEET_UNITS, name: word(FLEET_NAMES, "a fleet name from the list", { optional: true }) } },
  "POST /fleets/:fleetId/merge": { params: { fleetId: ref("one of your fleets") }, body: { intoFleetId: ref("one of your fleets to merge into") } },
  "POST /fleets/:fleetId/deploy": { params: { fleetId: ref("one of your fleets") }, body: { toStationId: id("stations", "a station") } },
  "POST /fleets/:fleetId/disband": { params: { fleetId: ref("one of your fleets") } },
  "GET /fleets/:fleetId/destinations": { params: { fleetId: ref("one of your fleets") } }, // ISP-175 (AB#869)
  // ISP-176 (AB#870): mercenary contracts. Terms are numbers and enums only; ids not the caller's are the route's 404.
  "GET /mercenaries": NOTHING,
  "GET /mercenaries/mine": NOTHING, // ISP-177 (AB#871)
  "POST /mercenaries/offer": {
    body: {
      fleetId: ref("one of your fleets"),
      termHours: choice([12, 24, 72, 168], "a term of 12, 24, 72 or 168 hours"),
      price: int(100, 10_000_000, "a price from 100 to 10,000,000 credits"),
      collateral: int(1, 1_000_000_000, "a collateral of at least 1 credit, up to the fleet's value"),
      allowedUse: word(["defense", "pve", "raids"], "an allowed use: defense, pve or raids")
    }
  },
  "POST /mercenaries/:offerId/withdraw": { params: { offerId: ref("one of your mercenary offers") } },
  "POST /mercenaries/:offerId/hire": { params: { offerId: ref("a mercenary offer") } },
  // ISP-178 (AB#872): a raid names a fleet (own, or hired by contract), a target corporation by public id, and a station
  "GET /raids": NOTHING,
  "POST /raids": {
    body: {
      fleetId: ref("one of your fleets", { optional: true }),
      contractId: ref("a fleet you have hired", { optional: true }),
      targetCorpId: ref("a corporation to raid"),
      targetStationId: id("stations", "a station")
    }
  },
  "POST /raids/:raidId/recall": { params: { raidId: ref("one of your raids") } },
  "GET /raids/:raidId/report": { params: { raidId: ref("one of your raids") } }, // ISP-179 (AB#873)
  "GET /raids/targets/:stationId": { params: { stationId: id("stations", "a station") } }, // ISP-181 (AB#875)
  // ISP-180 (AB#874): a garrison's posture, troops sent between stations, a hired fleet sent to one's own holdings
  "POST /garrisons/:stationId/posture": { params: { stationId: id("stations", "a station") }, body: { posture: word(POSTURE_IDS, "a posture: balanced, fortified or aggressive") } },
  "POST /garrisons/move": { body: { fromStationId: id("stations", "a station"), toStationId: id("stations", "a station"), quantity: int(1, 100_000, "a number of defense troops") } },
  "POST /mercenaries/:contractId/deploy": { params: { contractId: ref("a fleet you have hired") }, body: { toStationId: id("stations", "a station") } },
  "POST /queue-ceo": { body: { programId: id("programs", "a CEO Insight program") } }
};

/** Routes under /api/accounts/:accountId outside /gameplay (AB#732): the caller's account, notifications and mail. */
export const ACCOUNT_INPUT = {
  "GET /": NOTHING,
  "POST /walkthrough-complete": NOTHING,
  "POST /walkthrough-reset": NOTHING,
  "GET /notifications": NOTHING,
  // AB#713: numbers are clamped to 1..90 by the route and anything else refused there, so this only bounds the length.
  "GET /finances/statements": { query: { days: text(12, "a number of days from 1 to 90", { optional: true }) } },
  "POST /notifications/read-all": NOTHING,
  "POST /notifications/:notificationId/read": { params: { notificationId: ref("a notification") } },
  "GET /messages": NOTHING,
  "GET /corporations": { query: { name: text(64, "a corporation name to search for", { optional: true }) } },
  "GET /dominance": NOTHING, // ISP-217 (AB#912): the caller's own dominance components
  // ISP-230 (AB#925): a holder's tariff, 0 to the highest cap any system has, in the catalog's steps; the system's own
  // cap and whether the caller holds it are the route's (400 and 403)
  "GET /tariffs": NOTHING, // ISP-231 (AB#926): the caller's own tariffs
  "GET /standing": NOTHING, // ISP-238 (AB#933): the caller's own faction standing
  // ISP-239 (AB#934): open a campaign, and pledge to one; lobbyable, concedable, in bounds and held are the route's (400/403/409)
  "GET /lobbying": NOTHING, // ISP-240 (AB#935): the caller's lobbying office
  "POST /lobbying": { body: { parameter: text(40, "a lobbyable parameter"), systemId: ref("a system"), direction: word(["raise", "lower"], "raise or lower") } },
  "POST /lobbying/:campaignId/pledges": { params: { campaignId: ref("a campaign") }, body: { side: word(["for", "against"], "for or against"), credits: int(0, 1_000_000_000, "whole credits", { optional: true }), standing: decimal(0, 100, 0.01, "standing points", { optional: true }) } },
  "GET /itc/:item": { params: { item: ref("an item") } }, // ISP-233 (AB#928): the ITC's watch as it applies to the caller
  "POST /tariffs/:systemId": { params: { systemId: ref("a system") }, body: { pct: decimal(0, WARFARE_CATALOG.tariffs.maxPct, WARFARE_CATALOG.tariffs.stepPct, "a tariff in percentage points") } },
  // ISP-149 (AB#843): the product and principal to quote, and the quote to accept; the terms are the server's
  "GET /loans/offers": NOTHING, // ISP-151 (AB#845)
  "POST /loans/quote": { body: { productId: word(["dsdb-7", "dsdb-30", "dsdb-90"], "a Development Bank loan product"), principal: int(1_000, 100_000_000, "a principal of at least 1,000 credits") } },
  "POST /loans/accept": { body: { quoteId: ref("a loan quote") } },
  "POST /loans/:loanId/payoff": { params: { loanId: ref("one of your loans") } }, // ISP-150 (AB#844)
  // ISP-154 (AB#848): a bond series' terms, each a number from the design's list; and the units to subscribe to
  "GET /bonds": NOTHING,
  "POST /bonds/issue": {
    body: {
      quantity: int(BOND_TERMS.minQuantity, BOND_TERMS.maxQuantity, "a number of 1,000-credit units"),
      couponPct30: decimal(BOND_TERMS.minCouponPct30, BOND_TERMS.maxCouponPct30, BOND_TERMS.couponStepPct30, "a coupon per 30 days"),
      maturityDays: choice(BOND_TERMS.maturityDays, "a maturity of 30, 60 or 90 days"),
      windowHours: choice(BOND_TERMS.windowHours, "24 or 48 hours open for subscribing")
    }
  },
  "POST /bonds/preview": { // ISP-156 (AB#850): the issue form's preview, with the issue's own checks
    body: {
      quantity: int(BOND_TERMS.minQuantity, BOND_TERMS.maxQuantity, "a number of 1,000-credit units"),
      couponPct30: decimal(BOND_TERMS.minCouponPct30, BOND_TERMS.maxCouponPct30, BOND_TERMS.couponStepPct30, "a coupon per 30 days"),
      maturityDays: choice(BOND_TERMS.maturityDays, "a maturity of 30, 60 or 90 days")
    }
  },
  // ISP-158 (AB#852): listing takes nothing; an offering and a purchase take a whole number of shares, never a price
  "GET /equity/offerings": NOTHING,
  "POST /equity/list": NOTHING,
  "POST /equity/offerings": { body: { quantity: int(100, 90_000, "a number of shares to offer, at least 100") } },
  "POST /equity/payout-ratio": { body: { payoutRatioPct: choice(Array.from({ length: 17 }, (_, i) => i * 5), "a payout ratio of 0 to 80%, in steps of 5") } }, // ISP-159 (AB#853)
  "POST /equity/offerings/:offeringId/buy": { params: { offeringId: ref("a share offering") }, body: { quantity: int(1, 90_000, "a number of shares") } },
  "GET /equity/holdings": NOTHING, // ISP-160 (AB#854)
  "POST /equity/holdings/:issuerCorpId/exit": { params: { issuerCorpId: ref("a corporation you hold shares in") }, body: { quantity: int(1, 90_000, "a number of shares") } },
  "POST /bonds/:seriesId/subscribe": { params: { seriesId: ref("a bond series") }, body: { units: int(1, BOND_TERMS.maxQuantity, "a number of units") } },
  // ISP-152 (AB#846): player loan offers. Numbers and enums only; the floor rate and the per-pair cap are the route's too.
  "GET /loan-offers": NOTHING,
  "GET /player-loans": NOTHING, // ISP-153 (AB#847)
  "POST /loan-offers": {
    body: {
      principal: int(1_000, 100_000, "a principal from 1,000 to 100,000 credits"),
      ratePct30: decimal(2, 25, 0.25, "a rate per 30 days"),
      termDays: choice([7, 30, 90], "a term of 7, 30 or 90 days"),
      minGrade: word(["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "CC", "C", "NR-accepted"], "the lowest credit grade you will lend to")
    }
  },
  "POST /loan-offers/:offerId/cancel": { params: { offerId: ref("one of your loan offers") } },
  "POST /loan-offers/:offerId/accept": { params: { offerId: ref("a loan offer") } },
  // ISP-197 (AB#891): the charter. The name is checked by the route against the corporation-name rules (3 to 40
  // characters); this bounds what reaches it. Emblem and colour are numbered from 1 in the Bureau's fixed lists.
  "POST /conglomerates": {
    body: {
      name: text(64, "a conglomerate name of 3 to 40 characters"),
      emblem: choice(Array.from({ length: CONGLOMERATE_CATALOG.emblems }, (_, i) => i + 1), "an emblem from the Bureau's list"),
      colour: choice(Array.from({ length: CONGLOMERATE_CATALOG.colours }, (_, i) => i + 1), "a colour from the Bureau's list")
    }
  },
  // ISP-198 (AB#892): membership. Every id is looked up by the route, which answers 404 for one the caller cannot see; the
  // answer is one of three words, and which side may give which is the rules' check.
  "GET /conglomerate": NOTHING,
  "POST /conglomerates/:conglomerateId/invitations": { params: { conglomerateId: ref("a conglomerate") }, body: { corpId: ref("a corporation to invite") } },
  "POST /conglomerates/:conglomerateId/invitations/:invitationId/:answer": {
    params: { conglomerateId: ref("a conglomerate"), invitationId: ref("an invitation"), answer: word(["accept", "decline", "withdraw"], "accept, decline or withdraw") }
  },
  "POST /conglomerates/:conglomerateId/applications": { params: { conglomerateId: ref("a conglomerate") } },
  "POST /conglomerates/:conglomerateId/applications/:applicationId/:answer": {
    params: { conglomerateId: ref("a conglomerate"), applicationId: ref("an application"), answer: word(["accept", "decline", "withdraw"], "accept, decline or withdraw") }
  },
  "POST /conglomerates/:conglomerateId/leave": { params: { conglomerateId: ref("a conglomerate") } },
  "POST /concessions/:systemId/petition": { params: { systemId: ref("a system") } }, // ISP-227 (AB#922)
  "POST /concessions/:systemId/relinquish": { params: { systemId: ref("a system") } },
  // ISP-235 (AB#930): the route checks the subject is patentable and the rate is inside its kind's own bound.
  "POST /patents": { body: { kind: word(["research", "chain"], "research or chain"), subjectId: ref("a research node or refinery chain"), ratePct: int(0, 25, "a royalty of 0 to 25 percent") } },
  "GET /patents": NOTHING, // ISP-237 (AB#932): the caller's own patent office
  "GET /concessions/:systemId": { params: { systemId: ref("a system") } }, // ISP-229 (AB#924)
  // ISP-241 (AB#937): a case is a claim type and a record id, nothing else; the route derives the rest from the record
  "POST /arbitration/cases": { body: { type: word([...CLAIM_TYPES], "a claim type the Council hears"), recordId: ref("a record you are a party to") } },
  "GET /arbitration/cases": NOTHING,
  "POST /arbitration/preview": { body: { type: word([...CLAIM_TYPES], "a claim type the Council hears"), recordId: ref("a record you are a party to") } }, // ISP-243 (AB#939)
  "POST /arbitration/cases/:ref/cure": { params: { ref: ref("one of your cases") } }, // ISP-242 (AB#938)
  "GET /arbitration/records/:type": { params: { type: word([...CLAIM_TYPES], "a claim type the Council hears") } },
  "POST /concessions/:systemId/lease-modifier": { params: { systemId: ref("a system") }, body: { discountPct: choice(Array.from({ length: WARFARE_CATALOG.concessionLeaseModifierMaxPct + 1 }, (_, i) => i), `a lease discount, in whole percent from 0 to ${WARFARE_CATALOG.concessionLeaseModifierMaxPct}`) } }, // ISP-228 (AB#923): 0 is a good discount, so a list (as the payout ratio, AB#853)
  // ISP-199 (AB#893): roles, removal, the founder's transfer, identity and dissolution. A member is named by its
  // corporation's public id; the route answers 404 for one that is not a member.
  "POST /conglomerates/:conglomerateId/members/:corpId/role": {
    params: { conglomerateId: ref("a conglomerate"), corpId: ref("a member") },
    body: { role: word(["director", "member"], "director or member") }
  },
  "POST /conglomerates/:conglomerateId/members/:corpId/remove": { params: { conglomerateId: ref("a conglomerate"), corpId: ref("a member") } },
  "POST /conglomerates/:conglomerateId/founder": { params: { conglomerateId: ref("a conglomerate") }, body: { corpId: ref("a director to hand the founder role to") } },
  "POST /conglomerates/:conglomerateId/identity": {
    params: { conglomerateId: ref("a conglomerate") },
    body: {
      emblem: choice(Array.from({ length: CONGLOMERATE_CATALOG.emblems }, (_, i) => i + 1), "an emblem from the Bureau's list"),
      colour: choice(Array.from({ length: CONGLOMERATE_CATALOG.colours }, (_, i) => i + 1), "a colour from the Bureau's list")
    }
  },
  "POST /conglomerates/:conglomerateId/dissolve": { params: { conglomerateId: ref("a conglomerate") } },
  // ISP-204 (AB#898): the treasury. An amount is a whole number of credits; the rules refuse anything else again.
  "GET /conglomerates/:conglomerateId/treasury": { params: { conglomerateId: ref("a conglomerate") }, query: { offset: text(12, "a row to start from", { optional: true }), limit: text(4, "a page size from 1 to 100", { optional: true }) } },
  "POST /conglomerates/:conglomerateId/treasury/deposit": { params: { conglomerateId: ref("a conglomerate") }, body: { amount: int(1, 1_000_000_000_000, "an amount of credits") } },
  "POST /conglomerates/:conglomerateId/treasury/withdraw": { params: { conglomerateId: ref("a conglomerate") }, body: { amount: int(1, 1_000_000_000_000, "an amount of credits") } },
  "POST /conglomerates/:conglomerateId/treasury/withdrawals/:withdrawalId/block": { params: { conglomerateId: ref("a conglomerate"), withdrawalId: ref("a withdrawal") } },
  // ISP-205 (AB#899): the goods hangar. The station is one the registry knows (never a free string, the class of the
  // purchase-lease defect); the item's shape is checked here and its name against data/items.json by the rules.
  "GET /conglomerates/:conglomerateId/intel": { params: { conglomerateId: ref("a conglomerate") } }, // ISP-207 (AB#902)
  "GET /conglomerates/:conglomerateId/hangar": { params: { conglomerateId: ref("a conglomerate") }, query: { offset: text(12, "a row to start from", { optional: true }), limit: text(4, "a page size from 1 to 100", { optional: true }) } },
  "POST /conglomerates/:conglomerateId/hangar/deposit": {
    params: { conglomerateId: ref("a conglomerate") },
    body: { stationId: id("stations", "a station"), item: text(64, "an item"), quantity: int(1, 1_000_000_000, "a number of units") }
  },
  "POST /conglomerates/:conglomerateId/hangar/withdraw": {
    params: { conglomerateId: ref("a conglomerate") },
    body: { stationId: id("stations", "a station"), item: text(64, "an item"), quantity: int(1, 1_000_000_000, "a number of units") }
  },
  // ISP-202 (AB#896): the level to buy, the one after the current; the route refuses any other.
  // ISP-210 (AB#905): the station project. The body is a system's body by name (checked against that system by the
  // rules), the name one of a fixed list by number, and a contribution either credits or one item with a quantity.
  "GET /conglomerates/:conglomerateId/station-project": { params: { conglomerateId: ref("a conglomerate") } },
  "POST /conglomerates/:conglomerateId/station-project": {
    params: { conglomerateId: ref("a conglomerate") },
    body: { systemId: id("systems", "a star system"), body: text(64, "a body"), suffix: int(1, 6, "a station name from the list") }
  },
  "POST /conglomerates/:conglomerateId/station-project/contribute": {
    params: { conglomerateId: ref("a conglomerate") },
    body: {
      source: word(["own", "treasury", "hangar"], "where the contribution comes from: own, treasury or hangar"),
      credits: int(1, 1_000_000_000_000, "an amount of credits", { optional: true }),
      item: text(64, "an item", { optional: true }),
      quantity: int(1, 1_000_000_000, "a number of units", { optional: true })
    }
  },
  "POST /conglomerates/:conglomerateId/station-project/cancel": { params: { conglomerateId: ref("a conglomerate") } },
  // ISP-211 (AB#906): a proposal names a setting from the fixed list, and a value or a conglomerate; a vote is yes or no.
  "GET /conglomerates/:conglomerateId/station": { params: { conglomerateId: ref("a conglomerate") } },
  "POST /conglomerates/:conglomerateId/station/proposals": {
    params: { conglomerateId: ref("a conglomerate") },
    body: {
      setting: word(["access", "list", "unlist"], "a station setting: access, list or unlist"),
      value: word(["open", "members", "members-and-listed"], "who may dock: open, members or members-and-listed", { optional: true }),
      conglomerateId: ref("a conglomerate", { optional: true })
    }
  },
  "POST /conglomerates/:conglomerateId/station/proposals/:proposalId/vote": { params: { conglomerateId: ref("a conglomerate"), proposalId: ref("a proposal") }, body: { vote: word(["yes", "no"], "a vote: yes or no") } },
  "POST /conglomerates/:conglomerateId/level": {
    params: { conglomerateId: ref("a conglomerate") },
    body: { level: int(2, CONGLOMERATE_CATALOG.levels.length, "the level to buy") }
  },
  "POST /conglomerates/:conglomerateId/level-seen": { // ISP-203 (AB#897)
    params: { conglomerateId: ref("a conglomerate") },
    body: { level: int(2, CONGLOMERATE_CATALOG.levels.length, "the level seen") }
  },
  "POST /messages/send": {
    body: {
      draftId: ref("a draft", { optional: true }),
      toCorpId: ref("a recipient", { optional: true }),
      toCorpName: text(200, "a recipient's name", { optional: true }),
      subject: text(200, "a subject of at most 200 characters", { optional: true }),
      body: text(8000, "a message of at most 8,000 characters", { optional: true })
    }
  },
  "POST /messages/draft": {
    body: {
      draftId: ref("a draft", { optional: true }),
      toCorpId: ref("a recipient", { optional: true }),
      // A draft keeps whatever was typed, trimmed to 80 by the route (Bug #754); only sending refuses a long name.
      toCorpName: text(1000, "a recipient's name of at most 1,000 characters", { optional: true }),
      subject: text(200, "a subject of at most 200 characters", { optional: true }),
      body: text(8000, "a message of at most 8,000 characters", { optional: true })
    }
  },
  "DELETE /messages/draft/:draftId": { params: { draftId: ref("a draft") } },
  // AB#910: private messages. The body's own limit (8,000 characters, 32 KB) is the route's, answered 413; this only
  // stops a string longer than any request body express accepts from reaching it.
  "GET /conversations": {
    query: {
      cursor: text(200, "a page marker", { optional: true }),
      limit: text(4, "a page size", { optional: true }),
      archived: text(1, "1 for archived conversations", { optional: true })
    }
  },
  "POST /conversations/send": {
    body: {
      toCorpId: ref("the corporation the message is for"),
      body: text(100_000, "a message", { optional: true })
    }
  },
  "GET /conversations/:conversationId/messages": {
    params: { conversationId: ref("a conversation") },
    query: { cursor: text(40, "a page marker", { optional: true }), limit: text(4, "a page size", { optional: true }) }
  },
  "POST /conversations/:conversationId/read": { params: { conversationId: ref("a conversation") } },
  "POST /messages/:messageId/read": { params: { messageId: ref("a message") } },
  "POST /messages/:messageId/move": {
    params: { messageId: ref("a message") },
    body: { folder: word(["inbox", "archive", "trash"], "a folder: inbox, archive or trash") }
  }
};

/** Routes under /api/market (AB#732). The history route and cancel come from other open pull requests (!165, !154). */
export const MARKET_INPUT = {
  "POST /orders": {
    body: {
      type: word(["sell", "buy"], "an order type: sell or buy"), // AB#1054: buy orders
      item: id("tradeItems", "a resource or refined good"),
      quantity: int(1, 1_000_000_000, "a quantity to list or buy"),
      unitPrice: int(1, 1_000_000_000, "a price per unit in whole credits")
    }
  },
  "POST /orders/:orderId/buy": { params: { orderId: ref("a sell order") }, body: { quantity: int(1, 1_000_000_000, "a quantity to buy") } },
  "POST /orders/:orderId/cancel": { params: { orderId: ref("one of your listings or buy orders") }, elsewhere: "!154" },
  "POST /npc-orders/:orderId/sell": {
    params: { orderId: id("npcOrders", "a standing buy order") },
    // !154's words for this refusal, which its tests pin.
    body: { quantity: int(1, 1_000_000_000, "a quantity to sell", { message: "Quantity must be a whole number of at least 1." }) }
  },
  // !165's words: an item not in the catalog is refused without repeating it.
  "GET /history/:item": { params: { item: id("tradeItems", "a resource or refined good", { message: "Unknown item." }) }, elsewhere: "!165" }
};

/** Routes under /api/forums (AB#732). */
export const FORUM_INPUT = {
  "POST /threads": {
    body: {
      category: id("forumCategories", "a forum category"),
      title: text(200, "a title of at most 200 characters"),
      body: text(8000, "a post of at most 8,000 characters")
    }
  },
  "POST /threads/:threadId/replies": { params: { threadId: ref("a thread") }, body: { content: text(4000, "a reply of at most 4,000 characters"), replyToId: ref("a reply in this thread", { optional: true }) } }, // replyToId: AB#2466
  "POST /threads/:threadId/like": { params: { threadId: ref("a thread") }, body: { replyId: ref("a reply", { optional: true }) } }
};

const refuse = (error) => ({ ok: false, error });
// Not sent: left out, or empty. An explicit null is sent, and refused: JSON turns NaN and Infinity into null.
const isAbsent = (v) => v === undefined || v === "";

// A whole number from a JSON number or a string of digits. It lives in public/scripts so the Exchange forms read a
// typed number the way this check does (AB#1164); re-exported here for the callers and tests that import it from here.
import { wholeNumber } from "../public/scripts/wholeNumber.js";
export { wholeNumber };

/** An id as a trimmed string of sensible length, or null. */
export function idString(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s && s.length <= MAX_ID_LENGTH ? s : null;
}

/** Check one field against its spec. `has(catalog, value)` answers catalog and own-state membership. */
export function checkField(spec, value, has) {
  const result = checkFieldOnce(spec, value, has);
  return !result.ok && spec.message ? refuse(spec.message) : result;
}

function checkFieldOnce(spec, value, has) {
  if (isAbsent(value)) return spec.optional ? { ok: true } : refuse(`Enter ${spec.label}.`);
  if (value === null) return refuse(`Enter ${spec.label}.`);
  if (spec.kind === "text") {
    return typeof value === "string" && value.length <= spec.max ? { ok: true } : refuse(`Enter ${spec.label}.`);
  }
  if (spec.kind === "word") {
    return typeof value === "string" && spec.values.includes(value.trim()) ? { ok: true } : refuse(`Choose ${spec.label}.`);
  }
  if (spec.kind === "ref") {
    return idString(value) !== null ? { ok: true } : refuse(`Choose ${spec.label}.`);
  }
  if (spec.kind === "int") {
    const n = wholeNumber(value);
    if (n === null || n < spec.min || n > spec.max) return refuse(`Enter ${spec.label}: a whole number from ${spec.min.toLocaleString()} to ${spec.max.toLocaleString()}.`);
    return { ok: true };
  }
  if (spec.kind === "decimal") {
    return onStep(value, spec) ? { ok: true } : refuse(`Enter ${spec.label}: from ${spec.min} to ${spec.max}, in steps of ${spec.step}.`);
  }
  if (spec.kind === "choice") {
    const n = wholeNumber(value);
    return n !== null && spec.values.includes(n) ? { ok: true } : refuse(`Choose ${spec.label}.`);
  }
  const s = idString(value);
  if (s === null || !has(spec.catalog, s)) {
    return refuse(spec.catalog.startsWith("own") ? `Choose ${spec.label}; that one is not on your books.` : `Choose ${spec.label} from the game's list.`);
  }
  return { ok: true };
}

// Transfers (AB#717) refuse in the same words the transfer route uses, so a player sees one message whichever answers.
function checkTransfer(body, has, stationName) {
  if (isAbsent(body?.fromStationId)) return refuse("Choose the station to move goods from.");
  const from = idString(body?.fromStationId);
  if (from === null || !has("stations", from)) return refuse("That source station does not exist. Choose one from the Logistics tab.");
  const lines = Array.isArray(body?.lines) ? body.lines : body && "item" in body ? [{ item: body.item, quantity: body.quantity }] : null;
  if (!lines || lines.length === 0) return refuse("Add at least one item to move.");
  if (lines.length > MAX_TRANSFER_LINES) return refuse(`A transfer carries at most ${MAX_TRANSFER_LINES} lines; you sent ${lines.length}. Split it into two transfers.`);
  for (let i = 0; i < lines.length; i += 1) {
    // Only a blank item is missing. One too long to be any id is still an item, just not one the station holds (AB#1170).
    const item = lines[i]?.item;
    if (typeof item !== "string" || !item.trim()) return refuse(`Line ${i + 1} has no item. Pick one from the station's list.`);
    const n = wholeNumber(lines[i]?.quantity);
    if (n === null || n < 1 || n > 1_000_000_000) return refuse(`Line ${i + 1}: enter a whole number of at least 1 to move.`);
  }
  for (const line of lines) {
    const item = idString(line.item);
    if (item === null || !has("ownStock", `${from}|${item}`)) return refuse(`${stationName(from)} holds none of that item. Pick one from its list.`);
  }
  return { ok: true };
}

/** Validate one request against its route's entry: { ok: true } or { ok: false, error }. */
export function validateGameplayRequest(entry, { body, params, query }, has, stationName = (id) => id) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  if (entry.custom === "transfer") return checkTransfer(b, has, stationName);
  for (const [name, spec] of Object.entries(entry.params || {})) {
    const r = checkField(spec, params?.[name], has);
    if (!r.ok) return r;
  }
  for (const [name, spec] of Object.entries(entry.query || {})) {
    const r = checkField(spec, query?.[name], has);
    if (!r.ok) return r;
  }
  if (entry.oneOf) {
    const sent = Object.keys(entry.oneOf).filter((k) => !isAbsent(b[k]));
    if (sent.length !== 1) return refuse(`Choose one destination: ${Object.values(entry.oneOf).map((s) => s.label).join(" or ")}.`);
    return checkField(entry.oneOf[sent[0]], b[sent[0]], has);
  }
  for (const [name, spec] of Object.entries(entry.body || {})) {
    const r = checkField(spec, b[name], has);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/** "/lease/lease-123/start-mining" matched against "/lease/:leaseId/start-mining": the params, or null. */
export function matchRoute(pattern, path) {
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return null;
  const params = {};
  for (let i = 0; i < want.length; i += 1) {
    if (want[i].startsWith(":")) params[want[i].slice(1)] = decodeURIComponent(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

/**
 * The middleware, for one table (`routes`, default the gameplay table). `catalogs` maps a catalog name to a Set of ids;
 * `stationNames` maps a station id to its name; `callerOf(req)` gives the caller's account id, or null when the request
 * has no valid login, in which case the route's own requireAuth answers 401 first (AB#732: the market and forum
 * routes check the login per route, so this must not answer before it). `corpOf(accountId)` returns the caller's corporation
 * for the own-state checks (their leases, extractors, refineries and stock). Mounted after requireAccountAccess, so the
 * account is the caller's own.
 */
export function gameplayInputMiddleware({ catalogs, corpOf, stationNames, routes = GAMEPLAY_INPUT, callerOf = (req) => req.params.accountId }) {
  const entries = Object.entries(routes).map(([key, entry]) => {
    const [method, pattern] = key.split(" ");
    return { method, pattern, entry };
  });
  return (req, res, next) => {
    let match = null;
    for (const e of entries) {
      if (e.method !== req.method) continue;
      const params = matchRoute(e.pattern, req.path);
      if (params) { match = { ...e, params }; break; }
    }
    if (!match) return next(); // not a route in this table: another mount, or Express's 404
    const caller = callerOf(req);
    if (!caller) return next(); // no valid login: the route's own requireAuth answers
    let corp = null;
    const own = () => (corp ??= corpOf(caller) || {});
    const has = (catalog, value) => {
      if (catalog === "ownLeases") return (own().miningLeases || []).some((l) => l?.id === value);
      if (catalog === "ownExtractors") return (own().mining?.silicateExtractors || []).some((x) => x?.id === value);
      if (catalog === "ownBuildings") return (own().buildings || []).some((b) => typeof b?.id === "string" && b.id === value);
      if (catalog === "ownRefineries") return [...(own().refineries || []), ...(own().synthesisArrays || [])].some((r) => r?.id === value); // ISP-189 (AB#883)
      if (catalog === "ownMissions") return (own().activeMissions || []).some((m) => m?.id === value);
      if (catalog === "ownStock") {
        const [station, item] = [value.slice(0, value.indexOf("|")), value.slice(value.indexOf("|") + 1)];
        const held = own().inventory?.[station];
        return Boolean(held && Object.hasOwn(held, item) && Number(held[item]) > 0);
      }
      // Lease bodies match without regard to case, as the purchase route resolves them.
      if (catalog === "leaseBodies") return catalogs.leaseBodies?.has(value.toLowerCase()) === true;
      return catalogs[catalog]?.has(value) === true;
    };
    const result = validateGameplayRequest(match.entry, { body: req.body, params: match.params, query: req.query }, has, (sid) => (typeof stationNames?.get === "function" ? stationNames.get(sid) : stationNames?.[sid]) || "That station");
    if (!result.ok) return res.status(400).json({ error: result.error });
    return next();
  };
}
