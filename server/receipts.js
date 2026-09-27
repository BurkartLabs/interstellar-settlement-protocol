// server/receipts.js
// AB#743 (ISP-57): what a committing action did, in the server's own figures, for the confirmation modal
// (public/scripts/views/receiptModal.js). Every route that commits something answers with the account as before plus
// `receipt`, built here from the values its mutation actually used, so the page never recomputes a price.
//
// The shape, which AB#744 extends to the rest of the game's actions:
//   { action, title, summary, cost, grants: [{ label, value }], next }
// `cost` is the display text of what was charged ("12,500 credits"), `costCredits` the number, for tests. Every
// string is in the ISA's register: no exclamation marks, no congratulations (CONTRIBUTING.md, "Tone Note").
import { employeesForNextLease } from "../public/scripts/leaseStaffing.js";

/** "12,500 credits". The one formatter for credits in server text; server/routes/helpers.js re-exports it. */
export function formatCredits(amount) {
  return `${Math.round(Number(amount || 0)).toLocaleString("en-US")} credits`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "25 Sep, 18:04 UTC": a fixed-name date a test can read on any machine (T-061). */
export function formatUtc(ms) {
  const d = new Date(Number(ms));
  if (!Number.isFinite(d.getTime())) return "an unrecorded time";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mm} UTC`;
}

const receipt = (action, { title, summary, costCredits, grants, next }) => ({
  action,
  title,
  summary,
  cost: formatCredits(costCredits),
  costCredits: Math.round(Number(costCredits || 0)),
  grants,
  next
});

/** The next staffing step toward a lease, from the same rule the ISA applies (public/scripts/leaseStaffing.js). */
function staffingNext(corp) {
  const needed = employeesForNextLease((corp.miningLeases || []).length);
  const short = needed - Number(corp.employeeCount || 0);
  return short > 0
    ? `Hire ${short} more employee${short === 1 ? "" : "s"}: the ISA requires ${needed} on payroll before it files your next mining lease.`
    : "File an extraction lease at the ISA Claims & Leases Division, at the station that orbits the body you want to mine.";
}

export function rentOfficeReceipt({ stationName, durationDays, cost, rentedUntil, corp }) {
  return receipt("rent-office", {
    title: "Office Lease Confirmed",
    summary: `A registered office at ${stationName} for ${durationDays} days.`,
    costCredits: cost,
    grants: [
      { label: "Registered presence", value: stationName },
      { label: "Lease runs until", value: formatUtc(rentedUntil) },
      { label: "Now possible here", value: "Hiring, filing mining leases, operating extractors" }
    ],
    next: staffingNext(corp)
  });
}

export function renewOfficeReceipt({ stationName, durationDays, cost, rentedUntil }) {
  return receipt("renew-office", {
    title: "Office Lease Renewed",
    summary: `The office at ${stationName}, extended by ${durationDays} days.`,
    costCredits: cost,
    grants: [
      { label: "Lease now runs until", value: formatUtc(rentedUntil) }
    ],
    next: "Operations from this office continue. Renew again from the Orbital Executive Suites before the new date."
  });
}

export function hireReceipt({ hired, cost, payrollPerDay, corp }) {
  return receipt("hire", {
    title: "Hiring Order Confirmed",
    summary: `${hired} employee${hired === 1 ? "" : "s"} added to the payroll.`,
    costCredits: cost,
    grants: [
      { label: "Employees", value: `${corp.employeeCount} / ${corp.employeeCap}` },
      { label: "Payroll added", value: `${formatCredits(payrollPerDay)} per day` }
    ],
    next: staffingNext(corp)
  });
}

export function purchaseLeaseReceipt({ body, cost, corp }) {
  return receipt("purchase-lease", {
    title: "Mining Lease Approved",
    summary: `Silicate extraction rights on ${body}.`,
    costCredits: cost,
    grants: [
      { label: "Extraction rights", value: body },
      { label: "Building slots on the lease", value: "2" },
      { label: "Corporation building slots", value: String(corp.buildingSlots) }
    ],
    next: `Open the ${body} lease and commission a Basic Extractor Yard on it.`
  });
}

export function buildExtractorReceipt({ extractorName, body, cost, assetValue }) {
  return receipt("build-extractor", {
    title: "Extractor Commissioned",
    summary: `${extractorName}, on the ${body || "mining"} lease.`,
    costCredits: cost,
    grants: [
      { label: "Facility", value: extractorName },
      { label: "Added to assets", value: formatCredits(assetValue) }
    ],
    next: `Start a mining cycle on ${extractorName} from the lease.`
  });
}

/** ISP-101 (AB#793), ISP-102 (AB#794): a building upgraded by one tier, with what that tier changes. */
export function upgradeReceipt({ name, tier, cost, assetValue, offlineUntil, effect }) {
  return receipt("upgrade-building", {
    title: "Building Upgraded",
    summary: `${name}, now tier ${tier}.`,
    costCredits: cost,
    grants: [
      ...(effect ? [effect] : []),
      { label: "Added to assets", value: formatCredits(assetValue) },
      ...(offlineUntil ? [{ label: "Offline until", value: formatUtc(offlineUntil) }] : [])
    ],
    next: offlineUntil ? "Start it again once it is back online." : "It works at its new tier from its next run."
  });
}

export function startMiningReceipt({ extractorName, cost, hours, throughputPerHour, operationCostPerHour, endsAt }) {
  return receipt("start-mining", {
    title: "Mining Cycle Started",
    summary: `${extractorName}, for ${hours} hour${hours === 1 ? "" : "s"}.`,
    costCredits: cost,
    grants: [
      { label: "Extraction rate", value: `${throughputPerHour} Silicates per hour` },
      { label: "Operating cost", value: `${formatCredits(operationCostPerHour)} per hour, charged as it runs` },
      { label: "Cycle ends", value: formatUtc(endsAt) }
    ],
    next: "Output settles into this station's inventory while the cycle runs. Sell it on the Galactic Exchange."
  });
}

// ── AB#744 (ISP-58): the rest of the game's committing actions ─────────────────────────────────────────────────────
// Same shape and register as the six above. Where an action charges nothing (scouting, travel, a listing, a contract),
// the receipt still says so ("0 credits"): the modal is the record of what happened, not only of what was paid.

const amount = (n) => Math.round(Number(n || 0)).toLocaleString("en-US");

export function buildRefineryReceipt({ refineryName, cost, slotsUsed, slotsTotal }) {
  return receipt("build-refinery", {
    title: "Refinery Commissioned",
    summary: `${refineryName} is operational.`,
    costCredits: cost,
    grants: [
      { label: "Facility", value: refineryName },
      { label: "Building slots used", value: `${slotsUsed} / ${slotsTotal}` }
    ],
    next: "Start a production run from Refinery Chains: choose a chain and how much input to process."
  });
}

export function buildAssemblyReceipt({ cost, assetValue, slotsUsed, slotsTotal }) {
  return receipt("build-assembly-facility", {
    title: "Assembly Facility Commissioned",
    summary: "An Assembly Facility is operational at your corporation.",
    costCredits: cost,
    grants: [
      { label: "Added to assets", value: formatCredits(assetValue) },
      { label: "Building slots used", value: `${slotsUsed} / ${slotsTotal}` },
      { label: "Now possible", value: "Fabricating mining probes" }
    ],
    next: "Fabricate a mining probe here, then scout an asteroid belt on the Starmap."
  });
}

// ISP-96 (AB#786): built through POST /gameplay/build only, so no route of its own names this builder.
export function buildFerricMiningComplexReceipt({ cost, assetValue, slotsUsed, slotsTotal, multiplier }) {
  return receipt("build-ferric-mining-complex", {
    title: "Ferric Mining Complex Commissioned",
    summary: "A Ferric Mining Complex is operational at your corporation.",
    costCredits: cost,
    grants: [
      { label: "Added to assets", value: formatCredits(assetValue) },
      { label: "Building slots used", value: `${slotsUsed} / ${slotsTotal}` },
      { label: "Now possible", value: `${Math.round((multiplier - 1) * 100)}% more Nickel and Titanium from every returning probe` }
    ],
    next: "Launch an asteroid expedition from the Starmap; its Nickel and Titanium arrive with the bonus."
  });
}

// ISP-170 (AB#864): built through POST /gameplay/build only. ISP-171 (AB#865) builds ships there; the Fleet screen that queues them is ISP-175.
export function buildOrbitalShipyardReceipt({ cost, assetValue, slotsUsed, slotsTotal }) {
  return receipt("build-orbital-shipyard", {
    title: "Orbital Shipyard Commissioned",
    summary: "An Orbital Shipyard is operational at your corporation.",
    costCredits: cost,
    grants: [
      { label: "Added to assets", value: formatCredits(assetValue) },
      { label: "Building slots used", value: `${slotsUsed} / ${slotsTotal}` },
      { label: "Now possible", value: "Queue ships on the Fleet tab" }
    ],
    next: "Light Fighters, Destroyers and Siege Engines are built here, at the catalog's cost and time, and join your fleet."
  });
}

// ISP-97 (AB#787): built through POST /gameplay/build only, so no route of its own names this builder.
export function buildRefineryComplexReceipt({ cost, assetValue, refineryName, multiplier }) {
  return receipt("build-refinery-complex", {
    title: "Refinery Complex Commissioned",
    summary: `${refineryName} is now a Refinery Complex.`,
    costCredits: cost,
    grants: [
      { label: "Added to assets", value: formatCredits(assetValue) },
      { label: "Building slots used", value: "None: it upgrades the Refinery in place" },
      { label: "Now possible", value: `${Math.round((multiplier - 1) * 100)}% more of every output from ${refineryName}'s runs` }
    ],
    next: "Start a production run on it from Refinery Chains; its outputs arrive with the bonus."
  });
}

