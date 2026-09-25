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