// ISP-98 (AB#788): built through POST /gameplay/build only, so no route of its own names this builder.
export function buildCryoVaporArrayReceipt({ cost, assetValue, body, multiplier, slotsUsed, slotsTotal }) {
  return receipt("build-cryo-vapor-extractor-array", {
    title: "Cryo-vapor Extractor Array Commissioned",
    summary: `A Cryo-vapor Extractor Array is operational on the ${body} lease.`,
    costCredits: cost,
    grants: [
      { label: "Added to assets", value: formatCredits(assetValue) },
      { label: "Building slots used", value: `${slotsUsed} / ${slotsTotal}, and one on the ${body} lease` },
      { label: "Now possible", value: `${Math.round((multiplier - 1) * 100)}% more Silicates from every extractor on the ${body} lease` }
    ],
    next: `Run an extractor cycle on the ${body} lease; it mines with the bonus.`
  });
}

/** `inputs` is every input the run took, `[{ item, quantity }]`: one for most chains, several for an alloy (AB#825). */
export function startRefineryReceipt({ refineryName, inputs, outputs, hours, endsAt }) {
  const taken = (inputs || []).map((i) => `${amount(i.quantity)} ${i.item}`).join(" + ");
  return receipt("start-refinery", {
    title: "Production Run Started",
    summary: `${refineryName} is processing ${taken}.`,
    costCredits: 0,
    grants: [
      { label: (inputs || []).length > 1 ? "Inputs consumed" : "Input consumed", value: taken },
      { label: "Output when it ends", value: outputs.map((o) => `${amount(o.quantity)} ${o.item}`).join(", ") },
      { label: "Run length", value: `${hours} hour${hours === 1 ? "" : "s"}` },
      { label: "Run ends", value: formatUtc(endsAt) }
    ],
    next: "The output is added to this station's inventory when the run ends."
  });
}

/** ISP-171 (AB#865): ships queued at the Orbital Shipyard, at the catalog's cost and time. */
export function shipQueueReceipt({ job, unitName, vessels, cap }) {
  const goods = Object.entries(job.goods).map(([item, qty]) => `${qty.toLocaleString("en-US")} ${item}`).join(", ");
  return receipt("shipyard-queue", {
    title: "Ship Production Queued",
    summary: `${job.quantity} ${unitName}${job.quantity === 1 ? "" : "s"}, at your Orbital Shipyard.`,
    costCredits: job.credits,
    grants: [
      { label: "Goods used", value: goods },
      { label: "Starts", value: formatUtc(job.startsAt) },
      { label: "Ready", value: formatUtc(job.completesAt) },
      { label: "Fleet", value: `${vessels} / ${cap} vessels, these included` }
    ],
    next: "They join your fleet when the job completes. Cancelling returns all of a job not yet started, half of one under way."
  });
}

/** ISP-171 (AB#865): a shipyard job cancelled, and what came back. */
export function shipCancelReceipt({ job, unitName, refund }) {
  const goods = Object.entries(refund.goods).filter(([, qty]) => qty > 0).map(([item, qty]) => `${qty.toLocaleString("en-US")} ${item}`).join(", ") || "none";
  return receipt("shipyard-cancel", {
    title: "Ship Production Cancelled",
    summary: `${job.quantity} ${unitName}${job.quantity === 1 ? "" : "s"}, taken off the slips.`,
    costCredits: 0,
    grants: [
      { label: "Credits returned", value: formatCredits(refund.credits) },
      { label: "Goods returned", value: goods },
      { label: "Share returned", value: refund.share === 1 ? "all of it: the job had not started" : "half: the job was under way" }
    ],
    next: "Queue ships again on the Fleet tab when you are ready."
  });
}

/** ISP-172 (AB#866): troops training at Headquarters, at the catalog's cost and time. */
export function troopTrainingReceipt({ job, what, garrison }) {
  const goods = Object.entries(job.goods).map(([item, qty]) => `${qty.toLocaleString("en-US")} ${item}`).join(", ");
  return receipt("training-queue", {
    title: "Troop Training Started",
    summary: `${what}, at your Headquarters.`,
    costCredits: job.credits,
    grants: [
      { label: "Goods used", value: goods },
      { label: "Starts", value: formatUtc(job.startsAt) },
      { label: "Ready", value: formatUtc(job.completesAt) },
      { label: garrison ? "Garrison" : "Stationed", value: garrison ? `${garrison}, where you queued them` : "with your fleet" }
    ],
    next: "They are yours when training completes. No employees are taken: payroll and your leases' staffing are unchanged."
  });
}

/** ISP-172 (AB#866): a training job cancelled, and what came back. */
export function troopCancelReceipt({ what, refund }) {
  const goods = Object.entries(refund.goods).filter(([, qty]) => qty > 0).map(([item, qty]) => `${qty.toLocaleString("en-US")} ${item}`).join(", ") || "none";
  return receipt("training-cancel", {
    title: "Troop Training Cancelled",
    summary: `${what}, sent home.`,
    costCredits: 0,
    grants: [
      { label: "Credits returned", value: formatCredits(refund.credits) },
      { label: "Goods returned", value: goods },
      { label: "Share returned", value: refund.share === 1 ? "all of it: training had not started" : "half: training was under way" }
    ],
    next: "Train troops again on the Fleet tab when you are ready."
  });
}

export function probeFabricationReceipt({ cost, completesAt, vessels, cap }) {
  return receipt("build-mining-probe", {
    title: "Probe Fabrication Started",
    summary: "One mining probe, at your Assembly Facility.",
    costCredits: cost,
    grants: [
      { label: "Ready", value: formatUtc(completesAt) },
      { label: "Fleet", value: `${vessels} / ${cap} vessels, this probe included` }
    ],
    next: "When it is ready, open an asteroid belt on the Starmap: scout it, then launch an expedition with the probe."
  });
}

export function scoutBeltReceipt({ beltLabel }) {
  return receipt("scout-belt", {
    title: "Belt Scouted",
    summary: `${beltLabel} is surveyed.`,
    costCredits: 0,
    grants: [{ label: "Survey", value: "Its composition is now shown on the Starmap" }],
    next: "Launch an expedition to it from the Starmap, with a mining probe from your Assembly Facility."
  });
}

export function launchExpeditionReceipt({ beltLabel, durationLabel, cost, completesAt, probesLeft }) {
  return receipt("launch-expedition", {
    title: "Expedition Launched",
    summary: `A mining probe to ${beltLabel}, on a ${durationLabel} mission.`,
    costCredits: cost,
    grants: [
      { label: "Returns", value: formatUtc(completesAt) },
      { label: "Probes still on hand", value: String(probesLeft) }
    ],
    next: "Its yield is deposited at a station in that system when it returns. The Mineral Survey Office sends a report."
  });
}

export function queueResearchReceipt({ name, cost, startsAt, endsAt, now }) {
  return receipt("queue-rnd", {
    title: "Research Queued",
    summary: `${name}, in the corporate R&D queue.`,
    costCredits: cost,
    grants: [
      { label: "Starts", value: Number(startsAt) <= Number(now) ? "Now" : formatUtc(startsAt) },
      { label: "Completes", value: formatUtc(endsAt) }
    ],
    next: "It takes effect when it completes. Research queued after it starts when it ends."
  });
}

export function queueInsightReceipt({ name, cost, endsAt }) {
  return receipt("queue-ceo", {
    title: "Executive Program Enrolled",
    summary: `${name}, in the CEO Insight queue.`,
    costCredits: cost,
    grants: [{ label: "Completes", value: formatUtc(endsAt) }],
    next: "Its effect applies to your corporation when the program completes."
  });
}

export function listingReceipt({ item, quantity, unitPrice, stationName, soldAtOnce = 0 }) {
  return receipt("list-for-sale", {
    title: "Listing Posted",
    summary: `${amount(quantity)} ${item} for sale at ${formatCredits(unitPrice)} each.`,
    costCredits: 0,
    grants: [
      { label: "Listed value", value: formatCredits(Number(quantity) * Number(unitPrice)) },
      // AB#1054: what sold at once to players' buy orders at or over the price.
      ...(soldAtOnce > 0 ? [{ label: "Sold at once to buy orders", value: `${amount(soldAtOnce)} ${item}` }] : []),
      { label: "Held for the buyer at", value: stationName }
    ],
    next: "It stays on Sell Orders until another corporation buys it or you cancel it. Exchange tax comes out of what it sells for."
  });
}

/** AB#1054: a buy order placed: what filled at once, what it paid, and what is held for the rest. */
export function buyOrderReceipt({ item, quantity, unitPrice, filled, paid, held, stationName }) {
  const waiting = quantity - filled;
  return receipt("place-buy-order", {
    title: filled >= quantity ? "Buy Order Filled" : "Buy Order Placed",
    summary: `${amount(quantity)} ${item} wanted at up to ${formatCredits(unitPrice)} each; ${amount(filled)} bought at once.`,
    costCredits: paid + held,
    grants: [
      { label: "Paid for what filled", value: formatCredits(paid) },
      { label: "Held for the rest", value: formatCredits(held) },
      { label: "Delivered to", value: stationName }
    ],
    next: waiting > 0
      ? `The other ${amount(waiting)} waits on Buy Orders and fills from any listing at or under your price. Cancelling returns what is held.`
      : "It is in this station's inventory: refine it, deliver it on a contract, or ship it from Logistics."
  });
}

export function buyReceipt({ item, quantity, unitPrice, total, stationName }) {
  return receipt("buy", {
    title: "Purchase Completed",
    summary: `${amount(quantity)} ${item} at ${formatCredits(unitPrice)} each.`,
    costCredits: total,
    grants: [{ label: "Delivered to", value: stationName }],
    next: "It is in this station's inventory: refine it, deliver it on a contract, or ship it from Logistics."
  });
}

export function sellToOrderReceipt({ item, quantity, unitPrice, total, taxPct, taxAmount, proceeds }) {
  return receipt("sell-to-order", {
    title: "Sale Completed",
    summary: `${amount(quantity)} ${item} sold to a standing order at ${formatCredits(unitPrice)} each.`,
    costCredits: taxAmount,
    grants: [
      { label: "Sale value", value: formatCredits(total) },
      { label: "Exchange tax", value: `${formatCredits(taxAmount)} (${taxPct}%), the amount charged above` },
      { label: "Paid to your reserves", value: formatCredits(proceeds) }
    ],
    next: "The credits are in your reserves now."
  });
}

export function transferReceipt({ linesText, fromName, toName, fee, arrivesAt }) {
  return receipt("transfer-resources", {
    title: "Shipment Dispatched",
    summary: `${linesText}, from ${fromName} to ${toName}.`,
    costCredits: fee,
    grants: [{ label: "Arrives", value: formatUtc(arrivesAt) }],
    next: "It joins this station's inventory on arrival. Follow it under Logistics, Shipments."
  });
}

/** "A", "A or B", "A, B or C". */
const orList = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`);

/**
 * AB#2333: a jump's next step names the stations of the system it goes to (`stations`, their names). A system with
 * none (AB#806's six new ones, until their stations are built) has nowhere to dock, and the receipt says so and what
 * can still be done there: its belt is scouted and mined from the system itself, undocked, and a jump goes on or home.
 */
export function travelReceipt({ interstellar, destination, arrivesAt, stations = [] }) {
  const jumpNext = stations.length
    ? `When you arrive, dock at ${orList(stations)} from the Starmap's system view.`
    : "There is no station in that system yet, so nowhere to dock there. From the Starmap you can still scout its " +
      "asteroid belt and send expeditions to it once you arrive, or jump on or home.";
  return receipt("travel", {
    title: interstellar ? "Jump Initiated" : "Course Set",
    summary: `Under way to ${destination}.`,
    costCredits: 0,
    grants: [{ label: "Arrives", value: formatUtc(arrivesAt) }],
    next: interstellar ? jumpNext : "You dock on arrival; that station's offices open to you once you are docked."
  });
}

export function acceptMissionReceipt({ title, quota, hoursRequired, reward }) {
  const task = quota
    ? { label: "Deliver", value: `${amount(quota.amount)} ${quota.resource}` }
    : { label: "Work required", value: `${hoursRequired} hour${Number(hoursRequired) === 1 ? "" : "s"} of documented recovery work` };
  return receipt("accept-mission", {
    title: "Contract Accepted",
    summary: title,
    costCredits: 0,
    grants: [task, { label: "Reward on completion", value: String(reward || "None stated") }],
    next: quota
      ? `Bring ${amount(quota.amount)} ${quota.resource} to the agent's station and complete it from Assignments.`
      : "Complete it from Assignments once the hours are served."
  });
}

/**
 * The standing a count of completed contracts gives, from data/missions.json's reputationTiers: the same thresholds
 * and titles the Assignments page reads (views/assignments.js getAgentRepLevel).
 */
export function standingFor(count, tiers) {
  const thresholds = tiers?.thresholds || [0];
  let level = 0;
  for (let i = thresholds.length - 1; i >= 0; i -= 1) {
    if (count >= thresholds[i]) { level = i; break; }
  }
  return { level, title: (tiers?.titles || [])[level] || "Unknown" };
}

export function completeMissionReceipt({ title, delivered, rewardCredits, standing }) {
  return receipt("complete-mission", {
    title: "Contract Completed",
    summary: title,
    costCredits: 0,
    grants: [
      ...(delivered ? [{ label: "Delivered", value: `${amount(delivered.amount)} ${delivered.resource}` }] : []),
      { label: "Paid to your reserves", value: formatCredits(rewardCredits) },
      ...(standing
        ? [{ label: "Standing with the agent", value: `${standing.title} (Level ${standing.level})${standing.raised ? ", raised by this contract" : ""}` }]
        : [])
    ],
    next: "New contracts are offered in the agent's office on Assignments."
  });
}
